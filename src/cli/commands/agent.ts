/**
 * Agent Registry commands - manage on-chain AI agents
 */

import { Command } from "commander";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadWallet, getRpcUrl } from "../utils/wallet";
import {
  printError,
  printInfo,
  printSuccess,
  printWarning,
  formatOutput,
} from "../utils/output";
import type { GlobalOptions } from "../types";
import {
  registerAgent,
  registerAgentWithReferral,
  getAgentInfo,
  getAgentMemory,
  setBio,
  setMetadata,
  uploadMemory,
  closeAgentBuffer,
  transferAgentAuthority,
  deleteAgent,
  logActivity,
  logActivityWithReferral,
  setReferral as setReferralOnChain,
  getAgentTwitter,
  setTwitter,
  submitTweet,
  unbindTwitter,
  getTweetVerify,
  getTweetRecord,
  getAgentRegistryConfig,
} from "nara-sdk";
import { readFileSync } from "node:fs";
import { loadNetworkConfig, setAgentId, clearAgentId } from "../utils/agent-config";
import { validateName } from "../utils/validation";

// ─── Helpers ─────────────────────────────────────────────────────

/** Try to get wallet pubkey without failing. */
async function tryGetWalletPubkey(walletPath?: string): Promise<string | undefined> {
  try {
    const wallet = await loadWallet(walletPath);
    return wallet.publicKey.toBase58();
  } catch {
    return undefined;
  }
}

/** Resolve agent ID: use explicit --agent-id option, or fall back to saved myid. */
async function resolveAgentId(options: GlobalOptions & { agentId?: string }): Promise<string> {
  if (options.agentId) return options.agentId;
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const pubkey = await tryGetWalletPubkey(options.wallet);
  const networkConfig = loadNetworkConfig(rpcUrl, pubkey);
  if (!networkConfig.agent_id) {
    printError('No agent ID specified. Use --agent-id or run "agent register <id>" first.');
    process.exit(1);
  }
  return networkConfig.agent_id;
}

// ─── Command handlers ────────────────────────────────────────────

async function handleAgentRegister(agentId: string, options: GlobalOptions & { referral?: string }) {
  validateName(agentId, "Agent ID");
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const wallet = await loadWallet(options.wallet);
  const pubkey = wallet.publicKey.toBase58();

  // Check if an agent ID is already configured for this wallet
  const networkConfig = loadNetworkConfig(rpcUrl, pubkey);
  if (networkConfig.agent_id) {
    printError(`Agent ID "${networkConfig.agent_id}" is already configured for this wallet. Run "agent clear" first to unlink it.`);
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, "confirmed");

  if (!options.json) printInfo(`Registering agent "${agentId}"...`);
  const result = options.referral
    ? await registerAgentWithReferral(connection, wallet, agentId, options.referral)
    : await registerAgent(connection, wallet, agentId);
  if (!options.json) printSuccess(`Agent "${agentId}" registered!`);
  setAgentId(agentId, rpcUrl, pubkey);

  if (options.json) {
    formatOutput({ agentId, referral: options.referral ?? null, signature: result.signature, agentPubkey: result.agentPubkey.toBase58() }, true);
  } else {
    console.log(`  Transaction: ${result.signature}`);
    console.log(`  Agent PDA: ${result.agentPubkey.toBase58()}`);
    if (options.referral) console.log(`  Referral: ${options.referral}`);
  }
}

async function handleAgentGet(agentId: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  const info = await getAgentInfo(connection, agentId);

  // Fetch twitter binding info
  let twitterData: { username: string; tweetUrl: string; status: string; verifiedAt: string | null } | null = null;
  try {
    const tw = await getAgentTwitter(connection, agentId);
    if (tw) {
      twitterData = {
        username: tw.username,
        tweetUrl: tw.tweetUrl,
        status: TWITTER_STATUS[tw.status] ?? `unknown(${tw.status})`,
        verifiedAt: tw.verifiedAt ? new Date(tw.verifiedAt * 1000).toISOString() : null,
      };
    }
  } catch {
    // Ignore — twitter binding may not exist
  }

  // Fetch tweet verification info
  let tweetVerifyData: { tweetId: string; status: string; submittedAt: string | null; lastRewardedAt: string | null } | null = null;
  try {
    const tv = await getTweetVerify(connection, agentId);
    if (tv) {
      tweetVerifyData = {
        tweetId: tv.tweetId.toString(),
        status: TWITTER_STATUS[tv.status] ?? `unknown(${tv.status})`,
        submittedAt: tv.submittedAt ? new Date(tv.submittedAt * 1000).toISOString() : null,
        lastRewardedAt: tv.lastRewardedAt ? new Date(tv.lastRewardedAt * 1000).toISOString() : null,
      };
    }
  } catch {
    // Ignore
  }

  const data: Record<string, any> = {
    agentId: info.record.agentId,
    authority: info.record.authority.toBase58(),
    version: info.record.version,
    bio: info.bio,
    metadata: info.metadata,
    createdAt: new Date(info.record.createdAt * 1000).toISOString(),
    updatedAt: info.record.updatedAt ? new Date(info.record.updatedAt * 1000).toISOString() : null,
    twitter: twitterData,
    tweetVerify: tweetVerifyData,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Agent ID: ${data.agentId}`);
    console.log(`  Authority: ${data.authority}`);
    console.log(`  Version: ${data.version}`);
    console.log(`  Bio: ${data.bio ?? "(none)"}`);
    console.log(`  Metadata: ${data.metadata ?? "(none)"}`);
    console.log(`  Created: ${data.createdAt}`);
    if (data.updatedAt) console.log(`  Updated: ${data.updatedAt}`);
    // Twitter binding
    if (twitterData) {
      console.log(`  Twitter: @${twitterData.username} (${twitterData.status})`);
      if (twitterData.verifiedAt) console.log(`  Twitter verified: ${twitterData.verifiedAt}`);
    } else {
      console.log(`  Twitter: (none)`);
    }
    // Tweet verification
    if (tweetVerifyData) {
      console.log(`  Tweet verify: ${tweetVerifyData.tweetId} (${tweetVerifyData.status})`);
      if (tweetVerifyData.lastRewardedAt) console.log(`  Tweet last rewarded: ${tweetVerifyData.lastRewardedAt}`);
    }
    console.log("");
    if (twitterData) {
      // Bound — show tweet submit tip
      if (tweetVerifyData?.lastRewardedAt) {
        const lastRewarded = new Date(tweetVerifyData.lastRewardedAt).getTime();
        const hoursAgo = (Date.now() - lastRewarded) / (1000 * 60 * 60);
        if (hoursAgo >= 24) {
          console.log(`  Tip: You can verify your tweet again to earn more stake-free credits.`);
          console.log(`     npx naracli agent submit-tweet <tweet-url>`);
        } else {
          const hoursLeft = Math.ceil(24 - hoursAgo);
          console.log(`  Tip: Next tweet verification available in ~${hoursLeft}h.`);
        }
      } else {
        console.log(`  Tip: Submit a tweet to earn stake-free PoMI mining credits!`);
        console.log(`     npx naracli agent submit-tweet <tweet-url>`);
      }
      console.log(`  Stake-free credits are based on tweet likes, bookmarks, retweets, and quotes.`);
      console.log("");
    } else {
      // Not bound — show bind tip
      const tweetText = `Claiming my AI agent ${agentId} on NaraChain @NaraBuildAI`;
      const tweetIntent = `https://x.com/intent/tweet?text=${tweetText.replace(/ /g, "%20")}`;
      console.log(`  Tip: Bind your Twitter to get stake-free PoMI mining credits!`);
      console.log(`  1. Post a tweet: ${tweetIntent}`);
      console.log(`  2. Then run: npx naracli agent bind-twitter <tweet-url>`);
      console.log("");
    }
  }
}

async function handleAgentSetBio(agentId: string, bio: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Setting bio for "${agentId}"...`);
  const signature = await setBio(connection, wallet, agentId, bio);
  if (!options.json) printSuccess("Bio updated!");

  if (options.json) {
    formatOutput({ agentId, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentSetMetadata(agentId: string, jsonStr: string, options: GlobalOptions) {
  // Validate JSON
  try {
    JSON.parse(jsonStr);
  } catch {
    throw new Error(`Invalid JSON: ${jsonStr}`);
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Setting metadata for "${agentId}"...`);
  const signature = await setMetadata(connection, wallet, agentId, jsonStr);
  if (!options.json) printSuccess("Metadata updated!");

  if (options.json) {
    formatOutput({ agentId, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentUploadMemory(agentId: string, filePath: string, options: GlobalOptions) {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch (err: any) {
    throw new Error(`Failed to read file "${filePath}": ${err.message}`);
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Uploading memory for "${agentId}" (${data.length} bytes)...`);
  const signature = await uploadMemory(connection, wallet, agentId, data, {
    onProgress: options.json ? undefined : (i, total, sig) => {
      printInfo(`  Chunk ${i}/${total}: ${sig}`);
    },
  });
  if (!options.json) printSuccess("Memory uploaded!");

  if (options.json) {
    formatOutput({ agentId, size: data.length, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentMemory(agentId: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  const memory = await getAgentMemory(connection, agentId);
  if (!memory) {
    if (options.json) {
      formatOutput({ agentId, hasMemory: false }, true);
    } else {
      printWarning(`Agent "${agentId}" has no memory`);
    }
    return;
  }

  if (options.json) {
    formatOutput({ agentId, hasMemory: true, size: memory.length, content: memory.toString("utf-8") }, true);
  } else {
    console.log(memory.toString("utf-8"));
  }
}

async function handleAgentTransfer(agentId: string, newAuthority: string, options: GlobalOptions) {
  let newAuth: PublicKey;
  try {
    newAuth = new PublicKey(newAuthority);
  } catch {
    throw new Error(`Invalid public key: ${newAuthority}`);
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Transferring agent "${agentId}" authority...`);
  const signature = await transferAgentAuthority(connection, wallet, agentId, newAuth);
  if (!options.json) printSuccess("Authority transferred!");

  if (options.json) {
    formatOutput({ agentId, newAuthority, signature }, true);
  } else {
    console.log(`  New authority: ${newAuthority}`);
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentCloseBuffer(agentId: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Closing buffer for "${agentId}"...`);
  const signature = await closeAgentBuffer(connection, wallet, agentId);
  if (!options.json) printSuccess("Buffer closed, rent reclaimed!");

  if (options.json) {
    formatOutput({ agentId, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentDelete(agentId: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Deleting agent "${agentId}"...`);
  const signature = await deleteAgent(connection, wallet, agentId);
  if (!options.json) printSuccess(`Agent "${agentId}" deleted, rent reclaimed!`);

  if (options.json) {
    formatOutput({ agentId, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentSetReferral(agentId: string, referralAgentId: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Setting referral for "${agentId}" to "${referralAgentId}"...`);
  const signature = await setReferralOnChain(connection, wallet, agentId, referralAgentId);
  if (!options.json) printSuccess(`Referral set on-chain!`);

  if (options.json) {
    formatOutput({ agentId, referral: referralAgentId, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentLog(
  agentId: string,
  activity: string,
  log: string,
  options: GlobalOptions & { model?: string; referral?: string }
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);
  const model = options.model ?? "";
  const referral = options.referral;

  if (!options.json) printInfo(`Logging activity for "${agentId}"...`);
  const signature = referral
    ? await logActivityWithReferral(connection, wallet, agentId, model, activity, log, referral)
    : await logActivity(connection, wallet, agentId, model, activity, log);
  if (!options.json) printSuccess("Activity logged!");

  if (options.json) {
    formatOutput({ agentId, model, activity, log, referral, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentClear(options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  let pubkey: string | undefined;
  try {
    const wallet = await loadWallet(options.wallet);
    pubkey = wallet.publicKey.toBase58();
  } catch {
    // No wallet — clear legacy format
  }
  const networkConfig = loadNetworkConfig(rpcUrl, pubkey);
  if (!networkConfig.agent_id) {
    if (options.json) {
      formatOutput({ cleared: false, message: "No agent ID configured" }, true);
    } else {
      printWarning("No agent ID configured for this wallet");
    }
    return;
  }
  const oldId = networkConfig.agent_id;
  clearAgentId(rpcUrl, pubkey);
  if (options.json) {
    formatOutput({ cleared: true, agentId: oldId }, true);
  } else {
    printSuccess(`Agent ID "${oldId}" cleared from local config (on-chain record is unchanged)`);
  }
}

// ─── Twitter handlers ────────────────────────────────────────────

const TWITTER_STATUS: Record<number, string> = { 0: "none", 1: "pending", 2: "verified", 3: "rejected" };

/** Parse tweet URL and extract username + tweetId. Accepts https://x.com/<username>/status/<id> or https://twitter.com/<username>/status/<id>. */
function parseTweetUrl(url: string): { username: string; tweetId: bigint; tweetUrl: string } {
  const m = url.match(/^https?:\/\/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/);
  if (!m) {
    printError(`Invalid tweet URL. Expected format: https://x.com/<username>/status/<id>`);
    process.exit(1);
  }
  return { username: m[1], tweetId: BigInt(m[2]), tweetUrl: url };
}

async function handleAgentTwitterSet(agentId: string, username: string, tweetUrl: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Binding @${username} to agent "${agentId}"...`);
  const signature = await setTwitter(connection, wallet, agentId, username, tweetUrl);
  if (!options.json) printSuccess(`Twitter @${username} submitted for verification!`);

  if (options.json) {
    formatOutput({ agentId, username, tweetUrl, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentTwitterUnbind(agentId: string, username: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Unbinding @${username} from agent "${agentId}"...`);
  const signature = await unbindTwitter(connection, wallet, agentId, username);
  if (!options.json) printSuccess(`Twitter @${username} unbound!`);

  if (options.json) {
    formatOutput({ agentId, username, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentSubmitTweet(agentId: string, tweetId: bigint, tweetUrl: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  // Check if tweet has already been used
  const existing = await getTweetRecord(connection, tweetId);
  if (existing) {
    printError(`This tweet has already been submitted and approved. Please use a different tweet.`);
    process.exit(1);
  }

  if (!options.json) printInfo(`Submitting tweet for verification...`);
  const signature = await submitTweet(connection, wallet, agentId, tweetId);
  if (!options.json) printSuccess(`Tweet submitted for verification!`);

  if (options.json) {
    formatOutput({ agentId, tweetId: tweetId.toString(), tweetUrl, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentConfig(options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const DECIMALS = 1_000_000_000;

  const config = await getAgentRegistryConfig(connection);

  const data = {
    registerFee: config.registerFee / DECIMALS,
    referralRegisterFee: config.referralRegisterFee / DECIMALS,
    referralFeeShare: config.referralFeeShare / DECIMALS,
    activityReward: config.activityReward / DECIMALS,
    referralActivityReward: config.referralActivityReward / DECIMALS,
    pointsSelf: config.pointsSelf,
    pointsReferral: config.pointsReferral,
    referralRegisterPoints: config.referralRegisterPoints,
    twitterVerificationFee: config.twitterVerificationFee / DECIMALS,
    twitterVerificationReward: config.twitterVerificationReward / DECIMALS,
    twitterVerificationPoints: config.twitterVerificationPoints,
    tweetVerifyReward: config.tweetVerifyReward / DECIMALS,
    tweetVerifyPoints: config.tweetVerifyPoints,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Register Fee:              ${data.registerFee} NARA (${config.registerFee} lamports)`);
    console.log(`  Referral Register Fee:     ${data.referralRegisterFee} NARA (${config.referralRegisterFee} lamports)`);
    console.log(`  Referral Fee Share:        ${data.referralFeeShare} NARA (${config.referralFeeShare} lamports)`);
    console.log(`  Activity Reward:           ${data.activityReward} NARA (${config.activityReward} lamports)`);
    console.log(`  Referral Activity Reward:  ${data.referralActivityReward} NARA (${config.referralActivityReward} lamports)`);
    console.log(`  Points (self):             ${data.pointsSelf}`);
    console.log(`  Points (referral):         ${data.pointsReferral}`);
    console.log(`  Referral Register Points:  ${data.referralRegisterPoints}`);
    console.log(`  Twitter Verify Fee:        ${data.twitterVerificationFee} NARA (${config.twitterVerificationFee} lamports)`);
    console.log(`  Twitter Verify Reward:     ${data.twitterVerificationReward} NARA (${config.twitterVerificationReward} lamports)`);
    console.log(`  Twitter Verify Points:     ${data.twitterVerificationPoints}`);
    console.log(`  Tweet Verify Reward:       ${data.tweetVerifyReward} NARA (${config.tweetVerifyReward} lamports)`);
    console.log(`  Tweet Verify Points:       ${data.tweetVerifyPoints}`);
    console.log("");
  }
}

async function handleAgentMyId(options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const pubkey = await tryGetWalletPubkey(options.wallet);
  const networkConfig = loadNetworkConfig(rpcUrl, pubkey);
  if (!networkConfig.agent_id) {
    if (options.json) {
      formatOutput({ agentId: null }, true);
    } else {
      printWarning("No agent ID registered for this network. Use 'agent register <id>' to register one.");
    }
    return;
  }
  if (options.json) {
    formatOutput({ agentId: networkConfig.agent_id }, true);
  } else {
    console.log(networkConfig.agent_id);
  }
}

// ─── Register commands ───────────────────────────────────────────

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command("agent")
    .description("Agent Registry — register an on-chain AI agent identity to earn extra rewards and points from PoMI mining");

  // agent register
  agent
    .command("register <agent-id>")
    .description("Register a new agent on-chain (costs 1 NARA, 50% off with referral). Agent ID must be lowercase alphanumeric with hyphens.")
    .option("--referral <agent-id>", "Referral agent ID — saves 50% on registration fee")
    .action(async (agentId: string, opts: { referral?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentRegister(agentId, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent get
  agent
    .command("get")
    .description("Get agent info (bio, metadata, twitter binding, tweet verification)")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentGet(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent set-bio
  agent
    .command("set-bio <bio>")
    .description("Set agent bio (max 512 bytes)")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (bio: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentSetBio(agentId, bio, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent set-metadata
  agent
    .command("set-metadata <json>")
    .description("Set agent JSON metadata (max 800 bytes)")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (jsonStr: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentSetMetadata(agentId, jsonStr, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent upload-memory
  agent
    .command("upload-memory <file>")
    .description("Upload memory data from file")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (filePath: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentUploadMemory(agentId, filePath, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent memory
  agent
    .command("memory")
    .description("Read agent memory content")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentMemory(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent transfer
  agent
    .command("transfer <new-authority>")
    .description("Transfer agent authority to another wallet")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (newAuthority: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentTransfer(agentId, newAuthority, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent close-buffer
  agent
    .command("close-buffer")
    .description("Close upload buffer, reclaim rent")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentCloseBuffer(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent delete
  agent
    .command("delete <agent-id>")
    .description("Delete agent, reclaim rent")
    .action(async (agentId: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentDelete(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent myid
  agent
    .command("myid")
    .description("Show your registered agent ID for the current network")
    .action(async (_opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const rpcUrl = getRpcUrl(globalOpts.rpcUrl);
        const pubkey = await tryGetWalletPubkey(globalOpts.wallet);
        const networkConfig = loadNetworkConfig(rpcUrl, pubkey);
        if (globalOpts.json) {
          formatOutput({ agentId: networkConfig.agent_id || null }, true);
        } else if (networkConfig.agent_id) {
          console.log(networkConfig.agent_id);
        } else {
          printWarning("No agent ID registered for this network. Run 'agent register <id>' to create one.");
        }
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent config
  agent
    .command("config")
    .description("Show agent registry on-chain config (fees, rewards, points)")
    .action(async (_opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentConfig(globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent clear
  agent
    .command("clear")
    .description("Clear saved agent ID from local config (does not delete on-chain)")
    .action(async (_opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentClear(globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent set-referral
  agent
    .command("set-referral <referral-agent-id>")
    .description("Set referral agent on-chain")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (referralAgentId: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentSetReferral(agentId, referralAgentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent log
  agent
    .command("log <activity> <log>")
    .description("Log an activity event on-chain")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .option("--model <name>", "Model identifier")
    .option("--referral <agent-id>", "Referral agent ID")
    .action(async (activity: string, log: string, opts: { agentId?: string; model?: string; referral?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentLog(agentId, activity, log, { ...globalOpts, model: opts.model, referral: opts.referral });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // ─── Twitter commands ───────────────────────────────────────────

  // agent bind-twitter [tweet-url]
  agent
    .command("bind-twitter [tweet-url]")
    .description("Bind twitter to your agent for stake-free PoMI credits")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .addHelpText("after", `
Tweet content (replace <agent-id> with yours):
  Claiming my AI agent "<agent-id>" on NaraChain @NaraBuildAI

Tweet URL format:
  https://x.com/<username>/status/<id>

Example:
  npx naracli agent bind-twitter https://x.com/yourname/status/123456789`)
    .action(async (tweetUrl: string | undefined, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });

        if (!tweetUrl) {
          // No URL provided — check status and show tips
          const rpcUrl = getRpcUrl(globalOpts.rpcUrl);
          const connection = new Connection(rpcUrl, "confirmed");
          try {
            const tw = await getAgentTwitter(connection, agentId);
            if (tw) {
              const status = TWITTER_STATUS[tw.status] ?? `unknown(${tw.status})`;
              console.log("");
              console.log(`  Twitter already bound: @${tw.username} (${status})`);
              console.log(`  Tweet: ${tw.tweetUrl}`);
              if (tw.verifiedAt) console.log(`  Verified: ${new Date(tw.verifiedAt * 1000).toISOString()}`);
              console.log("");
              return;
            }
          } catch {
            // No binding found
          }
          const tweetText = `Claiming my AI agent ${agentId} on NaraChain @NaraBuildAI`;
          const tweetIntent = `https://x.com/intent/tweet?text=${tweetText.replace(/ /g, "%20")}`;
          console.log("");
          console.log(`  Bind your Twitter to get stake-free PoMI mining credits!`);
          console.log(`  1. Post a tweet: ${tweetIntent}`);
          console.log(`  2. Then run: npx naracli agent bind-twitter <tweet-url>`);
          console.log("");
          return;
        }

        const { username } = parseTweetUrl(tweetUrl);
        await handleAgentTwitterSet(agentId, username, tweetUrl, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent unbind-twitter <username>
  agent
    .command("unbind-twitter <username>")
    .description("Unbind twitter from your agent")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (username: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        await handleAgentTwitterUnbind(agentId, username, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent submit-tweet <tweet-url>
  agent
    .command("submit-tweet <tweet-url>")
    .description("Submit a tweet for verification and earn rewards (charges verification fee)")
    .option("--agent-id <id>", "Agent ID (defaults to saved myid)")
    .action(async (tweetUrl: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const agentId = await resolveAgentId({ ...globalOpts, agentId: opts.agentId });
        const { tweetId } = parseTweetUrl(tweetUrl);
        await handleAgentSubmitTweet(agentId, tweetId, tweetUrl, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
