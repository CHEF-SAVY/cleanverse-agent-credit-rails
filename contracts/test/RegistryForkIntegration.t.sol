// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {JobEscrow} from "../src/JobEscrow.sol";
import {IValidationRegistry} from "../src/interfaces/IValidationRegistry.sol";

/// validationRequest is deliberately absent from IValidationRegistry.sol — JobEscrow itself
/// never calls it, only the seller does. This test needs it anyway, to set up registry state
/// exactly the way a real seller would, so it's declared here rather than widening the
/// production interface for a call site that only exists in a test.
interface IValidationRegistryTestSetup {
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;
}

/// Same idea for the Identity Registry: setUp needs `ownerOf` to discover a real agent owner on
/// whatever chain the fork points at, and IIdentityRegistry already declares it — but importing
/// the production interface here just for a test lookup would blur which calls JobEscrow itself
/// actually makes. Declared locally for the same reason as the one above.
interface IIdentityRegistryTestSetup {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title RegistryForkIntegration — pre-deploy smoke test against the live ERC-8004 registries
/// @notice Not a unit-test replacement (see JobEscrow.t.sol for that): this exists purely to
/// catch "the real registry's interface doesn't actually match what we assumed" before
/// spending faucet funds on a real deploy. Forks the live chain via the `monad_testnet` named
/// endpoint in foundry.toml — costs no gas, this is simulation only.
///
/// Retargeted from Arc to Monad when the deploy target moved (CLAUDE.md §8): Cleanverse has no
/// Arc support at all, which put the Validator compliance pool — the entire identity gate — out
/// of reach there. The ERC-8004 registries are deployed at the same canonical `0x8004…`
/// addresses on Monad, re-verified on 2026-08-09 by `eth_call` against
/// `IdentityRegistry.ownerOf(1)` (returned a live owner) and by confirming the Validation
/// Registry address carries code on chain 10143.
///
/// The seller agent is discovered at fork time rather than hardcoded. Arc's agentId 851889 does
/// not exist on Monad, and pinning a Monad id we happened to see once would be the same
/// unverified-constant trap in a new chain's clothing — so setUp reads a real owner off the
/// registry itself and pranks as whoever that turns out to be.
contract RegistryForkIntegrationTest is Test {
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant VALIDATION_REGISTRY = 0x8004Cb1BF31DAf7788923b405b754f57acEB4272;

    /// Agent #1 — the first ever registered, so it exists on any live deployment of the
    /// registry. Its owner is read live in setUp, never assumed.
    uint256 constant SELLER_AGENT_ID = 1;

    /// A stand-in for the settlement asset. JobEscrow only needs a non-zero address here: no
    /// test in this file moves tokens, they all exercise its read-only view of the Validation
    /// Registry. Using a placeholder rather than the real AUSDC address is deliberate — that
    /// address is still unverified (CLAUDE.md §8) and does not belong baked into a test.
    address constant ASSET_PLACEHOLDER = address(0xA55E7);

    JobEscrow jobEscrow;
    address arbiter = makeAddr("arbiter");
    // The registry requires msg.sender to be the agent's owner or an approved operator for
    // validationRequest — it is NOT permissionless (confirmed against the verified source:
    // `ownerOf` + `isApprovedForAll`/`getApproved`, reverting "Not authorized" otherwise).
    // Matters for the backend's registration flow, not for JobEscrow, which never calls it.
    address sellerAgentOwner;

    function setUp() public {
        vm.createSelectFork("monad_testnet");
        sellerAgentOwner = IIdentityRegistryTestSetup(IDENTITY_REGISTRY).ownerOf(SELLER_AGENT_ID);
        // No credit stack wired here on purpose: every test in this file exercises JobEscrow's
        // read-only view of the real Validation Registry, and none creates a job. Deploying a
        // CreditLine just to satisfy a setter would add moving parts to a fork test whose whole
        // job is to pin down one external contract's behaviour.
        jobEscrow = new JobEscrow(ASSET_PLACEHOLDER, IDENTITY_REGISTRY, VALIDATION_REGISTRY, arbiter);
    }

    /// The exact behavioral assumption isValidationRequestValid's try/catch depends on:
    /// getValidationStatus really does revert for an unregistered hash, not return zeros.
    function test_RealRegistry_GetValidationStatusRevertsForUnknownHash() public {
        vm.expectRevert();
        IValidationRegistry(VALIDATION_REGISTRY).getValidationStatus(keccak256("definitely-never-registered"));
    }

    /// isValidationRequestValid must swallow that revert into a plain `false`, not propagate
    /// it — confirms JobEscrow's own view of an unregistered hash matches the raw call above.
    function test_IsValidationRequestValid_FalseForUnknownHashAgainstRealRegistry() public view {
        assertFalse(jobEscrow.isValidationRequestValid(keccak256("definitely-never-registered"), SELLER_AGENT_ID));
    }

    /// End-to-end against the real registry: a fresh requestHash, registered exactly the way
    /// a real seller would (naming this fork-deployed JobEscrow as validator), must make
    /// isValidationRequestValid return true for the matching agent and false for a mismatched
    /// one — confirms the real validationRequest/getValidationStatus round-trip matches the
    /// interface JobEscrow was built against.
    function test_RealValidationRequest_ThenIsValidationRequestValid() public {
        bytes32 requestHash = keccak256(abi.encodePacked("credit-rails-fork-test", block.timestamp, block.number));

        // Must be pranked as the agentId's real owner — see the sellerAgentOwner comment
        // above for why.
        vm.prank(sellerAgentOwner);
        IValidationRegistryTestSetup(VALIDATION_REGISTRY)
            .validationRequest(address(jobEscrow), SELLER_AGENT_ID, "", requestHash);

        assertTrue(jobEscrow.isValidationRequestValid(requestHash, SELLER_AGENT_ID));
        assertFalse(
            jobEscrow.isValidationRequestValid(requestHash, SELLER_AGENT_ID + 1),
            "a mismatched agentId must not validate"
        );
    }

    /// The access-control fact JobEscrow's design depends on: only the exact address named
    /// as validator in the matching validationRequest may call validationResponse. Confirms
    /// against the real deployed registry, not just the mock.
    function test_RealValidationResponse_RevertsForCallerThatIsNotTheNamedValidator() public {
        bytes32 requestHash = keccak256(abi.encodePacked("credit-rails-fork-test-access-control", block.timestamp));
        vm.prank(sellerAgentOwner);
        IValidationRegistryTestSetup(VALIDATION_REGISTRY)
            .validationRequest(address(jobEscrow), SELLER_AGENT_ID, "", requestHash);

        // This test contract is not JobEscrow, so it's not the named validator.
        vm.expectRevert();
        IValidationRegistry(VALIDATION_REGISTRY).validationResponse(requestHash, 100, "", bytes32(0), "FORK_TEST");

        // Pranking as JobEscrow itself succeeds — confirms the real registry's check really
        // is `msg.sender == validatorAddress`, exactly what _attestValidation relies on.
        vm.prank(address(jobEscrow));
        IValidationRegistry(VALIDATION_REGISTRY).validationResponse(requestHash, 100, "", bytes32(0), "FORK_TEST");
    }
}
