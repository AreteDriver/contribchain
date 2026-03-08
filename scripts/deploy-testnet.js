const { ethers, upgrades } = require("hardhat");

/**
 * Testnet deploy: deploys MockERC20 as USDC stand-in, ContribAttest, and ContribPay.
 * Usage: npx hardhat run scripts/deploy-testnet.js --network base-sepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // --- Mock USDC ---
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin (Test)", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("Mock USDC deployed to:", usdcAddr);

  // --- ContribAttest (immutable) ---
  const ContribAttest = await ethers.getContractFactory("ContribAttest");
  const attest = await ContribAttest.deploy();
  await attest.waitForDeployment();
  const attestAddr = await attest.getAddress();
  console.log("ContribAttest deployed to:", attestAddr);

  // --- ContribPay (UUPS proxy) — treasury = deployer for testnet ---
  const ContribPay = await ethers.getContractFactory("ContribPay");
  const pay = await upgrades.deployProxy(
    ContribPay,
    [attestAddr, usdcAddr, deployer.address, 200],
    { kind: "uups" }
  );
  await pay.waitForDeployment();
  const payAddr = await pay.getAddress();
  console.log("ContribPay proxy deployed to:", payAddr);

  console.log("\n--- Copy to .env ---");
  console.log(`CONTRIB_ATTEST_ADDRESS=${attestAddr}`);
  console.log(`CONTRIB_PAY_ADDRESS=${payAddr}`);
  console.log(`USDC_ADDRESS=${usdcAddr}`);
  console.log(`TREASURY_ADDRESS=${deployer.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
