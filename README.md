# ContribChain

Proof of Contribution + Payment Rails for Open Source on Base L2.

An on-chain system that records open-source contributions as immutable attestations on Base (Ethereum L2) and enables USDC payment distribution to contributors proportional to their work. Includes a GitHub Action for automatic attestation on PR merge, a contributor wallet registry, and a reputation viewer.

## Architecture

| Component | Description |
|---|---|
| `ContribAttest.sol` | Append-only contribution attestation registry |
| `ContribPay.sol` | USDC deposit + credit-and-claim distribution (2% fee) |
| GitHub Action | Writes attestations on PR merge |
| Registry | FastAPI service for GitHub username to wallet mapping |
| Viewer | Static SPA for contribution reputation |
| Subgraph | The Graph indexer for events |

## Features

- Immutable on-chain contribution attestations (PR merge, issue close, review approve)
- USDC payment distribution proportional to contributions
- Pull-pattern withdrawals (contributors claim, no push payments)
- GitHub Action for automated attestation
- Gist-based wallet verification (no blind trust)
- Paginated reads and event-first data access
- ChainLog integration for audit trails

## Installation

```bash
npm install
```

## Usage

```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Base Sepolia testnet
npx hardhat run scripts/deploy.js --network base-sepolia

# Security analysis
slither contracts/

# Run registry (Python)
cd registry && pip install -r requirements.txt
uvicorn app:app --reload
```

## Stack

- **Contracts**: Solidity 0.8.x, OpenZeppelin, Hardhat
- **Action**: TypeScript, @actions/core, ethers.js v6
- **Registry**: Python 3.11+, FastAPI, SQLite
- **Viewer**: Vanilla JS + TailwindCSS
- **Chain**: Base (Ethereum L2), USDC

## Status

Pre-deploy. Contracts and tests complete. Mainnet deploy blocked on funded Base Sepolia wallet.

## License

MIT
