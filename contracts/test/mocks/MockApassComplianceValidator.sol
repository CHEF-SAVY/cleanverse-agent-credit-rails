// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IApassComplianceValidator} from "../../src/interfaces/IApassComplianceValidator.sol";

/// @notice Stand-in for Cleanverse's CCP compliance validator.
/// @dev Deliberately dumb: it stores per-(pool, user) verdicts instead of evaluating RuleV2
/// against a simulated CVI. Re-implementing their policy engine here would test our
/// reimplementation, not our integration — what actually matters on our side is how CreditLine
/// behaves given each possible answer, including a validator that reverts.
contract MockApassComplianceValidator is IApassComplianceValidator {
    mapping(address => mapping(address => bool)) public compliant;
    mapping(address => bool) public registered;
    mapping(address => RuleV2[]) private _rules;

    /// @notice When set, complianceVerify reverts for this pool — simulating an unregistered
    /// pool, a paused pool (CCP returns 12027 rather than a verdict), or an outage. CreditLine
    /// must treat all three as "does not qualify" and never as "qualifies".
    mapping(address => bool) public reverting;

    error ValidatorUnavailable();

    function setCompliant(address pool, address user, bool ok) external {
        compliant[pool][user] = ok;
        registered[pool] = true;
    }

    function setRegistered(address pool, bool ok) external {
        registered[pool] = ok;
    }

    function setReverting(address pool, bool ok) external {
        reverting[pool] = ok;
    }

    function pushRule(address pool, RuleV2 calldata rule) external {
        _rules[pool].push(rule);
        registered[pool] = true;
    }

    function complianceVerify(address poolAddress, address userAddress) external view returns (bool) {
        if (reverting[poolAddress]) revert ValidatorUnavailable();
        return compliant[poolAddress][userAddress];
    }

    function isRegistered(address poolAddress) external view returns (bool) {
        return registered[poolAddress];
    }

    function getRulesV2(address poolAddress) external view returns (RuleV2[] memory) {
        return _rules[poolAddress];
    }
}
