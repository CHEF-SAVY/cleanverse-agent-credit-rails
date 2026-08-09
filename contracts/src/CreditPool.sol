// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICreditLine} from "./interfaces/ICreditLine.sol";
import {ICreditPool} from "./interfaces/ICreditPool.sol";

/// @title CreditPool — the A-Token-denominated lending pool agents borrow against
/// @notice Lenders deposit the pool asset and receive shares in the pool. CreditLine draws against that
/// liquidity when a verified agent's job goes bad, and repayments (plus premiums) flow back
/// here. Share price is `totalAssets / totalShares`, so premium income lifts it and written-off
/// defaults sink it — lenders take real credit risk, which is what makes this a credit pool
/// rather than an escrow.
///
/// This is where the Tripwire model actually inverts. Under SellerBond a seller locked 100% of
/// their own money and the protocol never had exposure. Here the seller locks nothing, the pool
/// stands behind them up to a A-Pass-sized limit, and the pool's lenders are the ones underwriting
/// that limit.
///
/// Two invariants hold the pool together, and both are enforced rather than assumed:
///   1. `idle liquidity >= CreditLine.totalReserved()` — every live commitment is fundable at
///      the moment it is called on. Reservation checks it going in; `withdraw` is what keeps it
///      true afterwards, by refusing to pay out liquidity that is already spoken for.
///   2. `totalAssets = idle + totalPrincipalOutstanding` — drawing moves value between the two
///      terms without changing the sum, repayment raises it by the premium, write-off lowers it.
contract CreditPool is ICreditPool, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- state

    /// @notice The pool's asset — a Cleanverse A-Token. Held as a plain IERC20 rather than a A-Token-specific type
    /// so the contract is testable against any ERC-20 mock and can't drift if the A-Token's own
    /// interface has extras we don't need.
    IERC20 public immutable ASSET;

    address public owner;
    /// @notice The only address allowed to move pool funds via fundDraw. Settable exactly once
    /// (see setCreditLine) — resolves the circular deploy dependency the same way JobEscrow's
    /// setSellerBond did: the pool deploys first, CreditLine deploys with the pool's address
    /// baked in as immutable, then this completes the wiring.
    address public creditLine;

    /// @notice Total pool shares outstanding. Not an ERC-20 — shares are non-transferable
    /// balances tracked here (see docs/plans, "Known cuts": tokenized LP shares deferred).
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    /// @notice Principal currently drawn and not yet repaid or written off. Counted as a pool
    /// asset: lenders own the receivable, not just the idle cash.
    uint256 public totalPrincipalOutstanding;

    /// @notice Virtual offset applied to both sides of every share conversion. Standard
    /// ERC-4626 inflation-attack mitigation: without it, a first depositor can mint 1 wei of
    /// shares, donate a large balance directly to the pool, and make every subsequent
    /// depositor's shares round down to zero. The +1 makes that attack cost more than it
    /// yields, in one line and with no dead-shares bookkeeping.
    uint256 private constant VIRTUAL_OFFSET = 1;

    // ---------------------------------------------------------------- events

    event Deposited(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event DrawFunded(address indexed recipient, uint256 amount);
    event RepaymentRecorded(uint256 principal, uint256 premium);
    event WriteOffRecorded(uint256 principal);
    event RecoveryRecorded(uint256 amount);
    event CreditLineSet(address creditLine);
    event OwnerUpdated(address previous, address current);

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error NotCreditLine();
    error ZeroAddress();
    error ZeroAmount();
    error CreditLineAlreadySet();
    error InsufficientShares(address lender, uint256 requested, uint256 held);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error InsufficientPrincipalOutstanding(uint256 requested, uint256 outstanding);
    /// @notice A deposit priced to zero shares, or a withdrawal priced to zero assets. Both
    /// mean the caller would pay or burn something for nothing, which is never what they meant.
    error ZeroShares();
    error ZeroAssets();
    /// @notice The withdrawal is covered by the pool's raw balance but not by the part of it
    /// that isn't already committed to live jobs. Distinct from InsufficientLiquidity so the UI
    /// can say "X is committed to open jobs" rather than "the pool is empty" — operationally
    /// these are very different states.
    error LiquidityEncumbered(uint256 requested, uint256 withdrawable, uint256 committed);

    // ------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier onlyCreditLine() {
        _checkCreditLine();
        _;
    }

    /// @dev See onlyOwner — kept out of the modifier so it isn't duplicated into every use
    /// site's bytecode (forge lint's unwrapped-modifier-logic rule).
    function _checkOwner() internal view {
        if (msg.sender != owner) revert NotOwner();
    }

    /// @dev See onlyCreditLine.
    function _checkCreditLine() internal view {
        if (msg.sender != creditLine) revert NotCreditLine();
    }

    // ----------------------------------------------------------- constructor

    constructor(address asset_) {
        if (asset_ == address(0)) revert ZeroAddress();
        ASSET = IERC20(asset_);
        owner = msg.sender;
    }

    // ------------------------------------------------------------- functions

    /// @notice One-time wiring of the CreditLine address, completing the two-step deploy.
    /// Reverts if already set — meant to be immutable in practice, just not in the Solidity
    /// keyword sense, since it isn't known at construction.
    function setCreditLine(address creditLine_) external onlyOwner {
        if (creditLine != address(0)) revert CreditLineAlreadySet();
        if (creditLine_ == address(0)) revert ZeroAddress();
        creditLine = creditLine_;
        emit CreditLineSet(creditLine_);
    }

    /// @notice Lend to the pool: pulls `assets` from the caller and mints shares at the
    /// current share price.
    /// @dev Caller must `approve` this contract for at least `assets` first. Shares are
    /// computed *before* the transfer lands, so the conversion uses the pre-deposit share
    /// price — otherwise a depositor would price their own deposit into the denominator and
    /// mint themselves fewer shares than they paid for.
    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();

        shares = convertToShares(assets);
        // Rounding down can price a small deposit into a high-share-price pool at zero shares —
        // which would take the lender's assets and hand back nothing. Reject instead: the
        // deposit is too small to be represented, and that is the depositor's problem to fix,
        // not the pool's to silently pocket.
        if (shares == 0) revert ZeroShares();

        totalShares += shares;
        sharesOf[msg.sender] += shares;
        emit Deposited(msg.sender, assets, shares);

        ASSET.safeTransferFrom(msg.sender, address(this), assets);
    }

    /// @notice Burn `shares` and take the corresponding assets out.
    /// @dev Bounded by *unencumbered* liquidity, not by total assets and not by the raw balance
    /// either. Two separate deductions, for two separate reasons:
    ///
    ///   - Principal already drawn against live jobs is a receivable, not cash. Paying it out
    ///     would let one lender exit at the others' expense.
    ///   - Idle balance backing an open commitment is cash the pool has *promised*. CreditLine
    ///     only admits a commitment it can fund (`reserve` checks liquidity going in), but that
    ///     check is worthless if a lender may withdraw the backing a block later. Without this
    ///     deduction a lender could exit in full mid-job, and the resulting `slash` would revert
    ///     inside `resolveDispute` — leaving the disputed job permanently stuck, since Disputed
    ///     has no timeout path, with the buyer's escrow frozen alongside it.
    ///
    /// A fully-utilized pool therefore refuses withdrawals until commitments clear or repayments
    /// land — normal lending-pool behavior, surfaced as its own error so the UI can say "pool at
    /// full utilization" rather than a generic failure.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();

        uint256 held = sharesOf[msg.sender];
        if (shares > held) revert InsufficientShares(msg.sender, shares, held);

        assets = convertToAssets(shares);
        // Same rationale as deposit's ZeroShares: burning shares for nothing is never intended.
        if (assets == 0) revert ZeroAssets();

        uint256 liquidity = ASSET.balanceOf(address(this));
        if (assets > liquidity) revert InsufficientLiquidity(assets, liquidity);
        uint256 committed = committedLiquidity();
        // Saturating, not a bare subtraction: the invariant says liquidity >= committed, but a
        // panic-revert here would report a broken invariant as an unreadable arithmetic error.
        uint256 withdrawable = liquidity > committed ? liquidity - committed : 0;
        if (assets > withdrawable) revert LiquidityEncumbered(assets, withdrawable, committed);

        // Effects before the token interaction, as everywhere else in this codebase.
        sharesOf[msg.sender] = held - shares;
        totalShares -= shares;
        emit Withdrawn(msg.sender, assets, shares);

        ASSET.safeTransfer(msg.sender, assets);
    }

    /// @inheritdoc ICreditPool
    /// @dev The receivable is booked before the transfer so a failed transfer rolls the whole
    /// draw back atomically — the pool can never be left having paid out without recording the
    /// debt, which would silently gift the drawn amount to the recipient at lenders' expense.
    function fundDraw(address recipient, uint256 amount) external onlyCreditLine nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 liquidity = ASSET.balanceOf(address(this));
        if (amount > liquidity) revert InsufficientLiquidity(amount, liquidity);

        totalPrincipalOutstanding += amount;
        emit DrawFunded(recipient, amount);

        ASSET.safeTransfer(recipient, amount);
    }

    /// @inheritdoc ICreditPool
    /// @dev Accounting only — CreditLine has already transferred the tokens to this contract,
    /// so the assets are here either way; this call decides how much of the arrival retires
    /// debt versus counts as income. `premium` needs no bookkeeping of its own: it raises the
    /// pool's balance without raising `totalPrincipalOutstanding`, which is exactly what
    /// lifting the share price means.
    function recordRepayment(uint256 principal, uint256 premium) external onlyCreditLine {
        if (principal > totalPrincipalOutstanding) {
            revert InsufficientPrincipalOutstanding(principal, totalPrincipalOutstanding);
        }

        totalPrincipalOutstanding -= principal;
        emit RepaymentRecorded(principal, premium);
    }

    /// @inheritdoc ICreditPool
    /// @dev Drops the receivable with no offsetting cash arrival, so totalAssets falls and
    /// every lender's share is worth proportionally less. Deliberately not a "loss reserve" or
    /// socialized-over-time mechanism: the write-off is immediate and visible, because a credit
    /// pool that hides its defaults is worse than one that has them.
    function recordWriteOff(uint256 principal) external onlyCreditLine {
        if (principal == 0) revert ZeroAmount();
        if (principal > totalPrincipalOutstanding) {
            revert InsufficientPrincipalOutstanding(principal, totalPrincipalOutstanding);
        }

        totalPrincipalOutstanding -= principal;
        emit WriteOffRecorded(principal);
    }

    /// @inheritdoc ICreditPool
    /// @dev Money arriving on a debt the pool already gave up on. It cannot retire
    /// `totalPrincipalOutstanding` — the write-off removed that receivable — so it lands purely
    /// as an increase in the balance, lifting the share price back toward where it was. Booked
    /// under its own event rather than as a repayment: "we recovered a default" and "a borrower
    /// paid on time" are the same cash movement and completely different facts about the book,
    /// and a pool that reports them identically can't be audited.
    function recordRecovery(uint256 amount) external onlyCreditLine {
        if (amount == 0) revert ZeroAmount();
        emit RecoveryRecorded(amount);
    }

    /// @notice Hand over contract ownership (CreditLine wiring rights).
    function setOwner(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, owner_);
        owner = owner_;
    }

    /// @notice Everything the pool owns: idle assets plus principal currently drawn.
    /// @dev Reading the live token balance (rather than tracking deposits in a counter) means a
    /// direct token donation to the pool simply becomes lender yield instead of being stranded
    /// — and it's the balance the withdrawal path checks anyway, so the two can't disagree.
    function totalAssets() public view returns (uint256) {
        return ASSET.balanceOf(address(this)) + totalPrincipalOutstanding;
    }

    /// @inheritdoc ICreditPool
    function availableLiquidity() public view returns (uint256) {
        return ASSET.balanceOf(address(this));
    }

    /// @notice Idle assets already promised to open commitments, and so not withdrawable.
    /// @dev Read live from CreditLine rather than mirrored into a counter here. A mirror would
    /// be a second source of truth for the same number, kept in sync by hand across four call
    /// sites — exactly the kind of drift that makes a solvency invariant quietly stop holding.
    /// Returns 0 before wiring is complete, when there is by definition nothing committed.
    function committedLiquidity() public view returns (uint256) {
        if (creditLine == address(0)) return 0;
        return ICreditLine(creditLine).totalReserved();
    }

    /// @notice What a lender can actually take out right now: idle assets less the part
    /// backing open commitments. Saturates at zero — commitments are admitted against
    /// liquidity at reservation time, but a write-off can shrink the balance afterwards, and
    /// that must read as "nothing withdrawable", not underflow every view that touches it.
    function withdrawableLiquidity() external view returns (uint256) {
        uint256 liquidity = availableLiquidity();
        uint256 committed = committedLiquidity();
        return liquidity > committed ? liquidity - committed : 0;
    }

    /// @notice Shares that `assets` would mint at the current price. Rounds down (favours the
    /// pool, i.e. existing lenders).
    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * (totalShares + VIRTUAL_OFFSET)) / (totalAssets() + VIRTUAL_OFFSET);
    }

    /// @notice Assets that `shares` are currently worth. Rounds down, same rationale.
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * (totalAssets() + VIRTUAL_OFFSET)) / (totalShares + VIRTUAL_OFFSET);
    }
}
