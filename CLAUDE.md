# ContribChain

> Proof of Contribution + Payment Rails for Open Source on Base (Ethereum L2)

---

## Quick Reference

| Item | Value |
|---|---|
| **Status** | Pre-code. Spec finalized. |
| **Repo** | `AreteDriver/contribchain` |
| **Chain** | Base (Ethereum L2) |
| **Payment token** | USDC |
| **Spec** | `~/Downloads/contribchain-spec.md` (canonical until moved into repo) |

---

## Architecture

Three on-chain primitives + off-chain tooling:

| Component | Type | Purpose |
|---|---|---|
| `ContribAttest.sol` | Immutable contract | Append-only contribution attestation registry |
| `ContribPay.sol` | UUPS proxy contract | USDC deposit + credit-and-claim distribution (2% fee) |
| `IContribAttest.sol` | Interface | Cross-contract reads for ContribPay |
| `contrib-attest-action` | GitHub Action (TS) | Writes attestations on PR merge |
| `registry/` | FastAPI service (Python) | GitHub username -> wallet mapping (gist-verified) |
| `viewer/` | Static SPA | ContribID reputation viewer (event-indexed) |
| `subgraph/` | The Graph | Event indexing for viewer + analytics |

### Data Flow
```
PR merged -> GitHub Action -> ContribAttest.attest() -> Base L2
Company -> ContribPay.deposit() -> distribute() credits balances -> contributor withdraw()
Viewer -> eth_getLogs / The Graph -> reads indexed events (never contract view functions)
```

---

## Stack

- **Contracts**: Solidity 0.8.x, OpenZeppelin (Ownable, IERC20, ReentrancyGuard, UUPSUpgradeable)
- **Toolchain**: Hardhat, ethers.js v6
- **Action**: TypeScript, @actions/core, @actions/github, ethers.js v6
- **Registry**: Python 3.11+, FastAPI, SQLite
- **Viewer**: Vanilla JS + TailwindCSS CDN (no build step)
- **Audit**: ChainLog SDK for payment distribution logging
- **Security**: slither before any mainnet deploy

---

## Project Structure

```
contribchain/
├── contracts/
│   ├── ContribAttest.sol
│   ├── ContribPay.sol
│   └── interfaces/
│       └── IContribAttest.sol
├── subgraph/
│   ├── schema.graphql
│   ├── subgraph.yaml
│   └── src/
│       └── mapping.ts
├── action/
│   ├── src/
│   │   └── action.ts
│   ├── action.yml
│   └── package.json
├── registry/
│   ├── app.py
│   ├── models.py
│   ├── verify.py
│   └── requirements.txt
├── viewer/
│   └── index.html
├── scripts/
│   ├── deploy.js
│   ├── register_repo.py
│   └── deposit.py
├── test/
│   ├── ContribAttest.test.js
│   └── ContribPay.test.js
├── hardhat.config.js
├── .env.example
└── CLAUDE.md
```

---

## Commands

```bash
# Install
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Security analysis
slither contracts/

# Deploy (testnet)
npx hardhat run scripts/deploy.js --network base-sepolia

# Registry (Python)
cd registry && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload

# Action (TypeScript)
cd action && npm install && npm run build
```

---

## Contract Design Rules

These are non-negotiable. Every contract change must respect these invariants.

### ContribAttest.sol
- **Append-only.** No delete. No update. Ever.
- **Duplicate guard:** `mapping(bytes32 => bool) attested` — revert on repeat `contentHash`.
- **Enum, not string:** `ContributionType { PR_MERGE, ISSUE_CLOSE, REVIEW_APPROVE }` (uint8). Never store strings on-chain.
- **contentHash formula:** `keccak256(pr_number + merge_sha + contributor_github_id)` — canonical, never change post-deploy.
- **Per-repo tracking:** `repoContributionCount`, `repoContributors`, `_isRepoContributor` mappings maintained on every `attest()`.
- **Paginated reads:** `getContributions(address, offset, limit)` — no unbounded array returns.
- **Event-first reads:** All three key fields indexed on `ContributionAttested`. Viewer reads events, not view functions.
- **Repo wallet only:** `onlyRegisteredRepo` modifier on `attest()`. No self-attestation.
- **Wallet rotation:** `rotateRepoWallet()` is owner-gated. Add timelock before mainnet.

### ContribPay.sol
- **Credit-and-claim:** `distribute()` writes to `claimableBalance` mappings only. No USDC transfers during distribution.
- **Pull pattern:** `withdraw()` is the ONLY function that transfers USDC to contributors.
- **Checks-effects-interactions:** zero balance before transfer in `withdraw()`.
- **Fee formula:** `fee = (repoBalance * feeBps) / 10000; distributable = repoBalance - fee`.
- **Zero-contributor revert:** `distribute()` reverts if repo has no attested contributions.
- **Batch support:** `batchDistribute(repoHash, startIndex, endIndex)` for 500+ contributor repos.
- **UUPS proxy:** upgradeable because it holds real funds. Owner-only `_authorizeUpgrade`. Timelock before mainnet.
- **ReentrancyGuard:** on `withdraw()`, `distribute()`, and `batchDistribute()`.

### IContribAttest.sol
- Exposes: `repoContributionCount`, `repoContributors`, `repoContributorCount`, `isRepoContributor`.
- ContribPay takes `IContribAttest` in constructor — not the concrete contract.

---

## GitHub Action Rules

- **Never fail CI.** All errors -> log warning + exit 0. Never block merges.
- **Never log secrets.** Use `@actions/core.setSecret()` for repo wallet key.
- **Wallet not found = growth loop.** Post PR comment inviting contributor to register.
- **NonceManager** for concurrent PR merge safety.
- **Exponential backoff** on RPC failures (3 attempts: 2s, 4s, 8s).
- **Inputs:** `contract-address`, `repo-wallet`, `contributor-registry`, `rpc-url`.

---

## Registry Rules

- **Gist-based verification.** Contributor signs message with wallet, publishes gist, registry verifies. No blind trust.
- **7-day cooldown** on wallet rotation.
- **Self-hostable.** Action accepts registry URL as input — never hardcoded.
- Registry is a convenience cache, not a trust root.

---

## ChainLog Integration

Every `distribute()` call writes a ChainLog entry:
- `action`: `"contribpay_distribute"`
- Fields: `repoHash`, `totalDistributed`, `fee`, `contributorCount`, `txHash`

Fire-and-forget. Double try/except. Never blocks or breaks distribution.

---

## Security Checklist

Before ANY mainnet deploy:
- [ ] `slither contracts/` passes clean
- [ ] All Hardhat tests pass
- [ ] No unbounded loops in contract functions
- [ ] `contentHash` duplicate guard tested (double-attest reverts)
- [ ] `withdraw()` checks-effects-interactions verified
- [ ] ReentrancyGuard on all state-changing + transfer functions
- [ ] UUPS upgrade authorization tested (only owner)
- [ ] Fee calculation tested (no rounding exploits at edge values)
- [ ] Zero-contributor distribute reverts
- [ ] No private keys in `.env` committed (gitleaks configured)
- [ ] `.env.example` has placeholder values only

---

## Environment Variables

```bash
# .env.example
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org
DEPLOYER_PRIVATE_KEY=0x_YOUR_DEPLOYER_KEY
CONTRIB_ATTEST_ADDRESS=0x_DEPLOYED_ADDRESS
CONTRIB_PAY_ADDRESS=0x_DEPLOYED_ADDRESS
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
TREASURY_ADDRESS=0x_YOUR_TREASURY
FEE_BPS=200
CHAINLOG_CONTRACT_ADDRESS=0x_CHAINLOG_ADDRESS
CONTRIB_REGISTRY_URL=https://registry.contribchain.xyz
```

---

## Testing Patterns

```javascript
// Hardhat test conventions
// - Use ethers.js v6 patterns (getContractFactory, parseUnits, etc.)
// - Test every revert condition explicitly
// - Test event emissions with expect().to.emit()
// - Use loadFixture for test isolation

// Critical test cases:
// ContribAttest:
//   - attest() from registered wallet succeeds
//   - attest() from non-registered wallet reverts
//   - attest() with duplicate contentHash reverts
//   - repoContributionCount increments correctly
//   - repoContributors array grows on first contribution per address
//   - paginated getContributions returns correct slice

// ContribPay:
//   - deposit() transfers USDC to contract
//   - distribute() credits proportional balances
//   - distribute() deducts correct fee to treasury
//   - distribute() reverts on zero contributors
//   - batchDistribute() processes correct slice
//   - withdraw() transfers correct USDC amount
//   - withdraw() zeros balance before transfer
//   - withdraw() with zero balance reverts or no-ops
//   - reentrancy attack on withdraw() blocked
```

---

## Git & CI

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`
- Branch protection on `main`
- CI: lint + compile + test + slither
- Security: gitleaks + dependabot + npm-audit
- Never commit `.env`. Only `.env.example`.

---

## Business Context

| Product | Price | Model |
|---|---|---|
| ContribAttest | Free | Distribution / network growth |
| ContribPay | 2% fee on flows | Infrastructure rake |
| ContribID Pro | $9/mo or $69/yr | Contributor credentialing |

Target: 10,000 repos attested in year one.

---

## Related ARETE Stack

| Component | Relationship |
|---|---|
| ChainLog | Audit layer for ContribPay distributions |
| AgentPay (future) | AI agents receive ContribPay payments |
| Base deployment | Same chain + wallet infra as ChainLog |

---

## Anti-Patterns

- **No unbounded arrays** in contract returns. Paginate or use events.
- **No string storage** on-chain. Use enums.
- **No push payments.** Pull pattern only (withdraw).
- **No hardcoded RPC URLs** in the action. Input parameter.
- **No trust in registry.** Gist verification is independently reproducible.
- **No silent deposit swallowing.** Zero-contributor distribute reverts.
