const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // --- ContribAttest (immutable) ---
  const ContribAttest = await ethers.getContractFactory("ContribAttest");
  const attest = await ContribAttest.deploy();
  await attest.waitForDeployment();
  const attestAddr = await attest.getAddress();
  console.log("ContribAttest deployed to:", attestAddr);

  // --- ContribPay (UUPS proxy) ---
  const usdcAddress = process.env.USDC_ADDRESS;
  const treasuryAddress = process.env.TREASURY_ADDRESS;
  const feeBps = parseInt(process.env.FEE_BPS || "200");

  if (!usdcAddress || !treasuryAddress) {
    console.error("Set USDC_ADDRESS and TREASURY_ADDRESS in .env");
    process.exit(1);
  }

  const ContribPay = await ethers.getContractFactory("ContribPay");
  const pay = await upgrades.deployProxy(
    ContribPay,
    [attestAddr, usdcAddress, treasuryAddress, feeBps],
    { kind: "uups" }
  );
  await pay.waitForDeployment();
  const payAddr = await pay.getAddress();
  console.log("ContribPay proxy deployed to:", payAddr);

  console.log("\nUpdate .env:");
  console.log(`CONTRIB_ATTEST_ADDRESS=${attestAddr}`);
  console.log(`CONTRIB_PAY_ADDRESS=${payAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
