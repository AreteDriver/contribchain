// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IContribAttest} from "./interfaces/IContribAttest.sol";

/// @title ContribPay — USDC deposit + credit-and-claim distribution for open source contributors.
/// @notice Companies deposit USDC for a repo. distribute() credits contributor balances
///         proportionally by on-chain contribution count. Contributors call withdraw() to claim.
/// @dev UUPS upgradeable (holds real funds). Pull pattern only — no push payments.
///      Inline reentrancy guard (proxy-safe, no constructor dependency).
contract ContribPay is
    OwnableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------
    // Reentrancy guard (proxy-safe)
    // ---------------------------------------------------------------

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    error ReentrancyGuardReentrantCall();

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrancyGuardReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    IContribAttest public attestContract;
    IERC20 public usdc;
    address public treasury;
    uint256 public feeBps;

    /// @notice Accumulated USDC deposited for each repo (not yet distributed).
    mapping(bytes32 => uint256) public repoBalance;

    /// @notice Claimable USDC balance per contributor (credited by distribute).
    mapping(address => uint256) public claimableBalance;

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    event Deposited(
        bytes32 indexed repoHash,
        address indexed depositor,
        uint256 amount
    );

    event PaymentDistributed(
        bytes32 indexed repoHash,
        uint256 totalDistributed,
        uint256 fee,
        uint256 contributorCount
    );

    event Withdrawn(address indexed contributor, uint256 amount);

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    error ZeroAmount();
    error ZeroContributors();
    error ZeroBalance();
    error InvalidBps();
    error IndexOutOfBounds();

    // ---------------------------------------------------------------
    // Initializer (replaces constructor for UUPS proxy)
    // ---------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the proxy instance.
    /// @param _attestContract ContribAttest contract for reading contribution weights.
    /// @param _usdc USDC token address on Base.
    /// @param _treasury Address receiving the fee portion of distributions.
    /// @param _feeBps Fee in basis points (200 = 2%).
    function initialize(
        address _attestContract,
        address _usdc,
        address _treasury,
        uint256 _feeBps
    ) external initializer {
        if (_feeBps > 10000) revert InvalidBps();

        __Ownable_init(msg.sender);
        _reentrancyStatus = _NOT_ENTERED;

        attestContract = IContribAttest(_attestContract);
        usdc = IERC20(_usdc);
        treasury = _treasury;
        feeBps = _feeBps;
    }

    // ---------------------------------------------------------------
    // Deposit
    // ---------------------------------------------------------------

    /// @notice Company deposits USDC for a repo.
    /// @dev Caller must approve this contract for `amount` USDC first.
    /// @param repoHash keccak256(owner/repo).
    /// @param amount USDC amount (6 decimals).
    function deposit(bytes32 repoHash, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        repoBalance[repoHash] += amount;

        emit Deposited(repoHash, msg.sender, amount);
    }

    // ---------------------------------------------------------------
    // Distribution — credit-and-claim
    // ---------------------------------------------------------------

    /// @notice Distribute a repo's accumulated USDC to contributor claimable balances.
    /// @dev Credits balances proportionally by contribution count. No USDC transfers
    ///      to contributors — only balance writes. Fee transferred to treasury.
    ///      Reverts if the repo has zero attested contributors.
    /// @param repoHash keccak256(owner/repo).
    function distribute(bytes32 repoHash) external nonReentrant {
        uint256 balance = repoBalance[repoHash];
        if (balance == 0) revert ZeroAmount();

        uint256 count = attestContract.repoContributorCount(repoHash);
        if (count == 0) revert ZeroContributors();

        _distributeRange(repoHash, 0, count, balance);
    }

    /// @notice Batch distribute for repos with many contributors.
    /// @dev Processes a slice [startIndex, endIndex) of the contributor array.
    ///      For repos with 500+ contributors, call multiple times with different ranges.
    ///      Fee is only deducted on the first batch (when full repoBalance is consumed).
    /// @param repoHash keccak256(owner/repo).
    /// @param startIndex Start of contributor slice (inclusive).
    /// @param endIndex End of contributor slice (exclusive).
    function batchDistribute(
        bytes32 repoHash,
        uint256 startIndex,
        uint256 endIndex
    ) external nonReentrant {
        uint256 balance = repoBalance[repoHash];
        if (balance == 0) revert ZeroAmount();

        uint256 count = attestContract.repoContributorCount(repoHash);
        if (count == 0) revert ZeroContributors();
        if (startIndex >= count || endIndex > count) revert IndexOutOfBounds();

        _distributeRange(repoHash, startIndex, endIndex, balance);
    }

    // ---------------------------------------------------------------
    // Withdraw — pull pattern
    // ---------------------------------------------------------------

    /// @notice Contributor withdraws their accumulated USDC balance.
    /// @dev Checks-effects-interactions: zeros balance before transfer.
    function withdraw() external nonReentrant {
        uint256 amount = claimableBalance[msg.sender];
        if (amount == 0) revert ZeroBalance();

        claimableBalance[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------
    // View
    // ---------------------------------------------------------------

    /// @notice Claimable USDC balance for a contributor.
    function getBalance(
        address contributor
    ) external view returns (uint256) {
        return claimableBalance[contributor];
    }

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------

    /// @notice Update the treasury address. Owner only.
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /// @notice Update the fee in basis points. Owner only.
    function setFeeBps(uint256 _feeBps) external onlyOwner {
        if (_feeBps > 10000) revert InvalidBps();
        feeBps = _feeBps;
    }

    // ---------------------------------------------------------------
    // UUPS upgrade authorization
    // ---------------------------------------------------------------

    /// @dev Only the owner can authorize upgrades.
    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}

    // ---------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------

    function _distributeRange(
        bytes32 repoHash,
        uint256 startIndex,
        uint256 endIndex,
        uint256 balance
    ) private {
        // Compute fee from total repo balance
        uint256 fee = (balance * feeBps) / 10000;
        uint256 distributable = balance - fee;

        // Sum total contributions across ALL contributors (not just this batch)
        uint256 totalCount = attestContract.repoContributorCount(repoHash);
        uint256 totalContributions = 0;
        for (uint256 i = 0; i < totalCount; i++) {
            address c = attestContract.repoContributors(repoHash, i);
            totalContributions += attestContract.repoContributionCount(
                repoHash,
                c
            );
        }

        // Credit this batch's contributors
        uint256 credited = 0;
        for (uint256 i = startIndex; i < endIndex; i++) {
            address contributor = attestContract.repoContributors(
                repoHash,
                i
            );
            uint256 contribCount = attestContract.repoContributionCount(
                repoHash,
                contributor
            );
            uint256 share = (distributable * contribCount) /
                totalContributions;
            claimableBalance[contributor] += share;
            credited += share;
        }

        // If this is a full distribution (all contributors processed), finalize
        if (startIndex == 0 && endIndex == totalCount) {
            // Transfer fee to treasury
            if (fee > 0) {
                usdc.safeTransfer(treasury, fee);
            }
            // Handle dust — any remainder from integer division goes to treasury
            uint256 dust = distributable - credited;
            if (dust > 0) {
                usdc.safeTransfer(treasury, dust);
            }
            repoBalance[repoHash] = 0;

            emit PaymentDistributed(repoHash, distributable, fee, totalCount);
        }
    }
}
