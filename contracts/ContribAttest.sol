// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IContribAttest} from "./interfaces/IContribAttest.sol";

/// @title ContribAttest — Append-only registry of verified open source contributions.
/// @notice One attestation per merged PR/issue/review. No delete. No update.
/// @dev Store on-chain, read via indexed events. Paginated view functions are fallback only.
contract ContribAttest is Ownable, IContribAttest {
    // ---------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------

    struct Contribution {
        address contributor;
        bytes32 repoHash;
        bytes32 contentHash;
        ContributionType contribType;
        uint256 timestamp;
    }

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    /// @notice Duplicate guard — each contentHash attested at most once.
    mapping(bytes32 => bool) public attested;

    /// @notice Registered repo wallet that may submit attestations.
    mapping(bytes32 => address) public repoWallet;

    /// @notice Contribution count per (repo, contributor).
    mapping(bytes32 => mapping(address => uint256))
        public override repoContributionCount;

    /// @notice Ordered list of unique contributors per repo.
    mapping(bytes32 => address[]) private _repoContributors;

    /// @notice Fast lookup: has this address contributed to this repo?
    mapping(bytes32 => mapping(address => bool)) private _isRepoContributor;

    /// @notice All contributions by a given contributor (append-only).
    mapping(address => Contribution[]) private _contributorHistory;

    /// @notice All contributions for a given repo (append-only).
    mapping(bytes32 => Contribution[]) private _repoHistory;

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    event ContributionAttested(
        address indexed contributor,
        bytes32 indexed repoHash,
        bytes32 indexed contentHash,
        ContributionType contribType,
        uint256 timestamp
    );

    event RepoRegistered(
        bytes32 indexed repoHash,
        address indexed repoWallet
    );

    event RepoWalletRotated(
        bytes32 indexed repoHash,
        address indexed oldWallet,
        address indexed newWallet
    );

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    error NotRepoWallet();
    error AlreadyAttested();
    error RepoNotRegistered();
    error ZeroAddress();

    // ---------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------

    modifier onlyRegisteredRepo(bytes32 repoHash) {
        if (repoWallet[repoHash] == address(0)) revert RepoNotRegistered();
        if (msg.sender != repoWallet[repoHash]) revert NotRepoWallet();
        _;
    }

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    constructor() Ownable(msg.sender) {}

    // ---------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------

    /// @notice Register a repo and its authorized wallet.
    /// @param repoHash keccak256(owner/repo).
    /// @param _repoWallet Address authorized to submit attestations for this repo.
    function registerRepo(
        bytes32 repoHash,
        address _repoWallet
    ) external onlyOwner {
        if (_repoWallet == address(0)) revert ZeroAddress();
        repoWallet[repoHash] = _repoWallet;
        emit RepoRegistered(repoHash, _repoWallet);
    }

    /// @notice Rotate the authorized wallet for a repo. Owner-gated.
    /// @dev TODO: Add timelock (48h delay) before mainnet.
    /// @param repoHash Target repo.
    /// @param newWallet New authorized wallet address.
    function rotateRepoWallet(
        bytes32 repoHash,
        address newWallet
    ) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        address oldWallet = repoWallet[repoHash];
        if (oldWallet == address(0)) revert RepoNotRegistered();
        repoWallet[repoHash] = newWallet;
        emit RepoWalletRotated(repoHash, oldWallet, newWallet);
    }

    // ---------------------------------------------------------------
    // Attestation
    // ---------------------------------------------------------------

    /// @notice Record a verified contribution on-chain.
    /// @dev Reverts on duplicate contentHash. Caller must be the registered repo wallet.
    /// @param contributor Wallet address of the contributor.
    /// @param repoHash keccak256(owner/repo).
    /// @param contentHash keccak256(pr_number + merge_sha + contributor_github_id).
    /// @param contribType PR_MERGE, ISSUE_CLOSE, or REVIEW_APPROVE.
    function attest(
        address contributor,
        bytes32 repoHash,
        bytes32 contentHash,
        ContributionType contribType
    ) external onlyRegisteredRepo(repoHash) {
        if (contributor == address(0)) revert ZeroAddress();
        if (attested[contentHash]) revert AlreadyAttested();

        attested[contentHash] = true;

        // Track unique contributors per repo
        if (!_isRepoContributor[repoHash][contributor]) {
            _isRepoContributor[repoHash][contributor] = true;
            _repoContributors[repoHash].push(contributor);
        }
        repoContributionCount[repoHash][contributor]++;

        Contribution memory c = Contribution({
            contributor: contributor,
            repoHash: repoHash,
            contentHash: contentHash,
            contribType: contribType,
            timestamp: block.timestamp
        });

        _contributorHistory[contributor].push(c);
        _repoHistory[repoHash].push(c);

        emit ContributionAttested(
            contributor,
            repoHash,
            contentHash,
            contribType,
            block.timestamp
        );
    }

    // ---------------------------------------------------------------
    // Reads — paginated (prefer event indexing)
    // ---------------------------------------------------------------

    /// @notice Paginated contributions for a contributor.
    /// @param contributor Wallet address.
    /// @param offset Start index.
    /// @param limit Max entries to return.
    /// @return contributions Slice of the contributor's history.
    function getContributions(
        address contributor,
        uint256 offset,
        uint256 limit
    ) external view returns (Contribution[] memory contributions) {
        return _paginate(_contributorHistory[contributor], offset, limit);
    }

    /// @notice Paginated contributions for a repo.
    /// @param repoHash keccak256(owner/repo).
    /// @param offset Start index.
    /// @param limit Max entries to return.
    /// @return contributions Slice of the repo's history.
    function getRepoContributions(
        bytes32 repoHash,
        uint256 offset,
        uint256 limit
    ) external view returns (Contribution[] memory contributions) {
        return _paginate(_repoHistory[repoHash], offset, limit);
    }

    // ---------------------------------------------------------------
    // Count accessors (used by ContribPay)
    // ---------------------------------------------------------------

    /// @notice Total unique contributors for a repo.
    function repoContributorCount(
        bytes32 repoHash
    ) external view override returns (uint256) {
        return _repoContributors[repoHash].length;
    }

    /// @notice Address of contributor at index for a repo.
    function repoContributors(
        bytes32 repoHash,
        uint256 index
    ) external view override returns (address) {
        return _repoContributors[repoHash][index];
    }

    /// @notice Whether an address has contributed to a repo.
    function isRepoContributor(
        bytes32 repoHash,
        address contributor
    ) external view override returns (bool) {
        return _isRepoContributor[repoHash][contributor];
    }

    /// @notice Total attestations stored for a contributor.
    function contributorTotal(
        address contributor
    ) external view returns (uint256) {
        return _contributorHistory[contributor].length;
    }

    /// @notice Total attestations stored for a repo.
    function repoTotal(bytes32 repoHash) external view returns (uint256) {
        return _repoHistory[repoHash].length;
    }

    // ---------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------

    function _paginate(
        Contribution[] storage source,
        uint256 offset,
        uint256 limit
    ) private view returns (Contribution[] memory) {
        uint256 total = source.length;
        if (offset >= total) {
            return new Contribution[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 size = end - offset;
        Contribution[] memory result = new Contribution[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = source[offset + i];
        }
        return result;
    }
}
