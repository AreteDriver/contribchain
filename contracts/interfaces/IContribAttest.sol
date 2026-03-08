// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IContribAttest — Interface for cross-contract reads by ContribPay.
interface IContribAttest {
    enum ContributionType {
        PR_MERGE,
        ISSUE_CLOSE,
        REVIEW_APPROVE
    }

    /// @notice Number of contributions by a specific contributor to a repo.
    function repoContributionCount(
        bytes32 repoHash,
        address contributor
    ) external view returns (uint256);

    /// @notice Address of the contributor at a given index for a repo.
    function repoContributors(
        bytes32 repoHash,
        uint256 index
    ) external view returns (address);

    /// @notice Total number of unique contributors for a repo.
    function repoContributorCount(
        bytes32 repoHash
    ) external view returns (uint256);

    /// @notice Whether an address has contributed to a repo.
    function isRepoContributor(
        bytes32 repoHash,
        address contributor
    ) external view returns (bool);
}
