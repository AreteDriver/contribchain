const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("ContribPay", function () {
  async function deployFixture() {
    const [owner, repoWallet, contributor1, contributor2, company, treasury] =
      await ethers.getSigners();

    // Deploy mock USDC (standard ERC20)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    // Deploy ContribAttest
    const ContribAttest = await ethers.getContractFactory("ContribAttest");
    const attest = await ContribAttest.deploy();

    // Deploy ContribPay (UUPS proxy)
    const ContribPay = await ethers.getContractFactory("ContribPay");
    const pay = await upgrades.deployProxy(
      ContribPay,
      [
        await attest.getAddress(),
        await usdc.getAddress(),
        treasury.address,
        200, // 2% fee
      ],
      { kind: "uups" }
    );

    const repoHash = ethers.keccak256(ethers.toUtf8Bytes("AreteDriver/contribchain"));

    // Register repo
    await attest.registerRepo(repoHash, repoWallet.address);

    // Mint USDC to company
    const depositAmount = ethers.parseUnits("1000", 6); // 1000 USDC
    await usdc.mint(company.address, depositAmount);
    await usdc.connect(company).approve(await pay.getAddress(), depositAmount);

    return {
      attest,
      pay,
      usdc,
      owner,
      repoWallet,
      contributor1,
      contributor2,
      company,
      treasury,
      repoHash,
      depositAmount,
    };
  }

  // Helper: attest a contribution
  async function attestContribution(attest, repoWallet, contributor, repoHash, id, type = 0) {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(`contrib-${id}`));
    await attest.connect(repoWallet).attest(contributor, repoHash, hash, type);
  }

  describe("deposit", function () {
    it("should accept USDC deposits", async function () {
      const { pay, usdc, company, repoHash } = await loadFixture(deployFixture);

      const amount = ethers.parseUnits("500", 6);

      await expect(pay.connect(company).deposit(repoHash, amount))
        .to.emit(pay, "Deposited")
        .withArgs(repoHash, company.address, amount);

      expect(await pay.repoBalance(repoHash)).to.equal(amount);
      expect(await usdc.balanceOf(await pay.getAddress())).to.equal(amount);
    });

    it("should revert on zero amount", async function () {
      const { pay, company, repoHash } = await loadFixture(deployFixture);

      await expect(
        pay.connect(company).deposit(repoHash, 0)
      ).to.be.revertedWithCustomError(pay, "ZeroAmount");
    });

    it("should accumulate multiple deposits", async function () {
      const { pay, company, repoHash } = await loadFixture(deployFixture);

      const amount = ethers.parseUnits("100", 6);
      await pay.connect(company).deposit(repoHash, amount);
      await pay.connect(company).deposit(repoHash, amount);

      expect(await pay.repoBalance(repoHash)).to.equal(amount * 2n);
    });
  });

  describe("distribute", function () {
    it("should credit contributors proportionally", async function () {
      const { attest, pay, repoWallet, contributor1, contributor2, company, treasury, repoHash } =
        await loadFixture(deployFixture);

      // contributor1: 3 contributions, contributor2: 1 contribution
      await attestContribution(attest, repoWallet, contributor1.address, repoHash, "1");
      await attestContribution(attest, repoWallet, contributor1.address, repoHash, "2");
      await attestContribution(attest, repoWallet, contributor1.address, repoHash, "3");
      await attestContribution(attest, repoWallet, contributor2.address, repoHash, "4");

      // Deposit 1000 USDC
      const amount = ethers.parseUnits("1000", 6);
      await pay.connect(company).deposit(repoHash, amount);

      await expect(pay.distribute(repoHash))
        .to.emit(pay, "PaymentDistributed");

      // Fee: 1000 * 200 / 10000 = 20 USDC
      // Distributable: 980 USDC
      // contributor1: 980 * 3/4 = 735 USDC
      // contributor2: 980 * 1/4 = 245 USDC
      expect(await pay.claimableBalance(contributor1.address)).to.equal(
        ethers.parseUnits("735", 6)
      );
      expect(await pay.claimableBalance(contributor2.address)).to.equal(
        ethers.parseUnits("245", 6)
      );

      expect(await pay.repoBalance(repoHash)).to.equal(0);
    });

    it("should revert on zero-contributor repo", async function () {
      const { pay, company, repoHash } = await loadFixture(deployFixture);

      await pay.connect(company).deposit(repoHash, ethers.parseUnits("100", 6));

      await expect(pay.distribute(repoHash)).to.be.revertedWithCustomError(
        pay,
        "ZeroContributors"
      );
    });

    it("should revert on zero balance repo", async function () {
      const { pay, repoHash } = await loadFixture(deployFixture);

      await expect(pay.distribute(repoHash)).to.be.revertedWithCustomError(
        pay,
        "ZeroAmount"
      );
    });

    it("should send fee to treasury", async function () {
      const { attest, pay, usdc, repoWallet, contributor1, company, treasury, repoHash } =
        await loadFixture(deployFixture);

      await attestContribution(attest, repoWallet, contributor1.address, repoHash, "1");

      const amount = ethers.parseUnits("1000", 6);
      await pay.connect(company).deposit(repoHash, amount);
      await pay.distribute(repoHash);

      // 2% of 1000 = 20 USDC to treasury
      expect(await usdc.balanceOf(treasury.address)).to.equal(
        ethers.parseUnits("20", 6)
      );
    });
  });

  describe("batchDistribute", function () {
    it("should revert on out-of-bounds index", async function () {
      const { attest, pay, repoWallet, contributor1, company, repoHash } =
        await loadFixture(deployFixture);

      await attestContribution(attest, repoWallet, contributor1.address, repoHash, "1");
      await pay.connect(company).deposit(repoHash, ethers.parseUnits("100", 6));

      await expect(
        pay.batchDistribute(repoHash, 0, 5)
      ).to.be.revertedWithCustomError(pay, "IndexOutOfBounds");
    });
  });

  describe("withdraw", function () {
    it("should transfer claimable USDC to contributor", async function () {
      const { attest, pay, usdc, repoWallet, contributor1, company, repoHash } =
        await loadFixture(deployFixture);

      await attestContribution(attest, repoWallet, contributor1.address, repoHash, "1");

      await pay.connect(company).deposit(repoHash, ethers.parseUnits("1000", 6));
      await pay.distribute(repoHash);

      // 980 USDC claimable (1000 - 2% fee)
      const expectedBalance = ethers.parseUnits("980", 6);
      expect(await pay.claimableBalance(contributor1.address)).to.equal(expectedBalance);

      await expect(pay.connect(contributor1).withdraw())
        .to.emit(pay, "Withdrawn")
        .withArgs(contributor1.address, expectedBalance);

      expect(await usdc.balanceOf(contributor1.address)).to.equal(expectedBalance);
      expect(await pay.claimableBalance(contributor1.address)).to.equal(0);
    });

    it("should revert on zero balance", async function () {
      const { pay, contributor1 } = await loadFixture(deployFixture);

      await expect(
        pay.connect(contributor1).withdraw()
      ).to.be.revertedWithCustomError(pay, "ZeroBalance");
    });
  });

  describe("admin", function () {
    it("should allow owner to update treasury", async function () {
      const { pay, contributor1 } = await loadFixture(deployFixture);

      await pay.setTreasury(contributor1.address);
      expect(await pay.treasury()).to.equal(contributor1.address);
    });

    it("should allow owner to update fee", async function () {
      const { pay } = await loadFixture(deployFixture);

      await pay.setFeeBps(300); // 3%
      expect(await pay.feeBps()).to.equal(300);
    });

    it("should revert on invalid fee bps", async function () {
      const { pay } = await loadFixture(deployFixture);

      await expect(pay.setFeeBps(10001)).to.be.revertedWithCustomError(pay, "InvalidBps");
    });

    it("should reject non-owner admin calls", async function () {
      const { pay, contributor1 } = await loadFixture(deployFixture);

      await expect(
        pay.connect(contributor1).setTreasury(contributor1.address)
      ).to.be.revertedWithCustomError(pay, "OwnableUnauthorizedAccount");

      await expect(
        pay.connect(contributor1).setFeeBps(500)
      ).to.be.revertedWithCustomError(pay, "OwnableUnauthorizedAccount");
    });
  });

  describe("getBalance", function () {
    it("should return claimable balance", async function () {
      const { pay, contributor1 } = await loadFixture(deployFixture);

      expect(await pay.getBalance(contributor1.address)).to.equal(0);
    });
  });
});
