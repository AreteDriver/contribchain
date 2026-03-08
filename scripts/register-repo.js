const { ethers } = require("hardhat");

/**
 * Register a repo on ContribAttest.
 * Usage: REPO=AreteDriver/contribchain REPO_WALLET=0x... npx hardhat run scripts/register-repo.js --network base-sepolia
 */
async function main() {
  const repo = process.env.REPO;
  const repoWalletAddr = process.env.REPO_WALLET;
  const contractAddr = process.env.CONTRIB_ATTEST_ADDRESS;

  if (!repo || !repoWalletAddr || !contractAddr) {
    console.error("Required env vars: REPO, REPO_WALLET, CONTRIB_ATTEST_ADDRESS");
    process.exit(1);
  }

  const [owner] = await ethers.getSigners();
  const attest = await ethers.getContractAt("ContribAttest", contractAddr, owner);

  const repoHash = ethers.keccak256(ethers.toUtf8Bytes(repo));
  console.log(`Registering ${repo}`);
  console.log(`  repoHash: ${repoHash}`);
  console.log(`  wallet:   ${repoWalletAddr}`);

  const tx = await attest.registerRepo(repoHash, repoWalletAddr);
  await tx.wait();
  console.log(`  tx: ${tx.hash}`);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
