# ContribChain — Phase 1 TODO

## Deploy (next session)

- [ ] Fund dev wallet `0xFC68826e3b600405dd726CC7574b490955CaFF0F` with Base Sepolia ETH (~0.01)
  - Faucets: sepoliafaucet.com, portal.cdp.coinbase.com/products/faucet, app.optimism.io/faucet
- [ ] Deploy to Base Sepolia: `npx hardhat run scripts/deploy-testnet.js --network base-sepolia`
- [ ] Copy deployed addresses into `.env`
- [ ] Register first repo: `REPO=AreteDriver/contribchain REPO_WALLET=0xFC68... CONTRIB_ATTEST_ADDRESS=0x... npx hardhat run scripts/register-repo.js --network base-sepolia`
- [ ] Submit a test attestation manually (call `attest()` via Hardhat console or script)
- [ ] Verify contracts on Basescan: `npx hardhat verify --network base-sepolia <address>`

## GitHub Action

- [ ] Build action: `cd action && npm install && npm run build`
- [ ] Install on `AreteDriver/contribchain` as first test repo
- [ ] Add repo secrets: `REPO_WALLET_PRIVATE_KEY`, vars: `CONTRIB_ATTEST_CONTRACT`, `CONTRIB_REGISTRY_URL`, `BASE_RPC_URL`
- [ ] Merge a test PR and confirm attestation tx + PR comment

## Viewer

- [ ] Update `CONFIG` in `viewer/index.html` with deployed contract address + Sepolia RPC
- [ ] Test viewer against testnet attestations
- [ ] Host viewer (GitHub Pages or Vercel)

## Registry

- [ ] Test locally: `cd registry && pip install -r requirements.txt && uvicorn app:app --reload`
- [ ] Create a gist + register your own wallet via `/register` endpoint
- [ ] Verify `/wallet/AreteDriver` returns your wallet
- [ ] Deploy registry (Fly.io or similar)

## Subgraph (optional for Phase 1)

- [ ] Write `schema.graphql` + `subgraph.yaml` + `mapping.ts`
- [ ] Deploy to The Graph (hosted or Subgraph Studio)
- [ ] Wire viewer to use subgraph instead of direct `eth_getLogs`

## Batch register AreteDriver repos

- [ ] Script to loop `registerRepo()` for all 30+ repos
- [ ] Install `contrib-attest.yml` workflow on each repo

## Post-deploy

- [ ] Rotate dev wallet key (generate fresh for mainnet, never reuse testnet key)
- [ ] Run `slither contracts/` before any mainnet consideration
- [ ] Update CLAUDE.md with deployed addresses
