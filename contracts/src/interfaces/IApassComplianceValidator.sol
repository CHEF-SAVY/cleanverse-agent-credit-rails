// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice The Cleanverse Compliance Protocol (CCP) on-chain validator.
///
/// Transcribed from the "Cleanverse Compliance Protocol (CCP) Integration Guide (For CVI
/// Compliance Validator) V2" PDF — see docs/cleanverse/. Only the members we actually call are
/// declared; the full interface also carries Factory-mode registration entry points
/// (registerV2 / registerApass / setRuleV2FromRegistrar) which require REGISTER_ROLE and which
/// we perform off-chain through the Cooperate API instead.
///
/// CVI = Cleanverse Verified Identity, CVA = Cleanverse Verified Asset (confirmed in the guide's
/// own overview). This is the contract that makes the identity gate real: `complianceVerify` is
/// a permissionless view, so our lending logic can ask Cleanverse's own policy engine — inside
/// the borrowing transaction — whether a wallet qualifies, rather than trusting a mirrored
/// snapshot written by a backend key.
interface IApassComplianceValidator {
    /// @notice A single compliance policy. Fields *within* one RuleV2 are AND-ed; a pool may
    /// hold several RuleV2s, which are OR-ed. Country matching is a bitwise AND against
    /// poolCountryBitmap.
    /// @param allowedGroup Allowed CVI group; 0x0000 means unrestricted.
    /// @param allowedSubGroup Allowed CVI sub-group; 0x0000 means unrestricted.
    /// @param minTier Minimum CVI tier, 0–99; 0 means unrestricted.
    /// @param minSubTier Minimum CVI sub-tier, 0–99; 0 means unrestricted.
    /// @param poolCountryBitmap 256-bit country bitmap, bit positions corresponding to ISO
    /// 3166-1 numeric codes; 0 means unrestricted. Note this supersedes the legacy
    /// `is_black_list` + `countries` pair still exposed at the API layer.
    struct RuleV2 {
        bytes2 allowedGroup;
        bytes2 allowedSubGroup;
        uint8 minTier;
        uint8 minSubTier;
        uint256 poolCountryBitmap;
    }

    /// @notice Does `userAddress`'s CVI satisfy the rules registered for `poolAddress`?
    /// @dev Explicitly documented as requiring no permission, which is what lets a business
    /// contract call it inline. A `false` return is a normal answer — the user simply doesn't
    /// qualify — not an error condition.
    function complianceVerify(address poolAddress, address userAddress) external view returns (bool);

    /// @notice Is `poolAddress` registered with the validator at all? Used to tell "registered
    /// but the user doesn't qualify" apart from "we never completed registration", which are
    /// very different operational problems that `complianceVerify` alone reports identically.
    function isRegistered(address poolAddress) external view returns (bool);

    /// @notice The rules currently registered for `poolAddress`. Read-only; we manage rules
    /// through the Cooperate API rather than from the contract, so this exists for surfacing
    /// the live policy in the UI and for assertions in tests.
    function getRulesV2(address poolAddress) external view returns (RuleV2[] memory);
}
