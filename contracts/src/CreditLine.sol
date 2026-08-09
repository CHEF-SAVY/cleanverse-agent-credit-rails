// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICreditLine} from "./interfaces/ICreditLine.sol";
import {ICreditPool} from "./interfaces/ICreditPool.sol";
import {IApassComplianceValidator} from "./interfaces/IApassComplianceValidator.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title CreditLine — identity-gated, under-collateralized credit for agents
/// @notice Replaces SellerBond. Where SellerBond required a seller to lock 100% of the job's
/// collateral in advance, CreditLine lets an A-Pass-verified agent *commit* against a credit limit
/// it never funded, and only turns that commitment into real money — drawn from CreditPool —
/// if a dispute actually goes against it. The agent then owes that draw as debt.
///
/// The limit is the whole product:
///
///     creditLimit = (highest tier gate the operator passes) + min(completedJobs * bonus, cap)
///
/// Identity first (an operator who passes no gate has a limit of zero, full stop), reputation
/// second. That is "identity-based under-collateralized lending" stated literally: eligibility
/// comes from Cleanverse's own CCP validator, job history is earned on-chain here, and neither
/// is a collateral ratio.
///
/// Crucially the identity check is a live call, not a mirrored snapshot. `complianceVerify` is a
/// permissionless view on the CCP validator, so this contract asks Cleanverse's policy engine
/// whether the borrower qualifies *inside the borrowing transaction itself*. There is no
/// attestor key to trust, nothing to keep in sync, and a revoked or expired CVI stops backing
/// new credit the instant Cleanverse says so.
///
/// The agent pays for the facility with a premium in basis points of every commitment, accrued
/// at reservation and owed whether or not the job goes bad — that premium is the lenders' yield,
/// and the reason a pool would underwrite an agent at all.
contract CreditLine is ICreditLine {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- state

    /// @notice Settlement asset, shared with the pool and with JobEscrow. Single-asset by
    /// design for now — see docs for the deferred A-Token/payment-token conversion seam.
    IERC20 public immutable ASSET;
    IIdentityRegistry public immutable IDENTITY_REGISTRY;
    /// @notice Cleanverse's CCP compliance validator. Immutable: it is the root of the identity
    /// gate, and an owner able to swap it could silently point lending at a permissive
    /// look-alike.
    IApassComplianceValidator public immutable VALIDATOR;
    ICreditPool public immutable POOL;
    /// @notice The only address allowed to reserve, release, or draw against a credit line.
    /// Immutable, set at construction — same guarantee SellerBond.JOB_ESCROW gave, and for the
    /// same reason: nothing else can ever put an agent into debt.
    address public immutable JOB_ESCROW;

    address public owner;

    /// @notice One credit band: a CCP-registered gate address, and the limit granted to any
    /// operator whose CVI satisfies that gate's RuleV2.
    /// @dev Deliberately not a tier number. This contract never learns anyone's tier — it only
    /// learns which gates they pass, which is all a credit decision needs and the only thing
    /// `complianceVerify` will tell us. Moving a band's tier threshold is a rule change on
    /// Cleanverse, not a change here.
    struct TierBand {
        address gate;
        uint256 limit;
    }

    /// @notice Credit bands, evaluated in full on every limit read. Order carries no meaning:
    /// the *highest* limit among passing gates wins, so a mis-ordered array cannot silently
    /// under- or over-credit anyone. Kept short (a handful of bands) — every entry costs one
    /// staticcall per limit read.
    TierBand[] public tierBands;

    /// @notice Per-job draw ceiling applied to every agent, in asset units. 0 = no cap beyond
    /// the credit limit itself.
    /// @dev Ours, not Cleanverse's — CCP has no per-account spend-mandate concept. It exists so
    /// a single catastrophic job cannot consume an entire large line at once.
    uint256 public maxDrawPerJob;
    /// @notice Extra limit earned per successfully completed job, and the ceiling on that
    /// earned portion. The cap matters: without it, a patient agent could grind an unbounded
    /// limit out of arbitrarily many tiny self-dealt jobs, which is the cheapest attack on any
    /// reputation-scored lender.
    uint256 public historyBonusPerJob;
    uint256 public maxHistoryBonus;

    /// @notice Facility fee charged on every commitment, in basis points of the committed
    /// amount. Accrued as debt at reservation rather than pulled as tokens: the agent isn't the
    /// caller of `reserve` (the buyer is, via JobEscrow), so a pull here would make job creation
    /// fail on the agent's wallet balance — a confusing failure on the buyer's transaction.
    uint256 public premiumBps = 100;
    /// @notice Hard ceiling on premiumBps (10%). Bounds what a compromised owner key can do:
    /// an extortionate premium would make every new commitment instantly eat the agent's limit.
    uint256 public constant MAX_PREMIUM_BPS = 1_000;

    /// @notice How long an agent may carry drawn debt before it blocks new commitments and
    /// becomes eligible for write-off. Owner-settable within MAX_REPAYMENT_GRACE.
    uint64 public repaymentGracePeriod = 7 days;
    /// @notice Mirrors SellerBond.MAX_WITHDRAWAL_TIMELOCK's rationale: bounds what a
    /// compromised owner key can freeze. No minimum, so a demo can shorten it to near-zero.
    uint64 public constant MAX_REPAYMENT_GRACE = 30 days;

    /// agentId => committed against live jobs, not yet drawn or released
    mapping(uint256 => uint256) public reserved;
    /// agentId => principal actually drawn from the pool and still owed
    mapping(uint256 => uint256) public principalOwed;
    /// agentId => accrued facility premium still owed
    mapping(uint256 => uint256) public premiumOwed;
    /// agentId => successfully completed jobs, the history half of the limit formula
    mapping(uint256 => uint256) public completedJobs;
    /// agentId => principal written off as uncollectable and not since recovered. Survives the
    /// write-off that created it on purpose: it is the agent's default record. A non-zero value
    /// blocks every new commitment, so defaulting costs an agent its ability to borrow until
    /// somebody makes the pool whole (see repayChargedOff). Without this a default is free —
    /// writeOff clears the debt, the limit springs back to full, and the cheapest strategy
    /// available to an agent is to borrow, default, and immediately borrow again.
    mapping(uint256 => uint256) public chargedOff;
    /// agentId => when this agent's current run of drawn debt began; 0 when debt-free. Snapshots
    /// the *first* draw rather than the latest, so an agent can't reset its delinquency clock by
    /// taking on more debt.
    mapping(uint256 => uint64) public debtSince;

    /// @notice Sum of all agents' live commitments. The pool must hold at least this much idle
    /// liquidity, checked on every new reservation — otherwise the protocol could promise more
    /// credit than it can actually fund, and discover it only at the moment a buyer needs
    /// paying.
    uint256 public totalReserved;

    // ---------------------------------------------------------------- events

    event Reserved(uint256 indexed agentId, uint256 amount, uint256 premium);
    event ReservationReleased(uint256 indexed agentId, uint256 amount, bool countsAsCompletion);
    event Drawn(uint256 indexed agentId, address indexed recipient, uint256 amount);
    event Repaid(uint256 indexed agentId, address indexed payer, uint256 principal, uint256 premium);
    event WrittenOff(uint256 indexed agentId, uint256 principal);
    event ChargedOffRecovered(uint256 indexed agentId, address indexed payer, uint256 amount, uint256 remaining);
    event TierBandsUpdated(uint256 count);
    event MaxDrawPerJobUpdated(uint256 previous, uint256 current);
    event HistoryBonusUpdated(uint256 bonusPerJob, uint256 maxBonus);
    event PremiumBpsUpdated(uint256 previous, uint256 current);
    event RepaymentGracePeriodUpdated(uint64 previous, uint64 current);
    event OwnerUpdated(address previous, address current);

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error NotJobEscrow();
    error ZeroAddress();
    error ZeroAmount();
    error AgentNotVerified(uint256 agentId);
    error MandateExceeded(uint256 agentId, uint256 requested, uint256 maxDrawPerJob);
    error InsufficientCredit(uint256 agentId, uint256 requested, uint256 available);
    error InsufficientPoolLiquidity(uint256 required, uint256 available);
    error AgentDelinquent(uint256 agentId, uint64 delinquentSince);
    error AgentChargedOff(uint256 agentId, uint256 chargedOffAmount);
    error NothingChargedOff(uint256 agentId);
    error RecoveryExceedsChargedOff(uint256 agentId, uint256 amount, uint256 chargedOffAmount);
    error InsufficientReserved(uint256 agentId, uint256 requested, uint256 reserved_);
    error NothingOwed(uint256 agentId);
    error RepaymentExceedsDebt(uint256 agentId, uint256 amount, uint256 owed);
    error NotWriteOffEligible(uint256 agentId);
    error NoTierBands();
    error ZeroLimitBand();
    error PremiumTooHigh(uint256 requested, uint256 max);
    error GracePeriodTooLong(uint64 requested, uint64 max);

    // ------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier onlyJobEscrow() {
        _checkJobEscrow();
        _;
    }

    /// @dev See onlyOwner — kept out of the modifier so it isn't duplicated into every use
    /// site's bytecode (forge lint's unwrapped-modifier-logic rule).
    function _checkOwner() internal view {
        if (msg.sender != owner) revert NotOwner();
    }

    /// @dev See onlyJobEscrow.
    function _checkJobEscrow() internal view {
        if (msg.sender != JOB_ESCROW) revert NotJobEscrow();
    }

    // ----------------------------------------------------------- constructor

    constructor(address asset_, address identityRegistry_, address validator_, address pool_, address jobEscrow_) {
        if (
            asset_ == address(0) || identityRegistry_ == address(0) || validator_ == address(0) || pool_ == address(0)
                || jobEscrow_ == address(0)
        ) {
            revert ZeroAddress();
        }
        ASSET = IERC20(asset_);
        IDENTITY_REGISTRY = IIdentityRegistry(identityRegistry_);
        VALIDATOR = IApassComplianceValidator(validator_);
        POOL = ICreditPool(pool_);
        JOB_ESCROW = jobEscrow_;
        owner = msg.sender;
    }

    // ------------------------------------------------------------- functions

    /// @inheritdoc ICreditLine
    /// @dev Five gates, in cost order — cheapest and most fundamental first, so the revert an
    /// integrator sees names the actual problem rather than whichever check happened to run:
    ///   1. verified at all (tier 0 => no credit, ever)
    ///   2. within the Skill-Framework mandate for a single job
    ///   3. not carrying overdue debt
    ///   4. within the agent's own remaining headroom, premium included
    ///   5. the pool can actually fund every live commitment including this one
    /// Nothing moves tokens here. A commitment is a promise the pool will pay *if* the job goes
    /// bad, which is exactly the capital efficiency the bond model lacked.
    function reserve(uint256 agentId, uint256 amount) external onlyJobEscrow {
        if (amount == 0) revert ZeroAmount();

        // The identity gate. creditLimit() resolves the agent's operator and asks the CCP
        // validator live; a limit of zero means they pass no band, which is the only meaning
        // "unverified" has here.
        uint256 limit = creditLimit(agentId);
        if (limit == 0) revert AgentNotVerified(agentId);

        uint256 perJobCap = maxDrawPerJob;
        if (perJobCap != 0 && amount > perJobCap) {
            revert MandateExceeded(agentId, amount, perJobCap);
        }

        // A prior default outranks every other check below it. Unlike delinquency, which time
        // and a repayment both cure, this one is cleared only by making the pool whole.
        uint256 chargedOffAmount = chargedOff[agentId];
        if (chargedOffAmount != 0) revert AgentChargedOff(agentId, chargedOffAmount);

        uint64 delinquentSince = debtSince[agentId];
        if (delinquentSince != 0 && block.timestamp > delinquentSince + repaymentGracePeriod) {
            revert AgentDelinquent(agentId, delinquentSince);
        }

        // Premium is charged on the commitment, so it has to fit inside the limit alongside the
        // commitment itself — otherwise an agent could commit its exact remaining headroom and
        // be pushed over the limit by its own fee.
        uint256 premium = (amount * premiumBps) / 10_000;
        // Derived from the limit already read above rather than calling availableCredit(), which
        // would repeat every gate staticcall for the same answer.
        uint256 available = _availableAgainstLimit(agentId, limit);
        if (amount + premium > available) {
            revert InsufficientCredit(agentId, amount + premium, available);
        }

        // Solvency: idle pool liquidity must cover every outstanding commitment, this one
        // included. Principal already drawn has left the pool and is no longer idle, so it
        // correctly plays no part in this comparison.
        uint256 requiredLiquidity = totalReserved + amount;
        uint256 liquidity = POOL.availableLiquidity();
        if (requiredLiquidity > liquidity) {
            revert InsufficientPoolLiquidity(requiredLiquidity, liquidity);
        }

        reserved[agentId] += amount;
        totalReserved = requiredLiquidity;
        premiumOwed[agentId] += premium;
        emit Reserved(agentId, amount, premium);
    }

    /// @inheritdoc ICreditLine
    /// @dev The premium stays owed. It bought the facility for the duration of the job, and a
    /// clean outcome is the *expected* case — refunding it there would mean lenders only ever
    /// earn on jobs that went wrong.
    function releaseReservation(uint256 agentId, uint256 amount, bool countsAsCompletion) external onlyJobEscrow {
        if (amount == 0) revert ZeroAmount();

        uint256 currentlyReserved = reserved[agentId];
        if (amount > currentlyReserved) {
            revert InsufficientReserved(agentId, amount, currentlyReserved);
        }

        reserved[agentId] = currentlyReserved - amount;
        totalReserved -= amount;
        if (countsAsCompletion) completedJobs[agentId] += 1;
        emit ReservationReleased(agentId, amount, countsAsCompletion);
    }

    /// @inheritdoc ICreditLine
    /// @dev This is the draw-down. The pool — not the agent — pays the wronged buyer
    /// immediately, and the agent walks away owing that principal. Keeping the buyer's
    /// compensation instant is the point: they should not have to wait on an agent's
    /// creditworthiness to be made whole, which is precisely the risk the pool exists to absorb.
    /// Retains SellerBond's core safety property unchanged: a draw can only ever consume what
    /// was reserved for this job, so it is unconditionally fundable.
    function slash(uint256 agentId, uint256 amount, address recipient) external onlyJobEscrow {
        if (amount == 0) revert ZeroAmount();

        uint256 currentlyReserved = reserved[agentId];
        if (amount > currentlyReserved) {
            revert InsufficientReserved(agentId, amount, currentlyReserved);
        }

        reserved[agentId] = currentlyReserved - amount;
        totalReserved -= amount;
        principalOwed[agentId] += amount;
        // First draw of a run starts the clock; later draws don't restart it (see debtSince).
        if (debtSince[agentId] == 0) debtSince[agentId] = uint64(block.timestamp);
        emit Drawn(agentId, recipient, amount);

        POOL.fundDraw(recipient, amount);
    }

    /// @notice Repay an agent's debt. Callable by anyone — an operator, a treasury, or the
    /// agent itself — because the pool only cares that the money arrives, and requiring the
    /// agent's own key would strand debt behind a lost hot wallet.
    /// @dev Premium clears before principal. Premium is the smaller, older obligation and the
    /// part that is pure pool income; retiring it first means a partial repayment always makes
    /// the lenders whole before it reduces the agent's balance sheet.
    function repay(uint256 agentId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 premiumDue = premiumOwed[agentId];
        uint256 principalDue = principalOwed[agentId];
        uint256 owed = premiumDue + principalDue;
        if (owed == 0) revert NothingOwed(agentId);
        // Reject rather than silently refund the excess: an overpayment is an integration bug,
        // and quietly keeping or returning the difference both hide it.
        if (amount > owed) revert RepaymentExceedsDebt(agentId, amount, owed);

        uint256 premiumPaid = amount < premiumDue ? amount : premiumDue;
        uint256 principalPaid = amount - premiumPaid;

        premiumOwed[agentId] = premiumDue - premiumPaid;
        principalOwed[agentId] = principalDue - principalPaid;
        // Debt-free clears the delinquency clock, so a repaid agent borrows again on equal
        // footing. Keyed on principal only: premium never triggered the clock, so it must not
        // hold it open either.
        if (principalOwed[agentId] == 0) debtSince[agentId] = 0;
        emit Repaid(agentId, msg.sender, principalPaid, premiumPaid);

        // Tokens go straight to the pool; this contract never custodies funds. The pool then
        // books how much of the arrival retired debt versus counted as income.
        ASSET.safeTransferFrom(msg.sender, address(POOL), amount);
        POOL.recordRepayment(principalPaid, premiumPaid);
    }

    /// @notice Declare an agent's drawn principal uncollectable, passing the loss to lenders.
    /// Only after the grace period has fully elapsed on debt that is still outstanding.
    /// @dev Also zeroes the agent's job history: the earned half of its limit was a bet that
    /// past completions predict future ones, and a default is that bet losing. Verification
    /// CVI is deliberately untouched — revoking identity is Cleanverse's call, made through
    /// their own rules, and this contract has no business overriding it locally (CLAUDE.md §5).
    ///
    /// The principal does not disappear from the agent's record. It moves to `chargedOff`,
    /// which blocks all new borrowing until recovered — the pool absorbs the loss, but the
    /// borrower carries the default. Accrued `premiumOwed` is deliberately left where it is:
    /// the facility was genuinely provided, the fee is genuinely owed, and it keeps consuming
    /// headroom exactly as it did before.
    function writeOff(uint256 agentId) external onlyOwner {
        uint64 delinquentSince = debtSince[agentId];
        uint256 principal = principalOwed[agentId];
        if (principal == 0 || delinquentSince == 0 || block.timestamp <= delinquentSince + repaymentGracePeriod) {
            revert NotWriteOffEligible(agentId);
        }

        principalOwed[agentId] = 0;
        debtSince[agentId] = 0;
        completedJobs[agentId] = 0;
        chargedOff[agentId] += principal;
        emit WrittenOff(agentId, principal);

        POOL.recordWriteOff(principal);
    }

    /// @notice Pay down principal the pool has already written off, restoring the agent's
    /// ability to borrow once the balance reaches zero.
    /// @dev Separate from `repay` because the two are different events, not different sizes of
    /// the same one. `repay` retires a live receivable the pool still carries; this one arrives
    /// against a receivable the pool has already given up on, so it can only be booked as
    /// income (see CreditPool.recordRecovery). Callable by anyone, for the same reason `repay`
    /// is: an operator wanting to rehabilitate an agent must not be blocked by a lost hot
    /// wallet, and the pool only cares that the money arrives.
    ///
    /// Job history is *not* restored. Paying off a default buys back the right to borrow, not
    /// the reputation that was forfeited with it — that has to be re-earned job by job.
    function repayChargedOff(uint256 agentId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 outstanding = chargedOff[agentId];
        if (outstanding == 0) revert NothingChargedOff(agentId);
        if (amount > outstanding) revert RecoveryExceedsChargedOff(agentId, amount, outstanding);

        uint256 remaining = outstanding - amount;
        chargedOff[agentId] = remaining;
        emit ChargedOffRecovered(agentId, msg.sender, amount, remaining);

        ASSET.safeTransferFrom(msg.sender, address(POOL), amount);
        POOL.recordRecovery(amount);
    }

    /// @notice The agent's total limit: best passing credit band, plus capped job-history bonus.
    /// @dev The operator — the ERC-8004 owner of the agent NFT — is who holds the CVI, so that
    /// is the address put to the validator. This is the join between the two identity systems:
    /// ERC-8004 says which wallet controls the agent, CCP says whether that wallet is KYC'd
    /// enough to borrow.
    ///
    /// An operator passing no band scores zero and the history bonus is never added: reputation
    /// modifies a credit line, it cannot conjure one. That ordering is the whole "identity-based"
    /// claim, so it is structural here rather than a configuration choice.
    function creditLimit(uint256 agentId) public view returns (uint256) {
        // No operator, no credit. An unregistered agentId makes the registry revert, and that
        // has to resolve to a limit of zero rather than propagating: every view in this contract
        // is read by a dashboard, and a bad id should render "not eligible", not fail the page.
        // It also makes `reserve` fail with AgentNotVerified — which is what actually happened —
        // instead of an opaque error from a contract the caller never invoked.
        address operator = _operatorOf(agentId);
        if (operator == address(0)) return 0;

        // Highest passing band wins, so array order is not a correctness invariant — see
        // tierBands. Bands are few, and this is a view; the loop is not a gas concern for the
        // callers that matter.
        uint256 base;
        uint256 bandCount = tierBands.length;
        for (uint256 i = 0; i < bandCount; ++i) {
            TierBand memory band = tierBands[i];
            if (band.limit > base && _passesGate(band.gate, operator)) {
                base = band.limit;
            }
        }
        if (base == 0) return 0;

        uint256 bonus = completedJobs[agentId] * historyBonusPerJob;
        if (bonus > maxHistoryBonus) bonus = maxHistoryBonus;
        return base + bonus;
    }

    /// @dev The ERC-8004 owner of the agent NFT, or address(0) if there isn't one. Never
    /// reverts — same swallow-and-deny posture as _passesGate, and for the same reason: an
    /// unreachable registry must deny credit, not grant it or brick every view.
    function _operatorOf(uint256 agentId) internal view returns (address) {
        try IDENTITY_REGISTRY.ownerOf(agentId) returns (address operator) {
            return operator;
        } catch {
            return address(0);
        }
    }

    /// @notice Whether `operator` satisfies the CCP rules registered for `gate`.
    /// @dev Never reverts. An unregistered gate, a paused pool, or a validator that reverts
    /// outright all resolve to "does not pass" — the same swallow-and-deny posture JobEscrow
    /// uses for the Validation Registry. The failure direction matters: a broken validator must
    /// deny credit, never grant it, so this deliberately does not default open.
    function _passesGate(address gate, address operator) internal view returns (bool) {
        try VALIDATOR.complianceVerify(gate, operator) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    /// @inheritdoc ICreditLine
    /// @dev THE number every credit decision reads, the counterpart to SellerBond.bondOf. Nets
    /// out all three ways an agent's limit is already spoken for: live commitments, drawn
    /// principal, and accrued premium. Saturates at zero rather than underflowing — a limit can
    /// be *lowered* by the owner, or drop when an attestation expires, below what the agent has
    /// already committed, and that has to read as "no headroom", not revert every view that
    /// touches it.
    function availableCredit(uint256 agentId) public view returns (uint256) {
        return _availableAgainstLimit(agentId, creditLimit(agentId));
    }

    /// @dev The subtraction half of availableCredit, split out so `reserve` can reuse a limit it
    /// has already paid the gate staticcalls for.
    function _availableAgainstLimit(uint256 agentId, uint256 limit) internal view returns (uint256) {
        uint256 used = reserved[agentId] + principalOwed[agentId] + premiumOwed[agentId];
        if (used >= limit) return 0;
        return limit - used;
    }

    /// @notice Total debt an agent currently owes: drawn principal plus accrued premium.
    function totalOwed(uint256 agentId) external view returns (uint256) {
        return principalOwed[agentId] + premiumOwed[agentId];
    }

    /// @notice Replace the credit bands wholesale.
    /// @dev Wholesale rather than per-index: bands are read as a set (highest passing wins), so
    /// editing one in isolation invites a half-applied policy where a stale high band keeps
    /// granting credit a rule change was meant to withdraw.
    ///
    /// Applies to future limit reads immediately, including for agents with live commitments —
    /// availableCredit saturates rather than underflowing, precisely so shrinking a band is
    /// safe. Already-reserved commitments are untouched: JobEscrow snapshots each job's amount
    /// at creation, exactly as it did under the bond model.
    ///
    /// Gates are not checked for registration here. A gate that isn't registered simply never
    /// passes (see _passesGate), and requiring registration at set time would make the deploy
    /// ordering circular — the gates must exist on-chain before Cleanverse can register them.
    function setTierBands(TierBand[] calldata bands) external onlyOwner {
        if (bands.length == 0) revert NoTierBands();

        delete tierBands;
        for (uint256 i = 0; i < bands.length; ++i) {
            // A zero-limit band can never win the max, so it is dead configuration that reads
            // like an intentional "denied" tier. Reject it rather than let it mislead.
            if (bands[i].limit == 0) revert ZeroLimitBand();
            if (bands[i].gate == address(0)) revert ZeroAddress();
            tierBands.push(bands[i]);
        }
        emit TierBandsUpdated(bands.length);
    }

    /// @notice Set the per-job draw ceiling. 0 disables the cap.
    function setMaxDrawPerJob(uint256 newMaxDrawPerJob) external onlyOwner {
        emit MaxDrawPerJobUpdated(maxDrawPerJob, newMaxDrawPerJob);
        maxDrawPerJob = newMaxDrawPerJob;
    }

    /// @notice Number of configured credit bands.
    function tierBandCount() external view returns (uint256) {
        return tierBands.length;
    }

    /// @notice Set how much limit each completed job earns, and the ceiling on earned limit.
    function setHistoryBonus(uint256 bonusPerJob, uint256 maxBonus) external onlyOwner {
        historyBonusPerJob = bonusPerJob;
        maxHistoryBonus = maxBonus;
        emit HistoryBonusUpdated(bonusPerJob, maxBonus);
    }

    /// @notice Set the facility premium in basis points. Capped at MAX_PREMIUM_BPS. Applies to
    /// commitments made after the change; premium already accrued is fixed at its rate.
    function setPremiumBps(uint256 newPremiumBps) external onlyOwner {
        if (newPremiumBps > MAX_PREMIUM_BPS) revert PremiumTooHigh(newPremiumBps, MAX_PREMIUM_BPS);
        emit PremiumBpsUpdated(premiumBps, newPremiumBps);
        premiumBps = newPremiumBps;
    }

    /// @notice Set the repayment grace period. Capped at MAX_REPAYMENT_GRACE.
    /// @dev Unlike the snapshotted timelocks elsewhere in this codebase, this one applies
    /// retroactively to debt already outstanding — it is compared against a stored `debtSince`
    /// rather than baked into a per-job deadline. That's intentional: grace is a live risk
    /// parameter over the whole book, and freezing it per-debt would leave a compromised or
    /// simply mis-set value un-fixable for existing borrowers.
    function setRepaymentGracePeriod(uint64 newGracePeriod) external onlyOwner {
        if (newGracePeriod > MAX_REPAYMENT_GRACE) {
            revert GracePeriodTooLong(newGracePeriod, MAX_REPAYMENT_GRACE);
        }
        emit RepaymentGracePeriodUpdated(repaymentGracePeriod, newGracePeriod);
        repaymentGracePeriod = newGracePeriod;
    }

    /// @notice Hand over contract ownership (risk-parameter and write-off rights).
    function setOwner(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, owner_);
        owner = owner_;
    }
}
