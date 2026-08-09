// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {CreditTierGate} from "../src/CreditTierGate.sol";
import {CreditPool} from "../src/CreditPool.sol";
import {JobEscrow} from "../src/JobEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockValidationRegistry} from "./mocks/MockValidationRegistry.sol";
import {MockApassComplianceValidator} from "./mocks/MockApassComplianceValidator.sol";

/// @title JobEscrowTest — unit tests for JobEscrow against mocked externals + a real credit stack
/// @notice CreditPool, CreditTierGate and CreditLine are all real (not mocked) here on purpose:
/// createJob's insufficient-credit revert must come from CreditLine.reserve() itself, not a
/// duplicate check in JobEscrow — so the test needs the actual limit accounting, not a stand-in.
/// Only the Identity Registry, the Validation Registry, and the ERC-20 are mocked.
///
/// setUp() sets premiumBps to 0. The facility premium is real credit-pricing behaviour, but it
/// is CreditLine's concern, not JobEscrow's — leaving it on would make every escrow assertion
/// here carry a 1% term that tests nothing about escrow. CreditLine's own suite covers premium
/// accrual directly.
///
/// validationRegistryEnabled defaults true on JobEscrow itself, but every pre-Phase-3 test in
/// this file was written passing bytes32(0) as validationRequestHash, from back when the flag
/// had no effect. Rather than registering a real hash at all 30+ of those call sites, setUp()
/// disables the flag once so their original behavior is preserved unchanged; the
/// Validation-Registry-specific tests re-enable it deliberately and use
/// _createJobWithValidHash.
contract JobEscrowTest is Test {
    // ------------------------------------------------------------------ fixtures

    MockUSDC internal usdc;
    MockIdentityRegistry internal registry;
    MockValidationRegistry internal validationRegistry;
    JobEscrow internal jobEscrow;
    MockApassComplianceValidator internal validator;
    CreditTierGate internal tierGate;
    CreditPool internal pool;
    CreditLine internal creditLine;

    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");
    address internal lender = makeAddr("lender");

    uint256 internal constant SELLER_AGENT_ID = 851_889;

    /// 500-unit job; at the default 20% coverageRatioBps that's a 100-unit commitment.
    uint256 internal constant AMOUNT = 500e6;
    uint256 internal constant REQUIRED_CREDIT = 100e6;
    /// Tier-1 base limit. Comfortably more than REQUIRED_CREDIT, so a single job leaves room
    /// for a second concurrent one — several tests depend on that headroom.
    uint256 internal constant CREDIT_LIMIT = 1_000e6;
    /// Lender-supplied liquidity. Must cover every concurrent commitment, since CreditLine
    /// refuses to promise credit the pool could not actually fund.
    uint256 internal constant POOL_LIQUIDITY = 10_000e6;
    /// The seller's operator wallet is the address the CCP validator is asked about — CVI binds
    /// to a wallet, and ERC-8004 says that wallet controls the agent.
    address internal sellerOperator;

    uint64 internal completionDeadline;

    /// Mirror of the events under test, re-declared for vm.expectEmit (Solidity events can't
    /// be imported standalone).
    event JobCreated(
        uint256 indexed jobId,
        address indexed buyer,
        uint256 indexed sellerAgentId,
        uint256 amount,
        uint256 reservedCredit,
        uint64 completionDeadline
    );
    event JobReleased(uint256 indexed jobId);
    event JobDisputed(uint256 indexed jobId, bytes32 evidenceHash);
    event JobResolved(uint256 indexed jobId, bool sellerAtFault);
    event JobTimedOut(uint256 indexed jobId);
    event CreditLineSet(address creditLine);
    event CoverageRatioBpsUpdated(uint256 previous, uint256 current);
    event ResponseWindowUpdated(uint64 previous, uint64 current);
    event ValidationRegistryEnabledUpdated(bool previous, bool current);

    bytes32 internal constant EVIDENCE_HASH = keccak256("bad-delivery");

    /// Fresh state before every test: the full deploy in dependency order (registry and pool
    /// first, JobEscrow next, CreditLine last with both addresses baked in as immutables, then
    /// the two one-time setters that close the circular wiring), one registered seller agent
    /// holding a tier-1 A-Pass, a pool funded by a lender, and one funded buyer who has already
    /// approved JobEscrow to pull the asset.
    ///
    /// Note the seller posts nothing. That is the entire point of the change from Tripwire:
    /// their capacity to take jobs comes from an A-Pass and the pool behind it, not from
    /// collateral they had to fund up front.
    function setUp() public {
        usdc = new MockUSDC();
        registry = new MockIdentityRegistry();
        validationRegistry = new MockValidationRegistry();
        validator = new MockApassComplianceValidator();
        tierGate = new CreditTierGate("tier-base", address(this));
        pool = new CreditPool(address(usdc));
        jobEscrow = new JobEscrow(address(usdc), address(registry), address(validationRegistry), arbiter);
        creditLine =
            new CreditLine(address(usdc), address(registry), address(validator), address(pool), address(jobEscrow));
        pool.setCreditLine(address(creditLine));
        jobEscrow.setCreditLine(address(creditLine));
        // Restores pre-Phase-3 behavior for every existing bytes32(0)-hash test — see the
        // contract-level @notice above.
        jobEscrow.setValidationRegistryEnabled(false);

        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](1);
        bands[0] = CreditLine.TierBand({gate: address(tierGate), limit: CREDIT_LIMIT});
        creditLine.setTierBands(bands);
        // See the contract-level @notice: escrow assertions should not carry a pricing term.
        creditLine.setPremiumBps(0);

        registry.setAgentOwner(SELLER_AGENT_ID, seller);
        sellerOperator = seller;
        // The seller's operator passes the base credit band on Cleanverse's validator.
        validator.setCompliant(address(tierGate), sellerOperator, true);

        usdc.mint(lender, POOL_LIQUIDITY);
        vm.startPrank(lender);
        usdc.approve(address(pool), POOL_LIQUIDITY);
        pool.deposit(POOL_LIQUIDITY);
        vm.stopPrank();

        usdc.mint(buyer, AMOUNT);
        vm.prank(buyer);
        usdc.approve(address(jobEscrow), AMOUNT);

        completionDeadline = uint64(block.timestamp) + 1 days;
    }

    // ------------------------------------------------------------------ setCreditLine

    function test_SetCreditLineWiresAddressAndEmits() public {
        JobEscrow fresh = new JobEscrow(address(usdc), address(registry), address(validationRegistry), arbiter);
        CreditLine freshLine =
            new CreditLine(address(usdc), address(registry), address(validator), address(pool), address(fresh));

        vm.expectEmit(false, false, false, true);
        emit CreditLineSet(address(freshLine));
        fresh.setCreditLine(address(freshLine));

        assertEq(address(fresh.creditLine()), address(freshLine), "creditLine pointer should be wired");
    }

    function test_RevertWhen_SetCreditLineByNonOwner() public {
        JobEscrow fresh = new JobEscrow(address(usdc), address(registry), address(validationRegistry), arbiter);
        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotOwner.selector);
        fresh.setCreditLine(makeAddr("someCreditLine"));
    }

    /// The pointer is meant to be immutable in practice — a second call must never let the
    /// owner redirect an already-wired JobEscrow to a different CreditLine, which would strand
    /// every live commitment on the old one.
    function test_RevertWhen_SetCreditLineCalledTwice() public {
        vm.expectRevert(JobEscrow.CreditLineAlreadySet.selector);
        jobEscrow.setCreditLine(makeAddr("anotherCreditLine"));
    }

    // ------------------------------------------------------------------ createJob

    /// The core happy path: credit committed on CreditLine, payment pulled into escrow, Job
    /// struct recorded correctly, event emitted with the exact reservedCredit that was computed.
    function test_CreateJobCommitsCreditAndPullsPayment() public {
        vm.expectEmit(true, true, true, true);
        emit JobCreated(0, buyer, SELLER_AGENT_ID, AMOUNT, REQUIRED_CREDIT, completionDeadline);

        vm.prank(buyer);
        uint256 jobId = jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));

        assertEq(jobId, 0, "first job should be id 0");
        assertEq(jobEscrow.nextJobId(), 1, "nextJobId should advance");

        (
            address jobBuyer,
            uint256 jobSellerAgentId,
            address sellerPayoutAddress,
            uint256 amount,
            uint256 reservedCredit,
            uint64 deadline,
            uint64 responseDeadline,
            JobEscrow.JobStatus status,,
        ) = jobEscrow.jobs(jobId);
        assertEq(jobBuyer, buyer, "buyer should be recorded");
        assertEq(jobSellerAgentId, SELLER_AGENT_ID, "sellerAgentId should be recorded");
        assertEq(sellerPayoutAddress, seller, "sellerPayoutAddress should snapshot the current owner");
        assertEq(amount, AMOUNT, "amount should be recorded");
        assertEq(reservedCredit, REQUIRED_CREDIT, "reservedCredit should be 20% of amount");
        assertEq(
            responseDeadline,
            completionDeadline + jobEscrow.responseWindow(),
            "responseDeadline should snapshot at creation"
        );
        assertEq(deadline, completionDeadline, "deadline should be recorded");
        assertEq(uint8(status), uint8(JobEscrow.JobStatus.Active), "job should start Active");

        assertEq(creditLine.reserved(SELLER_AGENT_ID), REQUIRED_CREDIT, "CreditLine should show the commitment");
        assertEq(
            creditLine.availableCredit(SELLER_AGENT_ID),
            CREDIT_LIMIT - REQUIRED_CREDIT,
            "committing should consume headroom"
        );
        assertEq(usdc.balanceOf(address(jobEscrow)), AMOUNT, "escrow should hold the buyer's payment");
        assertEq(usdc.balanceOf(buyer), 0, "buyer should have paid the full amount");
        // The capital-efficiency claim, asserted rather than described: the seller committed
        // REQUIRED_CREDIT of capacity without ever funding it, and the pool has not paid out a
        // thing — a commitment only becomes real money if the job goes bad.
        assertEq(usdc.balanceOf(seller), 0, "seller should not have posted anything");
        assertEq(pool.totalPrincipalOutstanding(), 0, "no draw should have occurred yet");
        assertEq(pool.availableLiquidity(), POOL_LIQUIDITY, "pool liquidity should be untouched");
    }

    /// A second job gets the next sequential id — jobIds aren't reused or randomized.
    function test_CreateJobIncrementsJobId() public {
        usdc.mint(buyer, 2 * AMOUNT); // setUp only funded/approved enough for one job
        vm.startPrank(buyer);
        usdc.approve(address(jobEscrow), 2 * AMOUNT); // approve() sets, not adds — cover both jobs up front
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));
        vm.stopPrank();
        // No seller-side top-up needed, unlike the bond model: CREDIT_LIMIT already covers two
        // concurrent commitments.

        vm.prank(buyer);
        uint256 secondJobId = jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));
        assertEq(secondJobId, 1, "second job should be id 1");
    }

    function test_RevertWhen_CreateJobZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert(JobEscrow.ZeroAmount.selector);
        jobEscrow.createJob(SELLER_AGENT_ID, 0, completionDeadline, bytes32(0));
    }

    function test_RevertWhen_CreateJobDeadlineNotInFuture() public {
        uint64 pastDeadline = uint64(block.timestamp);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DeadlineNotInFuture.selector, pastDeadline));
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, pastDeadline, bytes32(0));
    }

    /// createJob must fail cleanly, not silently escrow funds with no credit backing them, if
    /// the deploy's wiring call was never made.
    function test_RevertWhen_CreateJobCreditLineNotSet() public {
        JobEscrow unwired = new JobEscrow(address(usdc), address(registry), address(validationRegistry), arbiter);
        vm.prank(buyer);
        vm.expectRevert(JobEscrow.CreditLineNotSet.selector);
        unwired.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));
    }

    /// The property the commitment design exists for: JobEscrow doesn't duplicate a limit
    /// check, it just lets CreditLine.reserve()'s own revert propagate.
    function test_RevertWhen_CreateJobInsufficientCredit() public {
        uint256 tooLarge = CREDIT_LIMIT * 100; // 20% of this dwarfs the seller's limit
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreditLine.InsufficientCredit.selector, SELLER_AGENT_ID, (tooLarge * 2000) / 10_000, CREDIT_LIMIT
            )
        );
        jobEscrow.createJob(SELLER_AGENT_ID, tooLarge, completionDeadline, bytes32(0));
    }

    /// The identity gate, end to end: an operator whose CVI satisfies no credit band has a limit
    /// of zero and simply cannot take work, no matter how well-funded the pool is. This is the
    /// difference between this protocol and an ordinary escrow.
    function test_RevertWhen_CreateJobSellerFailsComplianceGate() public {
        uint256 unverifiedAgent = 424_242;
        registry.setAgentOwner(unverifiedAgent, makeAddr("unverifiedSeller"));

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentNotVerified.selector, unverifiedAgent));
        jobEscrow.createJob(unverifiedAgent, AMOUNT, completionDeadline, bytes32(0));
    }

    /// Revocation is immediate and needs no action on our side: the next borrowing attempt asks
    /// Cleanverse afresh and is refused. This is the property the on-chain gate buys over a
    /// mirrored attestation, which would have kept lending until someone re-synced it.
    function test_RevertWhen_CreateJobAfterComplianceRevoked() public {
        validator.setCompliant(address(tierGate), sellerOperator, false);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentNotVerified.selector, SELLER_AGENT_ID));
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));
    }

    /// A validator that is unreachable, paused, or reverting must deny credit, never grant it.
    /// Failing open here would mean an outage at Cleanverse silently turns an identity-gated
    /// lender into an unsecured one.
    function test_RevertWhen_CreateJobValidatorReverts() public {
        validator.setReverting(address(tierGate), true);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(CreditLine.AgentNotVerified.selector, SELLER_AGENT_ID));
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));
    }

    /// Tier banding: an operator who additionally passes a higher band borrows against the
    /// higher limit. The contract never learns a tier number — only which gates the operator
    /// clears — which is exactly what complianceVerify is willing to tell it.
    function test_HigherTierBandRaisesLimit() public {
        CreditTierGate premiumGate = new CreditTierGate("tier-premium", address(this));

        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](2);
        bands[0] = CreditLine.TierBand({gate: address(tierGate), limit: CREDIT_LIMIT});
        bands[1] = CreditLine.TierBand({gate: address(premiumGate), limit: CREDIT_LIMIT * 4});
        creditLine.setTierBands(bands);

        assertEq(creditLine.creditLimit(SELLER_AGENT_ID), CREDIT_LIMIT, "base band only, to start");

        validator.setCompliant(address(premiumGate), sellerOperator, true);
        assertEq(creditLine.creditLimit(SELLER_AGENT_ID), CREDIT_LIMIT * 4, "highest passing band should win");
    }

    /// A seller agentId that was never registered must revert — ownerOf's own revert doubles
    /// as JobEscrow's existence check.
    function test_RevertWhen_CreateJobNonexistentSellerAgent() public {
        uint256 ghostAgent = 999_999;
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(MockIdentityRegistry.NonexistentAgent.selector, ghostAgent));
        jobEscrow.createJob(ghostAgent, AMOUNT, completionDeadline, bytes32(0));
    }

    // ---------------------------------------------------- createJob validation registry gate

    /// The hard gate only fires when validationRegistryEnabled — off by default in this
    /// suite's setUp() (see the contract-level doc comment), so every test in this section
    /// turns it back on explicitly.
    function test_CreateJobSucceedsWithValidHashWhenRegistryEnabled() public {
        uint256 jobId = _createJobWithValidHash(keccak256("gate-happy-path"));
        (,,,,,,, JobEscrow.JobStatus status,,) = jobEscrow.jobs(jobId);
        assertEq(uint8(status), uint8(JobEscrow.JobStatus.Active), "job should be created Active");
    }

    function test_RevertWhen_CreateJobRegistryEnabledAndHashUnregistered() public {
        jobEscrow.setValidationRegistryEnabled(true);
        bytes32 requestHash = keccak256("never-registered");

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(JobEscrow.ValidationRequestInvalid.selector, requestHash, SELLER_AGENT_ID)
        );
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, requestHash);
    }

    /// A requestHash that's registered, but names some other address as validator, must not
    /// satisfy this JobEscrow's gate — a seller registering for a different validator can't
    /// accidentally (or deliberately) pass that registration off as valid here.
    function test_RevertWhen_CreateJobRegistryEnabledAndWrongValidator() public {
        jobEscrow.setValidationRegistryEnabled(true);
        bytes32 requestHash = keccak256("wrong-validator-for-job");
        validationRegistry.validationRequest(makeAddr("notJobEscrow"), SELLER_AGENT_ID, "", requestHash);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(JobEscrow.ValidationRequestInvalid.selector, requestHash, SELLER_AGENT_ID)
        );
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, requestHash);
    }

    /// A requestHash already claimed by one job must not back a second one — without this,
    /// two jobs sharing a hash would silently corrupt each other's attestation later (see
    /// ValidationRequestHashAlreadyUsed).
    function test_RevertWhen_CreateJobReusesAlreadyClaimedHash() public {
        bytes32 requestHash = keccak256("reuse-me");
        _createJobWithValidHash(requestHash); // first job legitimately claims the hash

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.ValidationRequestHashAlreadyUsed.selector, requestHash));
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, requestHash);
    }

    /// Two distinct, independently-registered hashes for the same seller must both work —
    /// confirms the fix is "no reuse of one hash," not an overbroad "one hash per seller."
    function test_CreateJobSucceedsWithTwoDistinctHashesForSameSeller() public {
        uint256 jobId1 = _createJobWithValidHash(keccak256("distinct-hash-one"));

        // A second job needs its own allowance; the seller's existing limit already covers the
        // second commitment.
        usdc.mint(buyer, AMOUNT);
        vm.prank(buyer);
        usdc.approve(address(jobEscrow), AMOUNT);

        uint256 jobId2 = _createJobWithValidHash(keccak256("distinct-hash-two"));
        assertTrue(jobId2 != jobId1, "should be two distinct jobs");
    }

    // ------------------------------------------------------------------ release

    function _createJob() internal returns (uint256 jobId) {
        vm.prank(buyer);
        jobId = jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));
    }

    /// Like _createJob, but with validationRegistryEnabled turned on and a real hash
    /// registered on the mock beforehand — used by the Validation Registry gate/attestation
    /// tests, which need a job that will actually pass the enabled hard gate.
    function _createJobWithValidHash(bytes32 requestHash) internal returns (uint256 jobId) {
        jobEscrow.setValidationRegistryEnabled(true);
        validationRegistry.validationRequest(address(jobEscrow), SELLER_AGENT_ID, "", requestHash);
        vm.prank(buyer);
        jobId = jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, requestHash);
    }

    /// The core happy path: seller gets paid in full, the commitment is released back into
    /// their available headroom, status moves to Released.
    function test_ReleasePaysSellerAndClearsReservation() public {
        uint256 jobId = _createJob();

        vm.expectEmit(true, false, false, true);
        emit JobReleased(jobId);
        vm.prank(buyer);
        jobEscrow.release(jobId);

        assertEq(usdc.balanceOf(seller), AMOUNT, "seller should be paid in full");
        assertEq(creditLine.reserved(SELLER_AGENT_ID), 0, "commitment should be released");
        assertEq(creditLine.availableCredit(SELLER_AGENT_ID), CREDIT_LIMIT, "full headroom should be free again");
        assertEq(creditLine.principalOwed(SELLER_AGENT_ID), 0, "a clean job should leave no debt");
        // A confirmed delivery is what grows a line — JobEscrow reports the outcome, it doesn't
        // just release the number.
        assertEq(creditLine.completedJobs(SELLER_AGENT_ID), 1, "release should count as a completed job");

        (,,,,,,, JobEscrow.JobStatus status,,) = jobEscrow.jobs(jobId);
        assertEq(uint8(status), uint8(JobEscrow.JobStatus.Released), "status should be Released");
    }

    /// A buyer can release immediately, even before completionDeadline itself — the window is
    /// "any time up to deadline + responseWindow," not gated by the deadline on the front end.
    function test_ReleaseAllowedImmediatelyAfterCreation() public {
        uint256 jobId = _createJob();
        vm.prank(buyer);
        jobEscrow.release(jobId); // no warp — should succeed right away
        assertEq(usdc.balanceOf(seller), AMOUNT, "release should succeed before the deadline");
    }

    function test_RevertWhen_ReleaseByNonBuyer() public {
        uint256 jobId = _createJob();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.NotBuyer.selector, jobId, stranger));
        jobEscrow.release(jobId);
    }

    /// Releasing an already-released job must fail — status only ever moves forward once.
    function test_RevertWhen_ReleaseNotActive() public {
        uint256 jobId = _createJob();
        vm.startPrank(buyer);
        jobEscrow.release(jobId);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotActive.selector, jobId, JobEscrow.JobStatus.Released));
        jobEscrow.release(jobId);
        vm.stopPrank();
    }

    /// Past completionDeadline + responseWindow, only claimTimeout applies — invariant 4's
    /// mutual exclusivity, enforced on the release side.
    function test_RevertWhen_ReleaseAfterResponseWindowElapsed() public {
        uint256 jobId = _createJob();
        uint64 claimableAfter = completionDeadline + jobEscrow.responseWindow();
        vm.warp(claimableAfter);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.ResponseWindowElapsed.selector, jobId, claimableAfter));
        jobEscrow.release(jobId);
    }

    // ------------------------------------------------------------------ dispute

    /// The core happy path: evidence hash recorded, status flips, no funds move yet —
    /// resolution (and any payout) only happens at resolveDispute.
    function test_DisputeRecordsEvidenceAndFlipsStatus() public {
        uint256 jobId = _createJob();

        vm.expectEmit(true, false, false, true);
        emit JobDisputed(jobId, EVIDENCE_HASH);
        vm.prank(buyer);
        jobEscrow.dispute(jobId, EVIDENCE_HASH);

        (,,,,,,, JobEscrow.JobStatus status,, bytes32 evidenceHash) = jobEscrow.jobs(jobId);
        assertEq(uint8(status), uint8(JobEscrow.JobStatus.Disputed), "status should be Disputed");
        assertEq(evidenceHash, EVIDENCE_HASH, "evidenceHash should be recorded");
        assertEq(usdc.balanceOf(address(jobEscrow)), AMOUNT, "escrow should still hold the payment");
        assertEq(creditLine.reserved(SELLER_AGENT_ID), REQUIRED_CREDIT, "commitment should still be locked");
    }

    function test_RevertWhen_DisputeByNonBuyer() public {
        uint256 jobId = _createJob();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.NotBuyer.selector, jobId, stranger));
        jobEscrow.dispute(jobId, EVIDENCE_HASH);
    }

    /// Disputing an already-resolved (here: released) job must fail — status only moves
    /// forward once, and Disputed is only reachable from Active.
    function test_RevertWhen_DisputeNotActive() public {
        uint256 jobId = _createJob();
        vm.startPrank(buyer);
        jobEscrow.release(jobId);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotActive.selector, jobId, JobEscrow.JobStatus.Released));
        jobEscrow.dispute(jobId, EVIDENCE_HASH);
        vm.stopPrank();
    }

    /// Same window as release() — past it, only claimTimeout applies.
    function test_RevertWhen_DisputeAfterResponseWindowElapsed() public {
        uint256 jobId = _createJob();
        uint64 claimableAfter = completionDeadline + jobEscrow.responseWindow();
        vm.warp(claimableAfter);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.ResponseWindowElapsed.selector, jobId, claimableAfter));
        jobEscrow.dispute(jobId, EVIDENCE_HASH);
    }

    // ------------------------------------------------------------------ resolveDispute

    function _createAndDisputeJob() internal returns (uint256 jobId) {
        jobId = _createJob();
        vm.prank(buyer);
        jobEscrow.dispute(jobId, EVIDENCE_HASH);
    }

    /// The pitch's core mechanic: the buyer gets made whole *and* compensated, immediately,
    /// out of the pool rather than out of collateral the seller had to pre-fund. Two separate
    /// transfers land in the buyer's wallet — the escrowed refund from JobEscrow, and the drawn
    /// credit from the pool — and the seller walks away owing that draw as debt.
    function test_ResolveDisputeSellerAtFaultDrawsCreditAndRefundsBuyer() public {
        uint256 jobId = _createAndDisputeJob();

        vm.expectEmit(true, false, false, true);
        emit JobResolved(jobId, true);
        vm.prank(arbiter);
        jobEscrow.resolveDispute(jobId, true);

        assertEq(usdc.balanceOf(buyer), AMOUNT + REQUIRED_CREDIT, "buyer should get the refund plus the drawn credit");
        assertEq(creditLine.reserved(SELLER_AGENT_ID), 0, "commitment should be consumed by the draw");
        assertEq(creditLine.principalOwed(SELLER_AGENT_ID), REQUIRED_CREDIT, "the draw should become the agent's debt");
        assertEq(
            creditLine.availableCredit(SELLER_AGENT_ID),
            CREDIT_LIMIT - REQUIRED_CREDIT,
            "outstanding debt should keep consuming headroom until repaid"
        );
        assertEq(creditLine.completedJobs(SELLER_AGENT_ID), 0, "a job lost at fault must not count as completed");
        // The lenders, not the seller, funded the buyer's compensation. That is the whole trade
        // this protocol makes.
        assertEq(pool.totalPrincipalOutstanding(), REQUIRED_CREDIT, "pool should book the draw as a receivable");
        assertEq(pool.availableLiquidity(), POOL_LIQUIDITY - REQUIRED_CREDIT, "pool cash should have left the pool");

        (,,,,,,, JobEscrow.JobStatus status,,) = jobEscrow.jobs(jobId);
        assertEq(uint8(status), uint8(JobEscrow.JobStatus.Resolved), "status should be Resolved");
    }

    /// A dispute that doesn't find the seller at fault pays out exactly like release() would.
    function test_ResolveDisputeSellerNotAtFaultPaysSellerNormally() public {
        uint256 jobId = _createAndDisputeJob();

        vm.prank(arbiter);
        jobEscrow.resolveDispute(jobId, false);

        assertEq(usdc.balanceOf(seller), AMOUNT, "seller should be paid in full");
        assertEq(creditLine.reserved(SELLER_AGENT_ID), 0, "commitment should be released, not drawn");
        assertEq(creditLine.availableCredit(SELLER_AGENT_ID), CREDIT_LIMIT, "full headroom should be free again");
        assertEq(pool.totalPrincipalOutstanding(), 0, "no draw should have occurred");
        // Winning a dispute counts exactly as much as an uncontested delivery — otherwise
        // raising a dispute would be a free way to suppress a rival's credit limit.
        assertEq(creditLine.completedJobs(SELLER_AGENT_ID), 1, "a cleared seller should still earn the completion");
    }

    function test_RevertWhen_ResolveDisputeByNonArbiter() public {
        uint256 jobId = _createAndDisputeJob();
        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotArbiter.selector);
        jobEscrow.resolveDispute(jobId, true);
    }

    /// Only a Disputed job can be resolved — an Active job must go through dispute() first.
    function test_RevertWhen_ResolveDisputeNotDisputed() public {
        uint256 jobId = _createJob();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotDisputed.selector, jobId, JobEscrow.JobStatus.Active));
        jobEscrow.resolveDispute(jobId, true);
    }

    // ------------------------------------------------------------------ claimTimeout

    /// Anyone — not just the buyer or seller — may trigger the rescue once the window has
    /// elapsed with the buyer having done nothing.
    function test_ClaimTimeoutPaysSellerAfterWindow() public {
        uint256 jobId = _createJob();
        uint64 claimableAfter = completionDeadline + jobEscrow.responseWindow();
        vm.warp(claimableAfter);

        vm.expectEmit(true, false, false, true);
        emit JobTimedOut(jobId);
        vm.prank(stranger);
        jobEscrow.claimTimeout(jobId);

        assertEq(usdc.balanceOf(seller), AMOUNT, "seller should be paid in full");
        assertEq(creditLine.reserved(SELLER_AGENT_ID), 0, "commitment should be released");
        // Paid, but not vouched for. Counting a timeout would make the cheapest way to farm a
        // large limit "run jobs with a buyer wallet you control and never respond".
        assertEq(creditLine.completedJobs(SELLER_AGENT_ID), 0, "a timeout must not count as a completed job");

        (,,,,,,, JobEscrow.JobStatus status,,) = jobEscrow.jobs(jobId);
        assertEq(uint8(status), uint8(JobEscrow.JobStatus.TimedOut), "status should be TimedOut");
    }

    function test_RevertWhen_ClaimTimeoutBeforeWindowElapsed() public {
        uint256 jobId = _createJob();
        uint64 claimableAfter = completionDeadline + jobEscrow.responseWindow();

        vm.expectRevert(abi.encodeWithSelector(JobEscrow.ResponseWindowNotElapsed.selector, jobId, claimableAfter));
        jobEscrow.claimTimeout(jobId);
    }

    /// A job the buyer already released can't also be timed out — status only moves forward
    /// once, and TimedOut is only reachable from Active.
    function test_RevertWhen_ClaimTimeoutNotActive() public {
        uint256 jobId = _createJob();
        vm.prank(buyer);
        jobEscrow.release(jobId);

        uint64 claimableAfter = completionDeadline + jobEscrow.responseWindow();
        vm.warp(claimableAfter);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotActive.selector, jobId, JobEscrow.JobStatus.Released));
        jobEscrow.claimTimeout(jobId);
    }

    // ------------------------------------------------------------------ setCoverageRatioBps

    function test_SetCoverageRatioBpsEmitsAndApplies() public {
        vm.expectEmit(false, false, false, true);
        emit CoverageRatioBpsUpdated(2000, 1000);
        jobEscrow.setCoverageRatioBps(1000);
        assertEq(jobEscrow.coverageRatioBps(), 1000, "ratio should update");
    }

    function test_RevertWhen_SetCoverageRatioBpsNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotOwner.selector);
        jobEscrow.setCoverageRatioBps(1000);
    }

    /// The 100% ceiling holds — bounding what a careless or compromised owner key could brick.
    function test_RevertWhen_SetCoverageRatioBpsAboveMax() public {
        uint256 tooHigh = 10_000 + 1;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.CoverageRatioTooHigh.selector, tooHigh, uint256(10_000)));
        jobEscrow.setCoverageRatioBps(tooHigh);
    }

    // ------------------------------------------------------------------ setResponseWindow

    function test_SetResponseWindowEmitsAndApplies() public {
        vm.expectEmit(false, false, false, true);
        emit ResponseWindowUpdated(48 hours, 1 hours);
        jobEscrow.setResponseWindow(1 hours);
        assertEq(jobEscrow.responseWindow(), 1 hours, "window should update");
    }

    function test_RevertWhen_SetResponseWindowNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotOwner.selector);
        jobEscrow.setResponseWindow(1 hours);
    }

    /// The 30-day ceiling holds — bounding what a compromised owner key could freeze.
    function test_RevertWhen_SetResponseWindowAboveMax() public {
        uint64 tooLong = 30 days + 1;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.ResponseWindowTooLong.selector, tooLong, uint64(30 days)));
        jobEscrow.setResponseWindow(tooLong);
    }

    // ------------------------------------------------------------------ setValidationRegistryEnabled

    /// setUp() already disabled the flag (see the contract-level doc comment above), so this
    /// tests the false -> true transition; the gate/attestation tests below cover re-enabling
    /// for real.
    function test_SetValidationRegistryEnabledEmitsAndApplies() public {
        vm.expectEmit(false, false, false, true);
        emit ValidationRegistryEnabledUpdated(false, true);
        jobEscrow.setValidationRegistryEnabled(true);
        assertTrue(jobEscrow.validationRegistryEnabled(), "flag should update");
    }

    function test_RevertWhen_SetValidationRegistryEnabledNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotOwner.selector);
        jobEscrow.setValidationRegistryEnabled(true);
    }

    // ------------------------------------------------------------------ isValidationRequestValid

    function test_IsValidationRequestValid_TrueForRegisteredRequest() public {
        bytes32 requestHash = keccak256("valid-request");
        validationRegistry.validationRequest(address(jobEscrow), SELLER_AGENT_ID, "", requestHash);
        assertTrue(jobEscrow.isValidationRequestValid(requestHash, SELLER_AGENT_ID));
    }

    function test_IsValidationRequestValid_FalseForUnregisteredHash() public view {
        assertFalse(jobEscrow.isValidationRequestValid(keccak256("never-requested"), SELLER_AGENT_ID));
    }

    /// A request naming some other validator (not this JobEscrow) must not pass — otherwise
    /// any seller's registration for a different, unrelated validator would incorrectly
    /// satisfy this JobEscrow's gate.
    function test_IsValidationRequestValid_FalseForWrongValidator() public {
        bytes32 requestHash = keccak256("wrong-validator");
        validationRegistry.validationRequest(makeAddr("someOtherValidator"), SELLER_AGENT_ID, "", requestHash);
        assertFalse(jobEscrow.isValidationRequestValid(requestHash, SELLER_AGENT_ID));
    }

    /// A request correctly naming this JobEscrow, but for a different sellerAgentId, must
    /// not validate a job being created for SELLER_AGENT_ID.
    function test_IsValidationRequestValid_FalseForWrongAgent() public {
        bytes32 requestHash = keccak256("wrong-agent");
        validationRegistry.validationRequest(address(jobEscrow), SELLER_AGENT_ID + 1, "", requestHash);
        assertFalse(jobEscrow.isValidationRequestValid(requestHash, SELLER_AGENT_ID));
    }

    // ------------------------------------------------------------------ validation attestation

    /// release() writes response=100, an empty responseHash, and tag "RELEASED" for the
    /// job's requestHash.
    function test_ReleaseWritesReleasedAttestation() public {
        bytes32 requestHash = keccak256("attest-release");
        uint256 jobId = _createJobWithValidHash(requestHash);

        vm.prank(buyer);
        jobEscrow.release(jobId);

        (,, uint8 response, bytes32 responseHash, string memory tag,) =
            validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 100, "response should be 100 for a clean release");
        assertEq(responseHash, bytes32(0), "responseHash should be empty for a clean release");
        assertEq(tag, "RELEASED", "tag should be RELEASED");
    }

    /// Invariant 3: a Validation Registry failure inside release()'s attestation call must
    /// never block the payout itself — the seller still gets paid even though the registry
    /// call reverted.
    function test_ReleaseStillPaysOutWhenAttestationReverts() public {
        bytes32 requestHash = keccak256("attest-release-fails");
        uint256 jobId = _createJobWithValidHash(requestHash);
        validationRegistry.setAlwaysRevertOnResponse(requestHash);

        vm.prank(buyer);
        jobEscrow.release(jobId);

        assertEq(usdc.balanceOf(seller), AMOUNT, "seller should still be paid despite the reverting attestation");
    }

    /// resolveDispute(sellerAtFault=true) writes response=0, the buyer's real evidenceHash
    /// (not an empty one), and tag "SELLER_AT_FAULT" — the evidenceHash is what makes this
    /// attestation genuinely content-addressed and checkable, not just a bare score.
    function test_ResolveDisputeSellerAtFaultWritesAttestationWithEvidenceHash() public {
        bytes32 requestHash = keccak256("attest-at-fault");
        uint256 jobId = _createJobWithValidHash(requestHash);
        vm.prank(buyer);
        jobEscrow.dispute(jobId, EVIDENCE_HASH);

        vm.prank(arbiter);
        jobEscrow.resolveDispute(jobId, true);

        (,, uint8 response, bytes32 responseHash, string memory tag,) =
            validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 0, "response should be 0 for seller at fault");
        assertEq(responseHash, EVIDENCE_HASH, "responseHash should carry the buyer's dispute evidence hash");
        assertEq(tag, "SELLER_AT_FAULT", "tag should be SELLER_AT_FAULT");
    }

    /// Invariant 3, at-fault path: the slash + refund must still complete even when the
    /// attestation call reverts.
    function test_ResolveDisputeSellerAtFaultStillPaysOutWhenAttestationReverts() public {
        bytes32 requestHash = keccak256("attest-at-fault-fails");
        uint256 jobId = _createJobWithValidHash(requestHash);
        vm.prank(buyer);
        jobEscrow.dispute(jobId, EVIDENCE_HASH);
        validationRegistry.setAlwaysRevertOnResponse(requestHash);

        vm.prank(arbiter);
        jobEscrow.resolveDispute(jobId, true);

        assertEq(
            usdc.balanceOf(buyer),
            AMOUNT + REQUIRED_CREDIT,
            "buyer should still get the refund plus the drawn credit despite the reverting attestation"
        );
    }

    /// resolveDispute(sellerAtFault=false) writes response=100 and tag
    /// "DISPUTE_RESOLVED_SELLER" — a distinct tag from a plain release() so an off-chain
    /// observer can tell "went through a dispute and the seller cleared" apart from "buyer
    /// never disputed at all", even though the payout is identical.
    function test_ResolveDisputeSellerNotAtFaultWritesAttestation() public {
        bytes32 requestHash = keccak256("attest-not-at-fault");
        uint256 jobId = _createJobWithValidHash(requestHash);
        vm.prank(buyer);
        jobEscrow.dispute(jobId, EVIDENCE_HASH);

        vm.prank(arbiter);
        jobEscrow.resolveDispute(jobId, false);

        (,, uint8 response, bytes32 responseHash, string memory tag,) =
            validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 100, "response should be 100");
        assertEq(responseHash, bytes32(0), "responseHash should be empty");
        assertEq(tag, "DISPUTE_RESOLVED_SELLER", "tag should be DISPUTE_RESOLVED_SELLER");
    }

    /// claimTimeout() writes response=50 (indeterminate, not 100 — nobody actually confirmed
    /// delivery, the buyer just never responded) and tag "TIMED_OUT".
    function test_ClaimTimeoutWritesTimedOutAttestation() public {
        bytes32 requestHash = keccak256("attest-timeout");
        uint256 jobId = _createJobWithValidHash(requestHash);
        vm.warp(completionDeadline + jobEscrow.responseWindow());

        jobEscrow.claimTimeout(jobId);

        (,, uint8 response, bytes32 responseHash, string memory tag,) =
            validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 50, "response should be 50 (indeterminate) for a timeout");
        assertEq(responseHash, bytes32(0), "responseHash should be empty");
        assertEq(tag, "TIMED_OUT", "tag should be TIMED_OUT");
    }

    /// Invariant 3, timeout path: the auto-release to the seller must still complete even
    /// when the attestation call reverts.
    function test_ClaimTimeoutStillPaysOutWhenAttestationReverts() public {
        bytes32 requestHash = keccak256("attest-timeout-fails");
        uint256 jobId = _createJobWithValidHash(requestHash);
        validationRegistry.setAlwaysRevertOnResponse(requestHash);
        vm.warp(completionDeadline + jobEscrow.responseWindow());

        jobEscrow.claimTimeout(jobId);

        assertEq(usdc.balanceOf(seller), AMOUNT, "seller should still be paid despite the reverting attestation");
    }

    /// The kill switch also gates the attestation calls, not just createJob's gate — with
    /// validationRegistryEnabled off, release() must not even attempt validationResponse, so
    /// the registry's stored status for this (validly registered) requestHash stays at its
    /// pre-response default: request recorded, but never actually responded to.
    function test_ReleaseSkipsAttestationWhenRegistryDisabled() public {
        bytes32 requestHash = keccak256("attest-disabled");
        uint256 jobId = _createJobWithValidHash(requestHash);
        jobEscrow.setValidationRegistryEnabled(false);

        vm.prank(buyer);
        jobEscrow.release(jobId);

        (,, uint8 response,, string memory tag,) = validationRegistry.getValidationStatus(requestHash);
        assertEq(response, 0, "response should still be the pre-response default");
        assertEq(tag, "", "tag should still be empty, validationResponse should never have been called");
    }

    // ------------------------------------------------------------------ responseDeadline snapshot

    /// The property invariant 4 depends on: a job's response window is fixed at creation
    /// (the same snapshot pattern used for reservedCredit), so a later owner change
    /// to the global responseWindow can never retroactively strip a buyer's remaining time.
    /// Without the snapshot, shortening responseWindow after creation would make release()
    /// revert here even though the job's original 48h window hasn't elapsed.
    function test_ReleaseStillSucceedsAfterResponseWindowIsShortened() public {
        uint256 jobId = _createJob(); // snapshots responseDeadline = completionDeadline + 48h

        jobEscrow.setResponseWindow(1 hours); // shortened well after creation
        // Past where the NEW (shortened) window would have elapsed, but nowhere near the
        // job's actual snapshotted responseDeadline.
        vm.warp(completionDeadline + 2 hours);

        vm.prank(buyer);
        jobEscrow.release(jobId);
        assertEq(usdc.balanceOf(seller), AMOUNT, "release should still succeed under the job's original window");
    }

    /// The mirror image: claimTimeout must NOT be claimable yet at that same point in time,
    /// for a job created before the window was shortened — proving claimTimeout also reads
    /// the snapshot, not the live responseWindow.
    function test_RevertWhen_ClaimTimeoutBeforeOriginalWindowDespiteShortening() public {
        uint256 jobId = _createJob();
        uint64 originalResponseDeadline = completionDeadline + 48 hours;

        jobEscrow.setResponseWindow(1 hours);
        vm.warp(completionDeadline + 2 hours); // past the new window, before the original one

        vm.expectRevert(
            abi.encodeWithSelector(JobEscrow.ResponseWindowNotElapsed.selector, jobId, originalResponseDeadline)
        );
        jobEscrow.claimTimeout(jobId);
    }

    // ------------------------------------------------------------------ createJob deadline bound

    function test_RevertWhen_CreateJobDeadlineTooFar() public {
        uint64 maxDeadline = uint64(block.timestamp) + jobEscrow.MAX_JOB_DURATION();
        uint64 tooFar = maxDeadline + 1;
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DeadlineTooFar.selector, tooFar, maxDeadline));
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, tooFar, bytes32(0));
    }

    /// A deadline exactly at the boundary must still succeed — the cap shouldn't be off-by-one.
    function test_CreateJobAllowsDeadlineAtMax() public {
        uint64 maxDeadline = uint64(block.timestamp) + jobEscrow.MAX_JOB_DURATION();
        vm.prank(buyer);
        uint256 jobId = jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, maxDeadline, bytes32(0));
        assertEq(jobId, 0, "boundary deadline should be accepted");
    }

    /// The specific overflow this bound exists to prevent: without it, a "no real deadline"
    /// sentinel like type(uint64).max — the same convention this codebase's own tests use
    /// for USDC allowances (`approve(..., type(uint256).max)`) — would make
    /// completionDeadline + responseWindow overflow uint64 and permanently lock the job's
    /// escrow and committed credit, since every exit path computes that same sum.
    function test_RevertWhen_CreateJobDeadlineIsMaxUint64Sentinel() public {
        uint64 maxDeadline = uint64(block.timestamp) + jobEscrow.MAX_JOB_DURATION();
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DeadlineTooFar.selector, type(uint64).max, maxDeadline));
        jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, type(uint64).max, bytes32(0));
    }

    // ---------------------------------------------------------- zero-coverage-ratio configuration

    /// The documented "0% is a legitimate demo/testing configuration" claim, verified end to
    /// end: a job created while coverageRatioBps is 0 never touches CreditLine's
    /// reserve/releaseReservation, since there's nothing to commit.
    function test_CreateJobAndReleaseWorkWithZeroCoverageRatio() public {
        jobEscrow.setCoverageRatioBps(0);

        vm.prank(buyer);
        uint256 jobId = jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));

        (,,,, uint256 reservedCredit,,,,,) = jobEscrow.jobs(jobId);
        assertEq(reservedCredit, 0, "reservedCredit should be zero at 0% ratio");
        assertEq(creditLine.reserved(SELLER_AGENT_ID), 0, "CreditLine should never have been touched");

        vm.prank(buyer);
        jobEscrow.release(jobId);
        assertEq(usdc.balanceOf(seller), AMOUNT, "seller should still be paid in full");
        // Documented consequence of the 0% path: nothing was committed, so nothing is reported,
        // so the job earns no history either.
        assertEq(creditLine.completedJobs(SELLER_AGENT_ID), 0, "an uncommitted job earns no completion history");
    }

    /// The seller-at-fault dispute path also has nothing to draw at 0% ratio — the buyer still
    /// gets their escrowed refund, just no credit compensation on top.
    function test_ResolveDisputeSellerAtFaultWorksWithZeroCoverageRatio() public {
        jobEscrow.setCoverageRatioBps(0);

        vm.prank(buyer);
        uint256 jobId = jobEscrow.createJob(SELLER_AGENT_ID, AMOUNT, completionDeadline, bytes32(0));
        vm.prank(buyer);
        jobEscrow.dispute(jobId, EVIDENCE_HASH);

        vm.prank(arbiter);
        jobEscrow.resolveDispute(jobId, true);

        assertEq(usdc.balanceOf(buyer), AMOUNT, "buyer should get the escrow refund with no credit to draw");
    }
}
