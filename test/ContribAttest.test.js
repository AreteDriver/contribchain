const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("ContribAttest", function () {
  async function deployFixture() {
    const [owner, repoWallet, contributor, other] = await ethers.getSigners();

    const ContribAttest = await ethers.getContractFactory("ContribAttest");
    const attest = await ContribAttest.deploy();

    const repoHash = ethers.keccak256(ethers.toUtf8Bytes("AreteDriver/contribchain"));
    const contentHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "bytes32", "string"],
        [1, ethers.keccak256(ethers.toUtf8Bytes("abc123")), "contributor1"]
      )
    );

    return { attest, owner, repoWallet, contributor, other, repoHash, contentHash };
  }

  describe("registerRepo", function () {
    it("should register a repo wallet", async function () {
      const { attest, repoWallet, repoHash } = await loadFixture(deployFixture);

      await expect(attest.registerRepo(repoHash, repoWallet.address))
        .to.emit(attest, "RepoRegistered")
        .withArgs(repoHash, repoWallet.address);

      expect(await attest.repoWallet(repoHash)).to.equal(repoWallet.address);
    });

    it("should revert if non-owner calls registerRepo", async function () {
      const { attest, repoWallet, other, repoHash } = await loadFixture(deployFixture);

      await expect(
        attest.connect(other).registerRepo(repoHash, repoWallet.address)
      ).to.be.revertedWithCustomError(attest, "OwnableUnauthorizedAccount");
    });

    it("should revert on zero address wallet", async function () {
      const { attest, repoHash } = await loadFixture(deployFixture);

      await expect(
        attest.registerRepo(repoHash, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(attest, "ZeroAddress");
    });
  });

  describe("rotateRepoWallet", function () {
    it("should rotate the repo wallet", async function () {
      const { attest, repoWallet, other, repoHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      await expect(attest.rotateRepoWallet(repoHash, other.address))
        .to.emit(attest, "RepoWalletRotated")
        .withArgs(repoHash, repoWallet.address, other.address);

      expect(await attest.repoWallet(repoHash)).to.equal(other.address);
    });

    it("should revert on unregistered repo", async function () {
      const { attest, other, repoHash } = await loadFixture(deployFixture);

      await expect(
        attest.rotateRepoWallet(repoHash, other.address)
      ).to.be.revertedWithCustomError(attest, "RepoNotRegistered");
    });

    it("should revert on zero address", async function () {
      const { attest, repoWallet, repoHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      await expect(
        attest.rotateRepoWallet(repoHash, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(attest, "ZeroAddress");
    });
  });

  describe("attest", function () {
    it("should record a contribution", async function () {
      const { attest, repoWallet, contributor, repoHash, contentHash } =
        await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      await expect(
        attest
          .connect(repoWallet)
          .attest(contributor.address, repoHash, contentHash, 0) // PR_MERGE
      )
        .to.emit(attest, "ContributionAttested")
        .withArgs(contributor.address, repoHash, contentHash, 0, (v) => v > 0);

      expect(await attest.repoContributionCount(repoHash, contributor.address)).to.equal(1);
      expect(await attest.repoContributorCount(repoHash)).to.equal(1);
      expect(await attest.isRepoContributor(repoHash, contributor.address)).to.be.true;
      expect(await attest.attested(contentHash)).to.be.true;
    });

    it("should revert on duplicate contentHash", async function () {
      const { attest, repoWallet, contributor, repoHash, contentHash } =
        await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);
      await attest.connect(repoWallet).attest(contributor.address, repoHash, contentHash, 0);

      await expect(
        attest.connect(repoWallet).attest(contributor.address, repoHash, contentHash, 0)
      ).to.be.revertedWithCustomError(attest, "AlreadyAttested");
    });

    it("should revert if caller is not the repo wallet", async function () {
      const { attest, repoWallet, contributor, other, repoHash, contentHash } =
        await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      await expect(
        attest.connect(other).attest(contributor.address, repoHash, contentHash, 0)
      ).to.be.revertedWithCustomError(attest, "NotRepoWallet");
    });

    it("should revert on unregistered repo", async function () {
      const { attest, repoWallet, contributor, contentHash } =
        await loadFixture(deployFixture);

      const fakeRepo = ethers.keccak256(ethers.toUtf8Bytes("fake/repo"));

      await expect(
        attest.connect(repoWallet).attest(contributor.address, fakeRepo, contentHash, 0)
      ).to.be.revertedWithCustomError(attest, "RepoNotRegistered");
    });

    it("should revert on zero address contributor", async function () {
      const { attest, repoWallet, repoHash, contentHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      await expect(
        attest.connect(repoWallet).attest(ethers.ZeroAddress, repoHash, contentHash, 0)
      ).to.be.revertedWithCustomError(attest, "ZeroAddress");
    });

    it("should track multiple contributions from same contributor", async function () {
      const { attest, repoWallet, contributor, repoHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("pr1"));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("pr2"));

      await attest.connect(repoWallet).attest(contributor.address, repoHash, hash1, 0);
      await attest.connect(repoWallet).attest(contributor.address, repoHash, hash2, 1);

      expect(await attest.repoContributionCount(repoHash, contributor.address)).to.equal(2);
      // Still one unique contributor
      expect(await attest.repoContributorCount(repoHash)).to.equal(1);
    });

    it("should track multiple unique contributors", async function () {
      const { attest, repoWallet, contributor, other, repoHash } =
        await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("pr1"));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("pr2"));

      await attest.connect(repoWallet).attest(contributor.address, repoHash, hash1, 0);
      await attest.connect(repoWallet).attest(other.address, repoHash, hash2, 0);

      expect(await attest.repoContributorCount(repoHash)).to.equal(2);
      expect(await attest.repoContributors(repoHash, 0)).to.equal(contributor.address);
      expect(await attest.repoContributors(repoHash, 1)).to.equal(other.address);
    });

    it("should support all contribution types", async function () {
      const { attest, repoWallet, contributor, repoHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      const hashes = [
        ethers.keccak256(ethers.toUtf8Bytes("pr")),
        ethers.keccak256(ethers.toUtf8Bytes("issue")),
        ethers.keccak256(ethers.toUtf8Bytes("review")),
      ];

      for (let i = 0; i < 3; i++) {
        await attest.connect(repoWallet).attest(contributor.address, repoHash, hashes[i], i);
      }

      expect(await attest.repoContributionCount(repoHash, contributor.address)).to.equal(3);
    });
  });

  describe("paginated reads", function () {
    it("should paginate contributor history", async function () {
      const { attest, repoWallet, contributor, repoHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      // Create 5 attestations
      for (let i = 0; i < 5; i++) {
        const hash = ethers.keccak256(ethers.toUtf8Bytes(`pr${i}`));
        await attest.connect(repoWallet).attest(contributor.address, repoHash, hash, 0);
      }

      const page1 = await attest.getContributions(contributor.address, 0, 3);
      expect(page1.length).to.equal(3);

      const page2 = await attest.getContributions(contributor.address, 3, 3);
      expect(page2.length).to.equal(2);

      // Out of range offset
      const empty = await attest.getContributions(contributor.address, 10, 3);
      expect(empty.length).to.equal(0);
    });

    it("should paginate repo history", async function () {
      const { attest, repoWallet, contributor, repoHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      for (let i = 0; i < 3; i++) {
        const hash = ethers.keccak256(ethers.toUtf8Bytes(`pr${i}`));
        await attest.connect(repoWallet).attest(contributor.address, repoHash, hash, 0);
      }

      const all = await attest.getRepoContributions(repoHash, 0, 100);
      expect(all.length).to.equal(3);
    });
  });

  describe("totals", function () {
    it("should return correct contributorTotal and repoTotal", async function () {
      const { attest, repoWallet, contributor, repoHash } = await loadFixture(deployFixture);

      await attest.registerRepo(repoHash, repoWallet.address);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("pr1"));
      await attest.connect(repoWallet).attest(contributor.address, repoHash, hash, 0);

      expect(await attest.contributorTotal(contributor.address)).to.equal(1);
      expect(await attest.repoTotal(repoHash)).to.equal(1);
    });
  });
});
