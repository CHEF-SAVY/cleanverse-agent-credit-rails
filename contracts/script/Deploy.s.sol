// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CreditLine} from "../src/CreditLine.sol";
import {CreditTierGate} from "../src/CreditTierGate.sol";
import {CreditPool} from "../src/CreditPool.sol";
import {JobEscrow} from "../src/JobEscrow.sol";

/// @title Deploy — the full identity-gated credit stack, one broadcast run
/// @notice Six ordered transactions from one deployer wallet. The ordering is forced by two
/// circular dependencies, each resolved the same way: the contract that can use an immutable
/// deploys second, and the one that cannot gets a one-time setter.
///
///   1. CreditTierGate x N — one registered CCP pool address per credit band
///   2. CreditPool         — depends on nothing but the asset
///   3. JobEscrow          — needs no prior address (CreditLine is set later)
///   4. CreditLine         — needs validator + pool + escrow addresses, all immutable
///   5. pool.setCreditLine    — closes the pool <-> line cycle
///   6. escrow.setCreditLine  — closes the escrow <-> line cycle
///   7. line.setTierBands     — binds each gate address to the limit it unlocks
///
/// After this runs there is one manual off-chain step before anything can be borrowed: register
/// **each CreditTierGate** with Cleanverse (`POST /api/cooperate/validator/grant`, then
/// `POST /api/cooperate/validator/register` carrying that band's RuleV2 `min_tier`). Registration
/// requires an EIP-191 personal_sign over `keccak256(chain + contract_address)` from the gate's
/// `owner()`. Until a gate is registered it simply never passes, so an unregistered deploy lends
/// nothing rather than lending unsafely. See CLAUDE.md §5.
contract Deploy is Script {
    // ERC-8004 canonical registries. Same addresses on Monad testnet as on Arc — verified on
    // 2026-08-08 by eth_call against IdentityRegistry.ownerOf(1), which returned a live owner
    // (0x1336…fd08), so these are real deployments here and not just matching bytecode.
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant VALIDATION_REGISTRY = 0x8004Cb1BF31DAf7788923b405b754f57acEB4272;

    // The settlement asset: AUSDC, Cleanverse's A-Token wrapping USDC on Monad testnet.
    // Deliberately read from the environment rather than hardcoded — unlike the two registries
    // above, this contract's address has not been verified from a primary source yet. Obtain it
    // from `POST /query_supported_atoken_list` (needs the api-id) and set ASSET_ADDRESS before
    // deploying. Guessing it would be exactly the kind of unverified constant that turns into a
    // silent testnet failure at demo time.
    //
    // To fund a wallet with AUSDC: `POST /query_deposit_address` for the A-Pass deposit address,
    // then use the Circle faucet (https://faucet.circle.com) on Monad Testnet against that
    // address. Confirmed by Cleanverse Labs, 2026-08-08.

    // Starting risk parameters. Deliberately conservative: an operator clearing only the lowest
    // band can commit a small line, and the earned-history ceiling is a small multiple of it
    // rather than unbounded. Tuned post-deploy via CreditLine's owner setters, so these are a
    // starting point, not a constraint baked into the deployment.
    //
    // The tier thresholds themselves live in each gate's RuleV2 on Cleanverse's side, not here —
    // that is the point of the design. These constants only say what each band is *worth*.
    uint256 constant BAND_1_LIMIT = 500e6;
    uint256 constant BAND_2_LIMIT = 2_500e6;
    uint256 constant BAND_3_LIMIT = 10_000e6;
    uint256 constant HISTORY_BONUS_PER_JOB = 100e6;
    uint256 constant MAX_HISTORY_BONUS = 5_000e6;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        // Reverts with a clear message if unset — see the ASSET_ADDRESS note above.
        address asset = vm.envAddress("ASSET_ADDRESS");
        // Cleanverse's CCP compliance validator (IAPassComplianceValidator) on the target
        // network. Env-read for the same reason as ASSET_ADDRESS: not yet verified from a
        // primary source, and this one is the root of the entire identity gate — a wrong or
        // guessed address here is the difference between an identity-gated lender and an
        // unsecured one.
        address validator = vm.envAddress("CCP_VALIDATOR_ADDRESS");

        vm.startBroadcast(deployerKey);

        // Deployer becomes owner (set automatically to msg.sender in every constructor) and,
        // separately, is passed to JobEscrow as the immutable ARBITER — a deliberate choice of
        // a fresh wallet distinct from the buyer/seller demo wallets, so the arbiter is a
        // genuinely separate party from both sides of any dispute it resolves.
        CreditTierGate band1 = new CreditTierGate("band-1", deployer);
        CreditTierGate band2 = new CreditTierGate("band-2", deployer);
        CreditTierGate band3 = new CreditTierGate("band-3", deployer);

        CreditPool pool = new CreditPool(asset);
        JobEscrow jobEscrow = new JobEscrow(asset, IDENTITY_REGISTRY, VALIDATION_REGISTRY, deployer);
        CreditLine creditLine = new CreditLine(asset, IDENTITY_REGISTRY, validator, address(pool), address(jobEscrow));

        pool.setCreditLine(address(creditLine));
        jobEscrow.setCreditLine(address(creditLine));

        CreditLine.TierBand[] memory bands = new CreditLine.TierBand[](3);
        bands[0] = CreditLine.TierBand({gate: address(band1), limit: BAND_1_LIMIT});
        bands[1] = CreditLine.TierBand({gate: address(band2), limit: BAND_2_LIMIT});
        bands[2] = CreditLine.TierBand({gate: address(band3), limit: BAND_3_LIMIT});
        creditLine.setTierBands(bands);
        creditLine.setHistoryBonus(HISTORY_BONUS_PER_JOB, MAX_HISTORY_BONUS);

        vm.stopBroadcast();

        console.log("CreditPool deployed at:", address(pool));
        console.log("CreditLine deployed at:", address(creditLine));
        console.log("JobEscrow deployed at: ", address(jobEscrow));
        console.log("TierGate band-1:", address(band1));
        console.log("TierGate band-2:", address(band2));
        console.log("TierGate band-3:", address(band3));
        console.log("CCP validator:", validator);
        console.log("Arbiter/Owner:", deployer);
        console.log("NEXT: register EACH TierGate via validator/grant + validator/register");
    }
}
