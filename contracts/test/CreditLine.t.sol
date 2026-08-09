// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {CreditPool} from "../src/CreditPool.sol";
import {CreditTierGate} from "../src/CreditTierGate.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockApassComplianceValidator} from "./mocks/MockApassComplianceValidator.sol";

/// @title CreditLineTest — limit sizing, the debt lifecycle, and the identity gate itself
/// @notice JobEscrow's suite exercises CreditLine incidentally, through the paths a job takes.
/// This one goes at it directly, and covers what a job never reaches: repayment ordering,
/// write-off eligibility, the default record, delinquency blocking, premium accrual, the per-job
/// cap, and how the CCP validator's answer turns into a number.
///
/// The test contract is CreditLine's `jobEscrow_`, so it can call the escrow-only entry points
/// (`reserve`, `releaseReservation`, `slash`) without standing up an escrow. Three real
/// CreditTierGates back three bands, and the mock validator decides which of them an operator
/// passes — the same shape as the live system, where those verdicts come from Cleanverse.
contract CreditLineTest is Test {
    MockUSDC internal usdc;
    MockIdentityRegistry internal registry;
    MockApassComplianceValidator internal validator;
    CreditTierGate internal band1;
    CreditTierGate internal band2;
    CreditTierGate internal band3;
    CreditPool internal pool;
    CreditLine internal line;

    address internal operator = makeAddr("operator");
    address internal lender = makeAddr("lender");
    address internal recipient = makeAddr("recipient");
    address internal payer = makeAddr("payer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AGENT = 1;
    uint256 internal constant UNKNOWN_AGENT = 999;

    uint256 internal constant BAND_1 = 500e6;
    uint256 internal constant BAND_2 = 2_500e6;
    uint256 internal constant BAND_3 = 10_000e6;
    uint256 internal constant POOL_LIQUIDITY = 50_000e6;

    event Reserved(uint256 indexed agentId, uint256 amount, uint256 premium);
    event ReservationReleased(uint256 indexed agentId, uint256 amount, bool countsAsCompletion);
    event Drawn(uint256 indexed agentId, address indexed recipient, uint256 amount);
    event Repaid(uint256 indexed agentId, address indexed payer, uint256 principal, uint256 premium);
    event WrittenOff(uint256 indexed agentId, uint256 principal);
    event ChargedOffRecovered(uint256 indexed agentId, address indexed payer, uint256 amount, uint256 remaining);

    function setUp() public {
        usdc = new MockUSDC();
        registry = new MockIdentityRegistry();
        validator = new MockApassComplianceValidator();
        band1 = new CreditTierGate("band-1", address(this));
        band2 = new CreditTierGate("band-2", address(this));
        band3 = new CreditTierGate("band-3", address(this));
        pool = new CreditPool(address(usdc));
        line = new CreditLine(address(usdc), address(registry), address(validator), address(pool), address(this));
        pool.setCreditLine(address(line));

        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](3);
        bands[0] = CreditLine.TierBand({gate: address(band1), limit: BAND_1});
        bands[1] = CreditLine.TierBand({gate: address(band2), limit: BAND_2});
        bands[2] = CreditLine.TierBand({gate: address(band3), limit: BAND_3});
        line.setTierBands(bands);
        line.setPremiumBps(0);

        registry.setAgentOwner(AGENT, operator);
        validator.setCompliant(address(band1), operator, true);

        usdc.mint(lender, POOL_LIQUIDITY);
        vm.startPrank(lender);
        usdc.approve(address(pool), type(uint256).max);
        pool.deposit(POOL_LIQUIDITY);
        vm.stopPrank();
    }

    function _repayFrom(address who, uint256 agentId, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(line), amount);
        line.repay(agentId, amount);
        vm.stopPrank();
    }

    /// Drive an agent into default: draw, let the grace period lapse, write it off.
    function _defaultAgent(uint256 amount) internal {
        line.reserve(AGENT, amount);
        line.slash(AGENT, amount, recipient);
        vm.warp(block.timestamp + 8 days);
        line.writeOff(AGENT);
    }

    // -------------------------------------------------------- the identity gate

    /// The core claim: the limit is whatever Cleanverse's validator says it is, and nothing else.
    function test_LimitIsTheHighestPassingBand() public {
        assertEq(line.creditLimit(AGENT), BAND_1);

        validator.setCompliant(address(band3), operator, true);
        assertEq(line.creditLimit(AGENT), BAND_3, "highest passing band wins");
    }

    /// Band order in the array carries no meaning — passing a lower band later must not lower
    /// the limit already established by a higher one.
    function test_BandOrderDoesNotMatter() public {
        validator.setCompliant(address(band3), operator, true);
        validator.setCompliant(address(band2), operator, true);
        assertEq(line.creditLimit(AGENT), BAND_3);
    }

    function test_OperatorPassingNoBandHasNoCredit() public {
        validator.setCompliant(address(band1), operator, false);
        assertEq(line.creditLimit(AGENT), 0);
        assertEq(line.availableCredit(AGENT), 0);
    }

    /// Identity first, reputation second: history never conjures a limit out of nothing.
    function test_HistoryBonusIsNotAddedWithoutAPassingBand() public {
        line.setHistoryBonus(100e6, 5_000e6);
        line.reserve(AGENT, 100e6);
        line.releaseReservation(AGENT, 100e6, true);
        assertEq(line.completedJobs(AGENT), 1);

        validator.setCompliant(address(band1), operator, false);
        assertEq(line.creditLimit(AGENT), 0, "a completed job is worth nothing without identity");
    }

    /// Fail closed. A validator that reverts — an unregistered gate, a paused pool returning
    /// 12027, an outage — must deny credit, never grant it.
    function test_RevertingValidatorDeniesCredit() public {
        validator.setReverting(address(band1), true);
        assertEq(line.creditLimit(AGENT), 0);

        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentNotVerified.selector, AGENT));
        line.reserve(AGENT, 100e6);
    }

    /// Regression: an unregistered agentId used to propagate the registry's revert out of every
    /// view, breaking dashboard reads and masking the real reason a reservation failed.
    function test_UnknownAgentReadsAsZeroRatherThanReverting() public view {
        assertEq(line.creditLimit(UNKNOWN_AGENT), 0);
        assertEq(line.availableCredit(UNKNOWN_AGENT), 0);
    }

    function test_RevertWhen_ReservingForUnknownAgent() public {
        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentNotVerified.selector, UNKNOWN_AGENT));
        line.reserve(UNKNOWN_AGENT, 100e6);
    }

    /// The limit follows the agent's current operator, because that is who holds the CVI.
    function test_LimitFollowsTheAgentsOperator() public {
        address newOperator = makeAddr("newOperator");
        registry.setAgentOwner(AGENT, newOperator);
        assertEq(line.creditLimit(AGENT), 0, "the new operator passes no band");

        validator.setCompliant(address(band2), newOperator, true);
        assertEq(line.creditLimit(AGENT), BAND_2);
    }

    // ------------------------------------------------------------ history bonus

    function test_CompletedJobsRaiseTheLimitUpToTheCap() public {
        line.setHistoryBonus(100e6, 250e6);

        for (uint256 i = 0; i < 2; ++i) {
            line.reserve(AGENT, 50e6);
            line.releaseReservation(AGENT, 50e6, true);
        }
        assertEq(line.creditLimit(AGENT), BAND_1 + 200e6);

        for (uint256 i = 0; i < 5; ++i) {
            line.reserve(AGENT, 50e6);
            line.releaseReservation(AGENT, 50e6, true);
        }
        assertEq(line.creditLimit(AGENT), BAND_1 + 250e6, "bonus is capped");
    }

    /// A timeout pays the seller but vouches for nothing, so it must not grow the line —
    /// otherwise farming a limit is as cheap as running jobs against a silent buyer you control.
    function test_NonCompletionDoesNotRaiseTheLimit() public {
        line.setHistoryBonus(100e6, 5_000e6);
        line.reserve(AGENT, 50e6);
        line.releaseReservation(AGENT, 50e6, false);

        assertEq(line.completedJobs(AGENT), 0);
        assertEq(line.creditLimit(AGENT), BAND_1);
    }

    // ---------------------------------------------------------------- reserve

    function test_ReserveConsumesHeadroomAndEmits() public {
        vm.expectEmit(true, false, false, true, address(line));
        emit Reserved(AGENT, 100e6, 0);
        line.reserve(AGENT, 100e6);

        assertEq(line.reserved(AGENT), 100e6);
        assertEq(line.totalReserved(), 100e6);
        assertEq(line.availableCredit(AGENT), BAND_1 - 100e6);
    }

    function test_RevertWhen_ReserveZero() public {
        vm.expectRevert(CreditLine.ZeroAmount.selector);
        line.reserve(AGENT, 0);
    }

    function test_RevertWhen_ReserveNotJobEscrow() public {
        vm.expectRevert(CreditLine.NotJobEscrow.selector);
        vm.prank(stranger);
        line.reserve(AGENT, 100e6);
    }

    function test_RevertWhen_ReserveExceedsHeadroom() public {
        line.reserve(AGENT, 400e6);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.InsufficientCredit.selector, AGENT, 200e6, 100e6));
        line.reserve(AGENT, 200e6);
    }

    /// The pool must never promise more credit than it can actually fund.
    function test_RevertWhen_PoolCannotBackTheCommitment() public {
        validator.setCompliant(address(band3), operator, true);
        // Withdraw everything so the pool cannot back a new commitment.
        uint256 shares = pool.sharesOf(lender);
        vm.prank(lender);
        pool.withdraw(shares);

        vm.expectRevert(abi.encodeWithSelector(CreditLine.InsufficientPoolLiquidity.selector, 100e6, 0));
        line.reserve(AGENT, 100e6);
    }

    // ------------------------------------------------------------ maxDrawPerJob

    function test_MaxDrawPerJobCapsASingleCommitment() public {
        validator.setCompliant(address(band3), operator, true);
        line.setMaxDrawPerJob(1_000e6);

        vm.expectRevert(abi.encodeWithSelector(CreditLine.MandateExceeded.selector, AGENT, 1_001e6, 1_000e6));
        line.reserve(AGENT, 1_001e6);

        line.reserve(AGENT, 1_000e6);
        assertEq(line.reserved(AGENT), 1_000e6);
    }

    function test_MaxDrawPerJobZeroDisablesTheCap() public {
        validator.setCompliant(address(band3), operator, true);
        line.setMaxDrawPerJob(0);
        line.reserve(AGENT, BAND_3);
        assertEq(line.reserved(AGENT), BAND_3);
    }

    // ----------------------------------------------------------------- premium

    function test_PremiumAccruesAtReservationAndSurvivesARelease() public {
        line.setPremiumBps(100); // 1%
        line.reserve(AGENT, 100e6);
        assertEq(line.premiumOwed(AGENT), 1e6);

        line.releaseReservation(AGENT, 100e6, true);
        assertEq(line.premiumOwed(AGENT), 1e6, "a clean job still owes the facility fee");
        assertEq(line.availableCredit(AGENT), BAND_1 - 1e6);
    }

    /// The fee has to fit inside the limit alongside the commitment, or an agent could commit
    /// its exact headroom and be pushed over by its own premium.
    function test_PremiumIsCountedAgainstTheLimit() public {
        line.setPremiumBps(1_000); // 10%
        vm.expectRevert(abi.encodeWithSelector(CreditLine.InsufficientCredit.selector, AGENT, 550e6, BAND_1));
        line.reserve(AGENT, BAND_1);
    }

    function test_RevertWhen_PremiumAboveMax() public {
        vm.expectRevert(abi.encodeWithSelector(CreditLine.PremiumTooHigh.selector, 1_001, 1_000));
        line.setPremiumBps(1_001);
    }

    // -------------------------------------------------------------------- slash

    function test_SlashPaysRecipientAndBooksDebt() public {
        line.reserve(AGENT, 100e6);

        vm.expectEmit(true, true, false, true, address(line));
        emit Drawn(AGENT, recipient, 100e6);
        line.slash(AGENT, 100e6, recipient);

        assertEq(usdc.balanceOf(recipient), 100e6, "the wronged party is paid immediately");
        assertEq(line.principalOwed(AGENT), 100e6);
        assertEq(line.reserved(AGENT), 0);
        assertEq(line.totalReserved(), 0);
        assertEq(line.debtSince(AGENT), uint64(block.timestamp));
    }

    /// A draw can only ever consume what was reserved for that job — the property inherited
    /// unchanged from SellerBond, and what makes every draw unconditionally fundable.
    function test_RevertWhen_SlashExceedsReserved() public {
        line.reserve(AGENT, 100e6);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.InsufficientReserved.selector, AGENT, 101e6, 100e6));
        line.slash(AGENT, 101e6, recipient);
    }

    /// Taking on more debt must not reset the delinquency clock.
    function test_SecondDrawDoesNotRestartTheClock() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        uint64 first = line.debtSince(AGENT);

        vm.warp(block.timestamp + 1 days);
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);

        assertEq(line.debtSince(AGENT), first, "the clock still runs from the first draw");
    }

    // ------------------------------------------------------------- delinquency

    function test_OverdueDebtBlocksNewCommitments() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        uint64 since = line.debtSince(AGENT);

        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentDelinquent.selector, AGENT, since));
        line.reserve(AGENT, 50e6);
    }

    function test_DebtWithinGraceDoesNotBlock() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);

        vm.warp(block.timestamp + 6 days);
        line.reserve(AGENT, 50e6);
        assertEq(line.reserved(AGENT), 50e6);
    }

    function test_RepayingClearsDelinquency() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        vm.warp(block.timestamp + 8 days);

        _repayFrom(payer, AGENT, 100e6);
        assertEq(line.debtSince(AGENT), 0);
        line.reserve(AGENT, 50e6);
    }

    // ------------------------------------------------------------------- repay

    /// Premium clears before principal, so a partial payment makes lenders whole first.
    function test_RepaymentRetiresPremiumBeforePrincipal() public {
        line.setPremiumBps(1_000); // 10%
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        assertEq(line.premiumOwed(AGENT), 10e6);
        assertEq(line.principalOwed(AGENT), 100e6);

        _repayFrom(payer, AGENT, 15e6);
        assertEq(line.premiumOwed(AGENT), 0, "premium first");
        assertEq(line.principalOwed(AGENT), 95e6);
        assertEq(line.debtSince(AGENT), uint64(block.timestamp) - 0, "still carrying principal");
    }

    function test_AnyoneMayRepayOnAnAgentsBehalf() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);

        usdc.mint(stranger, 100e6);
        vm.startPrank(stranger);
        usdc.approve(address(line), 100e6);
        vm.expectEmit(true, true, false, true, address(line));
        emit Repaid(AGENT, stranger, 100e6, 0);
        line.repay(AGENT, 100e6);
        vm.stopPrank();

        assertEq(line.totalOwed(AGENT), 0);
    }

    function test_RevertWhen_RepayingMoreThanOwed() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);

        usdc.mint(payer, 200e6);
        vm.startPrank(payer);
        usdc.approve(address(line), 200e6);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.RepaymentExceedsDebt.selector, AGENT, 101e6, 100e6));
        line.repay(AGENT, 101e6);
        vm.stopPrank();
    }

    function test_RevertWhen_RepayingNothingOwed() public {
        vm.expectRevert(abi.encodeWithSelector(CreditLine.NothingOwed.selector, AGENT));
        line.repay(AGENT, 1e6);
    }

    function test_RevertWhen_RepayZero() public {
        vm.expectRevert(CreditLine.ZeroAmount.selector);
        line.repay(AGENT, 0);
    }

    // ---------------------------------------------------------------- writeOff

    function test_WriteOffClearsDebtAndRecordsTheDefault() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        vm.warp(block.timestamp + 8 days);

        vm.expectEmit(true, false, false, true, address(line));
        emit WrittenOff(AGENT, 100e6);
        line.writeOff(AGENT);

        assertEq(line.principalOwed(AGENT), 0);
        assertEq(line.debtSince(AGENT), 0);
        assertEq(line.completedJobs(AGENT), 0, "forfeited history");
        assertEq(line.chargedOff(AGENT), 100e6, "the default is on the record");
    }

    function test_RevertWhen_WriteOffBeforeGraceElapses() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        vm.warp(block.timestamp + 6 days);

        vm.expectRevert(abi.encodeWithSelector(CreditLine.NotWriteOffEligible.selector, AGENT));
        line.writeOff(AGENT);
    }

    function test_RevertWhen_WriteOffWithNoDebt() public {
        vm.expectRevert(abi.encodeWithSelector(CreditLine.NotWriteOffEligible.selector, AGENT));
        line.writeOff(AGENT);
    }

    function test_RevertWhen_WriteOffNotOwner() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        vm.warp(block.timestamp + 8 days);

        vm.expectRevert(CreditLine.NotOwner.selector);
        vm.prank(stranger);
        line.writeOff(AGENT);
    }

    // ------------------------------------------------------------- charge-off

    /// Regression: a written-off agent used to get its full line back immediately, making
    /// borrow-default-repeat the cheapest strategy available to it.
    function test_DefaultBlocksAllFutureBorrowing() public {
        _defaultAgent(100e6);

        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentChargedOff.selector, AGENT, 100e6));
        line.reserve(AGENT, 50e6);
    }

    /// The block outlives a higher tier: passing a better band does not buy off a default.
    function test_DefaultBlocksEvenAfterATierUpgrade() public {
        _defaultAgent(100e6);
        validator.setCompliant(address(band3), operator, true);

        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentChargedOff.selector, AGENT, 100e6));
        line.reserve(AGENT, 50e6);
    }

    function test_RecoveringInFullRestoresBorrowing() public {
        _defaultAgent(100e6);

        usdc.mint(payer, 100e6);
        vm.startPrank(payer);
        usdc.approve(address(line), 100e6);
        vm.expectEmit(true, true, false, true, address(line));
        emit ChargedOffRecovered(AGENT, payer, 100e6, 0);
        line.repayChargedOff(AGENT, 100e6);
        vm.stopPrank();

        assertEq(line.chargedOff(AGENT), 0);
        line.reserve(AGENT, 50e6);
        assertEq(line.reserved(AGENT), 50e6);
    }

    function test_PartialRecoveryStillBlocks() public {
        _defaultAgent(100e6);

        usdc.mint(payer, 40e6);
        vm.startPrank(payer);
        usdc.approve(address(line), 40e6);
        line.repayChargedOff(AGENT, 40e6);
        vm.stopPrank();

        assertEq(line.chargedOff(AGENT), 60e6);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentChargedOff.selector, AGENT, 60e6));
        line.reserve(AGENT, 10e6);
    }

    /// Paying off a default buys back the right to borrow, not the reputation forfeited with it.
    function test_RecoveryDoesNotRestoreJobHistory() public {
        line.setHistoryBonus(100e6, 5_000e6);
        line.reserve(AGENT, 50e6);
        line.releaseReservation(AGENT, 50e6, true);
        assertEq(line.creditLimit(AGENT), BAND_1 + 100e6);

        _defaultAgent(100e6);
        usdc.mint(payer, 100e6);
        vm.startPrank(payer);
        usdc.approve(address(line), 100e6);
        line.repayChargedOff(AGENT, 100e6);
        vm.stopPrank();

        assertEq(line.completedJobs(AGENT), 0);
        assertEq(line.creditLimit(AGENT), BAND_1, "history has to be re-earned");
    }

    function test_RevertWhen_RecoveringMoreThanChargedOff() public {
        _defaultAgent(100e6);
        usdc.mint(payer, 200e6);
        vm.startPrank(payer);
        usdc.approve(address(line), 200e6);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.RecoveryExceedsChargedOff.selector, AGENT, 101e6, 100e6));
        line.repayChargedOff(AGENT, 101e6);
        vm.stopPrank();
    }

    function test_RevertWhen_RecoveringWithNothingChargedOff() public {
        vm.expectRevert(abi.encodeWithSelector(CreditLine.NothingChargedOff.selector, AGENT));
        line.repayChargedOff(AGENT, 1e6);
    }

    function test_RevertWhen_RecoverZero() public {
        vm.expectRevert(CreditLine.ZeroAmount.selector);
        line.repayChargedOff(AGENT, 0);
    }

    // ------------------------------------------------------------- availability

    /// A limit lowered below what is already committed must read as "no headroom", not revert.
    function test_AvailableCreditSaturatesAtZero() public {
        line.reserve(AGENT, 400e6);

        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](1);
        bands[0] = CreditLine.TierBand({gate: address(band1), limit: 100e6});
        line.setTierBands(bands);

        assertEq(line.availableCredit(AGENT), 0);
    }

    // ----------------------------------------------------------------- setters

    function test_RevertWhen_SetTierBandsEmpty() public {
        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](0);
        vm.expectRevert(CreditLine.NoTierBands.selector);
        line.setTierBands(bands);
    }

    function test_RevertWhen_SetTierBandsWithZeroLimit() public {
        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](1);
        bands[0] = CreditLine.TierBand({gate: address(band1), limit: 0});
        vm.expectRevert(CreditLine.ZeroLimitBand.selector);
        line.setTierBands(bands);
    }

    function test_RevertWhen_SetTierBandsWithZeroGate() public {
        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](1);
        bands[0] = CreditLine.TierBand({gate: address(0), limit: 100e6});
        vm.expectRevert(CreditLine.ZeroAddress.selector);
        line.setTierBands(bands);
    }

    function test_SetTierBandsReplacesWholesale() public {
        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](1);
        bands[0] = CreditLine.TierBand({gate: address(band1), limit: 750e6});
        line.setTierBands(bands);

        assertEq(line.tierBandCount(), 1);
        assertEq(line.creditLimit(AGENT), 750e6);
    }

    function test_RevertWhen_GracePeriodAboveMax() public {
        vm.expectRevert(
            abi.encodeWithSelector(CreditLine.GracePeriodTooLong.selector, uint64(31 days), uint64(30 days))
        );
        line.setRepaymentGracePeriod(31 days);
    }

    function test_GracePeriodAppliesRetroactively() public {
        line.reserve(AGENT, 100e6);
        line.slash(AGENT, 100e6, recipient);
        vm.warp(block.timestamp + 6 days);

        // Not delinquent under the default 7-day grace; shortening it makes it so immediately.
        line.setRepaymentGracePeriod(1 days);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentDelinquent.selector, AGENT, line.debtSince(AGENT)));
        line.reserve(AGENT, 10e6);
    }

    function test_RevertWhen_SettersNotOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(CreditLine.NotOwner.selector);
        line.setMaxDrawPerJob(1);
        vm.expectRevert(CreditLine.NotOwner.selector);
        line.setHistoryBonus(1, 1);
        vm.expectRevert(CreditLine.NotOwner.selector);
        line.setPremiumBps(1);
        vm.expectRevert(CreditLine.NotOwner.selector);
        line.setRepaymentGracePeriod(1);
        vm.expectRevert(CreditLine.NotOwner.selector);
        line.setOwner(stranger);
        vm.stopPrank();
    }

    function test_SetOwnerTransfersRights() public {
        line.setOwner(stranger);
        assertEq(line.owner(), stranger);
        vm.expectRevert(CreditLine.NotOwner.selector);
        line.setMaxDrawPerJob(1);
    }

    // ------------------------------------------------------------- constructor

    function test_RevertWhen_ConstructedWithAnyZeroAddress() public {
        address a = address(usdc);
        vm.expectRevert(CreditLine.ZeroAddress.selector);
        new CreditLine(address(0), a, a, a, a);
        vm.expectRevert(CreditLine.ZeroAddress.selector);
        new CreditLine(a, address(0), a, a, a);
        vm.expectRevert(CreditLine.ZeroAddress.selector);
        new CreditLine(a, a, address(0), a, a);
        vm.expectRevert(CreditLine.ZeroAddress.selector);
        new CreditLine(a, a, a, address(0), a);
        vm.expectRevert(CreditLine.ZeroAddress.selector);
        new CreditLine(a, a, a, a, address(0));
    }
}
