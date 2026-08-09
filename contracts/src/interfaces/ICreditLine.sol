// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Interface to CreditLine, limited to the calls JobEscrow makes. Mirrors the real
/// contract's signatures exactly (contracts/src/CreditLine.sol).
///
/// Shaped to slot in where ISellerBond used to sit, with one deliberate change:
/// `releaseReservation` now carries the job's outcome, because a credit line — unlike a posted
/// bond — has a memory. Completing jobs is what grows an agent's limit.
interface ICreditLine {
    /// @notice Commit `amount` of the agent's credit line to a job. Reverts if the agent is
    /// unverified, over its mandate, delinquent, or out of headroom.
    function reserve(uint256 agentId, uint256 amount) external;

    /// @notice Release a commitment the job no longer needs.
    /// @param countsAsCompletion True when the job actually resolved in the seller's favour
    /// (buyer released, or a dispute cleared them) — that increments job history and grows the
    /// limit. False for a timeout, where nobody confirmed anything.
    function releaseReservation(uint256 agentId, uint256 amount, bool countsAsCompletion) external;

    /// @notice Draw `amount` from the pool to `recipient` against the agent's committed credit,
    /// leaving the agent owing it as debt.
    function slash(uint256 agentId, uint256 amount, address recipient) external;

    /// @notice Headroom the agent can still commit to new jobs.
    function availableCredit(uint256 agentId) external view returns (uint256);

    /// @notice Every agent's live commitments, summed. Read by CreditPool to work out how much
    /// of its idle balance is already promised and therefore not withdrawable — the pool is the
    /// caller here, not JobEscrow, but it belongs on the same interface because it is part of
    /// the same solvency invariant the other four calls maintain.
    function totalReserved() external view returns (uint256);
}
