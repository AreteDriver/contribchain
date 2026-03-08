import * as core from "@actions/core";
import * as github from "@actions/github";
import { ethers } from "ethers";

const CONTRIB_ATTEST_ABI = [
  "function attest(address contributor, bytes32 repoHash, bytes32 contentHash, uint8 contribType) external",
];

const CONTRIBUTION_TYPES = {
  pr_merge: 0,
  issue_close: 1,
  review_approve: 2,
} as const;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookupWallet(
  registryUrl: string,
  username: string
): Promise<string | null> {
  const url = `${registryUrl}/wallet/${encodeURIComponent(username)}`;
  try {
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    if (!resp.ok) {
      core.warning(`Registry returned ${resp.status} for ${username}`);
      return null;
    }
    const data = (await resp.json()) as { wallet: string };
    return data.wallet;
  } catch (err) {
    core.warning(`Registry lookup failed: ${err}`);
    return null;
  }
}

async function postComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  } catch (err) {
    core.warning(`Failed to post PR comment: ${err}`);
  }
}

async function run(): Promise<void> {
  try {
    const contractAddress = core.getInput("contract-address", {
      required: true,
    });
    const repoWalletKey = core.getInput("repo-wallet", { required: true });
    const registryUrl = core.getInput("contributor-registry", {
      required: true,
    });
    const rpcUrl = core.getInput("rpc-url") || "https://mainnet.base.org";

    // Mask the private key in all logs
    core.setSecret(repoWalletKey);

    const context = github.context;
    const { owner, repo } = context.repo;
    const token = process.env.GITHUB_TOKEN || "";
    const octokit = github.getOctokit(token);

    // Determine contribution type and metadata
    let contributorUsername: string;
    let prNumber: number;
    let mergeSha: string;
    let contribType: number;

    if (context.payload.pull_request) {
      const pr = context.payload.pull_request;
      if (!pr.merged) {
        core.info("PR was closed without merging. Skipping.");
        return;
      }
      contributorUsername = pr.user.login;
      prNumber = pr.number;
      mergeSha = pr.merge_commit_sha || "";
      contribType = CONTRIBUTION_TYPES.pr_merge;
    } else if (context.payload.issue) {
      const issue = context.payload.issue;
      contributorUsername = issue.user.login;
      prNumber = issue.number;
      mergeSha = context.sha;
      contribType = CONTRIBUTION_TYPES.issue_close;
    } else {
      core.info("Unsupported event type. Skipping.");
      return;
    }

    core.info(`Contributor: ${contributorUsername}`);
    core.info(`Repo: ${owner}/${repo}`);

    // Lookup contributor wallet
    const contributorWallet = await lookupWallet(
      registryUrl,
      contributorUsername
    );
    if (!contributorWallet) {
      core.info(
        `No wallet registered for ${contributorUsername}. Posting invite.`
      );
      await postComment(
        octokit,
        owner,
        repo,
        prNumber,
        `**ContribChain:** No wallet registered for @${contributorUsername}. ` +
          `Register at [contribchain.xyz](https://contribchain.xyz) to receive ` +
          `on-chain attestation for your contributions.`
      );
      return;
    }

    // Compute hashes
    const repoHash = ethers.keccak256(ethers.toUtf8Bytes(`${owner}/${repo}`));
    const contentHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "bytes32", "string"],
        [
          prNumber,
          ethers.keccak256(ethers.toUtf8Bytes(mergeSha)),
          contributorUsername,
        ]
      )
    );

    // Connect to Base
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(repoWalletKey, provider);
    const nonceManagedWallet = new ethers.NonceManager(wallet);

    const contract = new ethers.Contract(
      contractAddress,
      CONTRIB_ATTEST_ABI,
      nonceManagedWallet
    );

    // Submit attestation with retry
    let tx: ethers.TransactionResponse | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        core.info(`Attestation attempt ${attempt}/${MAX_RETRIES}...`);
        tx = await contract.attest(
          contributorWallet,
          repoHash,
          contentHash,
          contribType
        );
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          core.warning(`All ${MAX_RETRIES} attestation attempts failed: ${err}`);
          return;
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        core.warning(`Attempt ${attempt} failed, retrying in ${delay}ms: ${err}`);
        await sleep(delay);
      }
    }

    if (!tx) return;

    await tx.wait();
    const txHash = tx.hash;
    const explorerUrl = `https://basescan.org/tx/${txHash}`;

    core.info(`Attestation tx: ${txHash}`);

    // Post success comment
    await postComment(
      octokit,
      owner,
      repo,
      prNumber,
      `**ContribChain Attestation** :white_check_mark:\n\n` +
        `Contribution by @${contributorUsername} attested on-chain.\n` +
        `- **Type:** ${Object.keys(CONTRIBUTION_TYPES)[contribType]}\n` +
        `- **Tx:** [${txHash.slice(0, 10)}...](${explorerUrl})\n` +
        `- **Verify:** [ContribID](https://contribchain.xyz/id/${contributorWallet})`
    );
  } catch (error) {
    // Never fail the CI pipeline
    core.warning(`ContribChain attestation error: ${error}`);
  }
}

run();
