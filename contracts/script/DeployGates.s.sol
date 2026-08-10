// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CreditTierGate} from "../src/CreditTierGate.sol";

/// @title DeployGates — deploy the three credit-band gates on their own
/// @notice Split out from `Deploy.s.sol` deliberately. `CreditTierGate` has no constructor
/// dependencies at all — no asset, no registry, and crucially no `CCP_VALIDATOR_ADDRESS`, which
/// is the one thing still missing from a full deploy. So the gates can go out, be registered as
/// Cleanverse compliance pools, and have their rules proven end-to-end while the rest of the
/// stack is still blocked.
///
/// That ordering is worth keeping even once nothing is blocked: registration is the step most
/// likely to fail (it needs Issue Member role and an owner signature Cleanverse has to accept),
/// and finding that out costs three cheap deploys rather than a full one.
///
/// Gates deployed here are the same addresses passed to `CreditLine.setTierBands` later — there
/// is no need to redeploy them with the rest.
contract DeployGates is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Labels match `CREDIT_BANDS` in apps/web/lib/cleanverse/bands.ts, which carries the
        // matching rule and limit for each. Keep the two in step.
        CreditTierGate band1 = new CreditTierGate("band-1", deployer);
        CreditTierGate band2 = new CreditTierGate("band-2", deployer);
        CreditTierGate band3 = new CreditTierGate("band-3", deployer);

        vm.stopBroadcast();

        console.log("GATE_BAND_1=%s", address(band1));
        console.log("GATE_BAND_2=%s", address(band2));
        console.log("GATE_BAND_3=%s", address(band3));
        console.log("owner=%s", deployer);
        console.log("NEXT: POST /api/admin/pools/register for each gate");
    }
}
