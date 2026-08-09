// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {CreditPool} from "../src/CreditPool.sol";
import {CreditTierGate} from "../src/CreditTierGate.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockApassComplianceValidator} from "./mocks/MockApassComplianceValidator.sol";

/// @title CreditPoolTest — lender-side accounting, share pricing, and the solvency invariant
/// @notice The pool is where lenders' money actually lives, so the properties under test here
/// are the ones that decide whether they can get it back: share price moves in the right
/// direction for every event that can change it, and liquidity promised to a live job cannot be
/// withdrawn out from under that promise.
///
/// A real CreditLine is wired in rather than a mock, because the invariant this suite cares most
/// about spans both contracts — the pool reads `totalReserved()` off the line to know what is
/// encumbered, and mocking that away would test the mock. The test contract itself is passed as
/// CreditLine's `jobEscrow_`, which is what lets these tests call `reserve`/`slash` directly
/// without standing up a whole escrow.
contract CreditPoolTest is Test {
    MockUSDC internal usdc;
    MockIdentityRegistry internal registry;
    MockApassComplianceValidator internal validator;
    CreditTierGate internal gate;
    CreditPool internal pool;
    CreditLine internal line;

    address internal lender = makeAddr("lender");
    address internal lender2 = makeAddr("lender2");
    address internal operator = makeAddr("operator");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AGENT = 1;
    uint256 internal constant LIMIT = 1_000e6;

    event Deposited(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event DrawFunded(address indexed recipient, uint256 amount);
    event RepaymentRecorded(uint256 principal, uint256 premium);
    event WriteOffRecorded(uint256 principal);
    event RecoveryRecorded(uint256 amount);

    function setUp() public {
        usdc = new MockUSDC();
        registry = new MockIdentityRegistry();
        validator = new MockApassComplianceValidator();
        gate = new CreditTierGate("band-1", address(this));
        pool = new CreditPool(address(usdc));
        // This test contract stands in for JobEscrow — the only caller allowed to reserve/slash.
        line = new CreditLine(address(usdc), address(registry), address(validator), address(pool), address(this));
        pool.setCreditLine(address(line));

        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](1);
        bands[0] = CreditLine.TierBand({gate: address(gate), limit: LIMIT});
        line.setTierBands(bands);
        line.setPremiumBps(0);

        registry.setAgentOwner(AGENT, operator);
        validator.setCompliant(address(gate), operator, true);

        _fund(lender, 10_000e6);
        _fund(lender2, 10_000e6);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        return pool.deposit(amount);
    }

    // ------------------------------------------------------------------ deposit

    function test_FirstDepositMintsOneSharePerAsset() public {
        uint256 shares = _deposit(lender, 1_000e6);
        assertEq(shares, 1_000e6);
        assertEq(pool.sharesOf(lender), 1_000e6);
        assertEq(pool.totalShares(), 1_000e6);
        assertEq(pool.totalAssets(), 1_000e6);
    }

    function test_DepositEmits() public {
        vm.expectEmit(true, false, false, true, address(pool));
        emit Deposited(lender, 1_000e6, 1_000e6);
        _deposit(lender, 1_000e6);
    }

    function test_RevertWhen_DepositZero() public {
        vm.expectRevert(CreditPool.ZeroAmount.selector);
        _deposit(lender, 0);
    }

    /// Regression: a deposit small enough to round to zero shares used to succeed, taking the
    /// lender's assets and minting them nothing.
    function test_RevertWhen_DepositRoundsToZeroShares() public {
        // Donation with no shares outstanding drives the share price far above 1:1.
        usdc.mint(address(pool), 1_000e6);

        vm.expectRevert(CreditPool.ZeroShares.selector);
        _deposit(lender, 500e6);
        assertEq(usdc.balanceOf(lender), 10_000e6, "lender keeps their assets");
    }

    /// The virtual offset's actual job: a first depositor cannot donate their way into making a
    /// later depositor's shares round to zero and steal the difference.
    function test_InflationAttackIsNotProfitable() public {
        uint256 attackerShares = _deposit(lender, 1);
        assertEq(attackerShares, 1);

        // Attacker donates a large balance directly, hoping to price the victim out.
        usdc.mint(address(pool), 5_000e6);

        vm.expectRevert(CreditPool.ZeroShares.selector);
        _deposit(lender2, 1_000e6);

        // Victim can still enter at a fair (if unattractive) price by depositing above the
        // rounding floor — and the attacker cannot redeem more than they put in plus donated.
        uint256 victimShares = _deposit(lender2, 10_000e6);
        assertGt(victimShares, 0);
        assertLe(pool.convertToAssets(attackerShares), 5_000e6 + 1);
    }

    // ----------------------------------------------------------------- withdraw

    function test_WithdrawReturnsAssetsAndBurnsShares() public {
        _deposit(lender, 1_000e6);
        vm.prank(lender);
        uint256 assets = pool.withdraw(400e6);

        assertEq(assets, 400e6);
        assertEq(pool.sharesOf(lender), 600e6);
        assertEq(pool.totalShares(), 600e6);
        assertEq(usdc.balanceOf(lender), 9_400e6);
    }

    function test_RevertWhen_WithdrawMoreSharesThanHeld() public {
        _deposit(lender, 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(CreditPool.InsufficientShares.selector, lender, 1_001e6, 1_000e6));
        vm.prank(lender);
        pool.withdraw(1_001e6);
    }

    function test_RevertWhen_WithdrawZero() public {
        _deposit(lender, 1_000e6);
        vm.expectRevert(CreditPool.ZeroAmount.selector);
        vm.prank(lender);
        pool.withdraw(0);
    }

    /// Regression: burning shares for zero assets used to succeed silently.
    function test_RevertWhen_WithdrawRoundsToZeroAssets() public {
        _deposit(lender, 1_000e6);
        // Write down the pool so one share is worth less than one asset unit.
        line.reserve(AGENT, 900e6);
        line.slash(AGENT, 900e6, recipient);
        vm.warp(block.timestamp + 8 days);
        line.writeOff(AGENT);

        vm.expectRevert(CreditPool.ZeroAssets.selector);
        vm.prank(lender);
        pool.withdraw(1);
    }

    // -------------------------------------------------- the solvency invariant

    /// Regression, and the highest-severity defect this suite guards: liquidity backing a live
    /// commitment must not be withdrawable. Before the fix a lender could exit in full mid-job,
    /// and the resulting draw would revert inside dispute resolution — freezing the job forever.
    function test_RevertWhen_WithdrawingLiquidityCommittedToLiveJob() public {
        _deposit(lender, 1_000e6);
        line.reserve(AGENT, 400e6);

        assertEq(pool.committedLiquidity(), 400e6);
        assertEq(pool.withdrawableLiquidity(), 600e6);

        vm.expectRevert(abi.encodeWithSelector(CreditPool.LiquidityEncumbered.selector, 1_000e6, 600e6, 400e6));
        vm.prank(lender);
        pool.withdraw(1_000e6);
    }

    function test_WithdrawUpToTheUnencumberedBoundarySucceeds() public {
        _deposit(lender, 1_000e6);
        line.reserve(AGENT, 400e6);

        vm.prank(lender);
        uint256 assets = pool.withdraw(600e6);
        assertEq(assets, 600e6);
        assertEq(pool.availableLiquidity(), 400e6, "exactly the commitment remains");
    }

    /// The commitment is what encumbers liquidity, so releasing it frees the withdrawal again.
    function test_ReleasingCommitmentUnlocksWithdrawal() public {
        _deposit(lender, 1_000e6);
        line.reserve(AGENT, 400e6);
        line.releaseReservation(AGENT, 400e6, true);

        assertEq(pool.committedLiquidity(), 0);
        vm.prank(lender);
        assertEq(pool.withdraw(1_000e6), 1_000e6);
    }

    /// A draw must still be fundable at the moment it fires — the encumbrance is what guarantees
    /// it, and the draw itself consumes both sides at once.
    function test_DrawIsFundableAgainstItsOwnEncumbrance() public {
        _deposit(lender, 1_000e6);
        line.reserve(AGENT, 400e6);

        // Everything not backing the commitment leaves the pool.
        vm.prank(lender);
        pool.withdraw(600e6);

        line.slash(AGENT, 400e6, recipient);
        assertEq(usdc.balanceOf(recipient), 400e6, "the wronged party is still paid in full");
    }

    function test_CommittedLiquidityIsZeroBeforeWiring() public {
        CreditPool fresh = new CreditPool(address(usdc));
        assertEq(fresh.committedLiquidity(), 0);
        assertEq(fresh.withdrawableLiquidity(), 0);
    }

    // ----------------------------------------------------------- share pricing

    /// A draw moves value from cash to receivable without changing what the pool is worth.
    function test_DrawLeavesSharePriceUnchanged() public {
        _deposit(lender, 1_000e6);
        uint256 before = pool.convertToAssets(1_000e6);

        line.reserve(AGENT, 400e6);
        line.slash(AGENT, 400e6, recipient);

        assertEq(pool.totalPrincipalOutstanding(), 400e6);
        assertEq(pool.availableLiquidity(), 600e6);
        assertEq(pool.totalAssets(), 1_000e6, "cash + receivable is unchanged");
        assertEq(pool.convertToAssets(1_000e6), before);
    }

    /// Premium is the lenders' yield: it is the only thing that lifts the share price.
    function test_PremiumRaisesSharePrice() public {
        _deposit(lender, 1_000e6);
        line.setPremiumBps(500); // 5%
        line.reserve(AGENT, 400e6);
        line.slash(AGENT, 400e6, recipient);

        uint256 owed = line.totalOwed(AGENT);
        assertEq(owed, 420e6, "400 principal + 20 premium");

        usdc.mint(operator, owed);
        vm.startPrank(operator);
        usdc.approve(address(line), owed);
        line.repay(AGENT, owed);
        vm.stopPrank();

        assertEq(pool.totalPrincipalOutstanding(), 0);
        assertEq(pool.totalAssets(), 1_020e6, "premium is pure income");
        assertGt(pool.convertToAssets(1_000e6), 1_000e6, "lenders are better off");
    }

    /// A write-off is a loss, taken immediately and visibly.
    function test_WriteOffSinksSharePrice() public {
        _deposit(lender, 1_000e6);
        line.reserve(AGENT, 400e6);
        line.slash(AGENT, 400e6, recipient);
        vm.warp(block.timestamp + 8 days);

        vm.expectEmit(false, false, false, true, address(pool));
        emit WriteOffRecorded(400e6);
        line.writeOff(AGENT);

        assertEq(pool.totalAssets(), 600e6, "the receivable is gone with no cash to replace it");
        assertEq(pool.convertToAssets(1_000e6), 600e6, "loss lands on lenders");
    }

    /// Recovering a written-off default is income, not a repayment — the receivable no longer
    /// exists to be retired, and it is reported under its own event.
    function test_RecoveryRaisesSharePriceAndEmitsItsOwnEvent() public {
        _deposit(lender, 1_000e6);
        line.reserve(AGENT, 400e6);
        line.slash(AGENT, 400e6, recipient);
        vm.warp(block.timestamp + 8 days);
        line.writeOff(AGENT);

        usdc.mint(operator, 400e6);
        vm.startPrank(operator);
        usdc.approve(address(line), 400e6);
        vm.expectEmit(false, false, false, true, address(pool));
        emit RecoveryRecorded(400e6);
        line.repayChargedOff(AGENT, 400e6);
        vm.stopPrank();

        assertEq(pool.totalPrincipalOutstanding(), 0, "recovery does not resurrect the receivable");
        assertEq(pool.totalAssets(), 1_000e6, "lenders are made whole again");
    }

    /// Two lenders at different share prices are diluted and credited proportionally.
    function test_SecondLenderEntersAtTheCurrentSharePrice() public {
        _deposit(lender, 1_000e6);
        // Pure income lifts the price to 1.1 assets/share.
        usdc.mint(address(pool), 100e6);

        uint256 shares = _deposit(lender2, 1_100e6);
        assertEq(shares, 1_000e6, "same value buys the same shares at a 1.1x price");
        assertApproxEqAbs(pool.convertToAssets(pool.sharesOf(lender)), 1_100e6, 1);
        assertApproxEqAbs(pool.convertToAssets(shares), 1_100e6, 1);
    }

    // ------------------------------------------------------------ access control

    function test_RevertWhen_FundDrawNotCreditLine() public {
        _deposit(lender, 1_000e6);
        vm.expectRevert(CreditPool.NotCreditLine.selector);
        vm.prank(stranger);
        pool.fundDraw(stranger, 100e6);
    }

    function test_RevertWhen_RecordRepaymentNotCreditLine() public {
        vm.expectRevert(CreditPool.NotCreditLine.selector);
        vm.prank(stranger);
        pool.recordRepayment(1, 1);
    }

    function test_RevertWhen_RecordWriteOffNotCreditLine() public {
        vm.expectRevert(CreditPool.NotCreditLine.selector);
        vm.prank(stranger);
        pool.recordWriteOff(1);
    }

    function test_RevertWhen_RecordRecoveryNotCreditLine() public {
        vm.expectRevert(CreditPool.NotCreditLine.selector);
        vm.prank(stranger);
        pool.recordRecovery(1);
    }

    function test_RevertWhen_SetCreditLineNotOwner() public {
        CreditPool fresh = new CreditPool(address(usdc));
        vm.expectRevert(CreditPool.NotOwner.selector);
        vm.prank(stranger);
        fresh.setCreditLine(address(line));
    }

    function test_RevertWhen_SetCreditLineTwice() public {
        vm.expectRevert(CreditPool.CreditLineAlreadySet.selector);
        pool.setCreditLine(address(line));
    }

    function test_RevertWhen_SetCreditLineZero() public {
        CreditPool fresh = new CreditPool(address(usdc));
        vm.expectRevert(CreditPool.ZeroAddress.selector);
        fresh.setCreditLine(address(0));
    }

    function test_RevertWhen_ConstructedWithZeroAsset() public {
        vm.expectRevert(CreditPool.ZeroAddress.selector);
        new CreditPool(address(0));
    }

    function test_SetOwnerTransfersRights() public {
        pool.setOwner(stranger);
        assertEq(pool.owner(), stranger);
        vm.expectRevert(CreditPool.NotOwner.selector);
        pool.setOwner(address(this));
    }

    function test_RevertWhen_SetOwnerZero() public {
        vm.expectRevert(CreditPool.ZeroAddress.selector);
        pool.setOwner(address(0));
    }

    // ------------------------------------------------------------------- bounds

    function test_RevertWhen_FundDrawExceedsLiquidity() public {
        _deposit(lender, 100e6);
        line.reserve(AGENT, 100e6);
        // Drain the pool behind CreditLine's back to force the underflow guard.
        vm.prank(address(pool));
        usdc.transfer(stranger, 100e6);

        vm.expectRevert(abi.encodeWithSelector(CreditPool.InsufficientLiquidity.selector, 100e6, 0));
        line.slash(AGENT, 100e6, recipient);
    }

    function test_RevertWhen_RecordWriteOffExceedsOutstanding() public {
        vm.prank(address(line));
        vm.expectRevert(abi.encodeWithSelector(CreditPool.InsufficientPrincipalOutstanding.selector, 1e6, 0));
        pool.recordWriteOff(1e6);
    }
}
