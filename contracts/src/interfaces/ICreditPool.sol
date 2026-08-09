// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Interface to CreditPool, limited to the calls CreditLine makes. Mirrors the real
/// contract's signatures exactly (contracts/src/CreditPool.sol) — our own contract, so unlike
/// IIdentityRegistry there's no external ABI to verify against.
interface ICreditPool {
    /// @notice Liquidity not already committed to outstanding draws — the ceiling on what new
    /// credit the pool can back.
    function availableLiquidity() external view returns (uint256);

    /// @notice Send `amount` of the pool's assets to `recipient` and book it as outstanding
    /// principal. Only CreditLine; called when a draw actually fires.
    function fundDraw(address recipient, uint256 amount) external;

    /// @notice Book a repayment whose tokens CreditLine has already transferred in. `premium`
    /// is pool income; `principal` retires outstanding debt.
    function recordRepayment(uint256 principal, uint256 premium) external;

    /// @notice Write outstanding principal off as uncollectable. The loss lands on lenders'
    /// share price — the whole point of an under-collateralized pool.
    function recordWriteOff(uint256 principal) external;

    /// @notice Book assets arriving against principal that was already written off. Pure income
    /// — the receivable is gone, so there is nothing left to retire — but recorded under its own
    /// event so a recovery is never mistaken for an ordinary repayment.
    function recordRecovery(uint256 amount) external;
}
