// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title CreditTierGate — a registered CCP pool address that stands for one credit tier
/// @notice Holds no funds and has no business logic. Its only job is to *be an address* that
/// Cleanverse's compliance validator has registered against a specific `RuleV2` (a `minTier`,
/// and optionally a group or country bitmap). CreditLine then asks the validator
/// `complianceVerify(gate, operator)` for each gate, and the highest-limit gate the operator
/// passes sets their borrowing limit.
///
/// This is how an on-chain credit limit gets sized by an off-chain KYC tier without an oracle,
/// an attestation, or a trusted key: the CCP guide's own "one authorization, batch-manage
/// multiple pools … high-tier express lanes" pattern, used for lending instead of a DEX.
/// Registering three of these, each against a different rule, gives three credit bands, and
/// moving a band is a rule change on Cleanverse's side — no redeploy here.
///
/// The live bands gate on `minSubTier` (10 / 40 / 80) rather than `minTier`, because every
/// A-Pass the sandbox issues comes back at tier 50 regardless of the KYC submitted — measured
/// across seven passes — so `minTier` alone cannot separate three bands. See
/// `apps/web/lib/cleanverse/bands.ts` for the rule each label carries.
///
/// `owner()` exists because CCP registration requires an EIP-191 signature from the subject
/// contract's owner over `keccak256(chain + contract_address)`; without it the gate could never
/// be registered in the first place.
contract CreditTierGate {
    address public owner;

    /// @notice Human-readable label for this band ("tier-60", "institutional-US"). Emitted at
    /// construction and stored purely so a block explorer or the dashboard can identify which
    /// gate is which — the validator knows these apart by address, humans do not.
    string public label;

    event OwnerUpdated(address previous, address current);

    error NotOwner();
    error ZeroAddress();

    constructor(string memory label_, address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        label = label_;
        owner = owner_;
    }

    /// @notice Transfer ownership. Kept because CCP re-registration is owner-signed, so losing
    /// the ability to rotate this key would strand the gate.
    function setOwner(address owner_) external {
        if (msg.sender != owner) revert NotOwner();
        if (owner_ == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, owner_);
        owner = owner_;
    }
}
