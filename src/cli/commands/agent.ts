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
  getAgentRegistryConfig,
} from "nara-sdk";
import { readFileSync } from "node:fs";
import { loadNetworkConfig, setAgentId, clearAgentId } from "../utils/agent-config";
import { validateName } from "../utils/validation";

// ─── Command handlers ────────────────────────────────────────────

async function handleAgentRegister(agentId: string, options: GlobalOptions & { referral?: string }) {
  validateName(agentId, "Agent ID");
  const rpcUrl = getRpcUrl(options.rpcUrl);

  // Check if an agent ID is already configured for this network
  const networkConfig = loadNetworkConfig(rpcUrl);
  if (networkConfig.agent_id) {
    printError(`Agent ID "${networkConfig.agent_id}" is already configured for this network. Run "agent clear" first to unlink it.`);
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Registering agent "${agentId}"...`);
  const result = options.referral
    ? await registerAgentWithReferral(connection, wallet, agentId, options.referral)
    : await registerAgent(connection, wallet, agentId);
  if (!options.json) printSuccess(`Agent "${agentId}" registered!`);
  setAgentId(agentId, rpcUrl);

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

  const data = {
    agentId: info.record.agentId,
    authority: info.record.authority.toBase58(),
    version: info.record.version,
    bio: info.bio,
    metadata: info.metadata,
    createdAt: new Date(info.record.createdAt * 1000).toISOString(),
    updatedAt: info.record.updatedAt ? new Date(info.record.updatedAt * 1000).toISOString() : null,
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
    console.log("");
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
  const networkConfig = loadNetworkConfig(rpcUrl);
  if (!networkConfig.agent_id) {
    if (options.json) {
      formatOutput({ cleared: false, message: "No agent ID configured" }, true);
    } else {
      printWarning("No agent ID configured for this network");
    }
    return;
  }
  const oldId = networkConfig.agent_id;
  clearAgentId(rpcUrl);
  if (options.json) {
    formatOutput({ cleared: true, agentId: oldId }, true);
  } else {
    printSuccess(`Agent ID "${oldId}" cleared from local config (on-chain record is unchanged)`);
  }
}

// ─── Twitter handlers ────────────────────────────────────────────

const TWITTER_STATUS: Record<number, string> = { 0: "none", 1: "pending", 2: "verified", 3: "rejected" };

async function handleAgentTwitterGet(agentId: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  const info = await getAgentTwitter(connection, agentId);
  if (!info) {
    if (options.json) {
      formatOutput({ agentId, twitter: null }, true);
    } else {
      printWarning(`Agent "${agentId}" has no twitter binding`);
    }
    return;
  }

  const data = {
    agentId,
    username: info.username,
    tweetUrl: info.tweetUrl,
    status: TWITTER_STATUS[info.status] ?? `unknown(${info.status})`,
    verifiedAt: info.verifiedAt ? new Date(info.verifiedAt * 1000).toISOString() : null,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Agent ID: ${data.agentId}`);
    console.log(`  Twitter:  @${data.username}`);
    console.log(`  Tweet:    ${data.tweetUrl}`);
    console.log(`  Status:   ${data.status}`);
    if (data.verifiedAt) console.log(`  Verified: ${data.verifiedAt}`);
    console.log("");
  }
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

async function handleAgentSubmitTweet(agentId: string, username: string, tweetUrl: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Submitting tweet for verification...`);
  const signature = await submitTweet(connection, wallet, agentId, username, tweetUrl);
  if (!options.json) printSuccess(`Tweet submitted for verification!`);

  if (options.json) {
    formatOutput({ agentId, username, tweetUrl, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleAgentTweetStatus(agentId: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  const info = await getTweetVerify(connection, agentId);
  if (!info) {
    if (options.json) {
      formatOutput({ agentId, tweetVerify: null }, true);
    } else {
      printWarning(`Agent "${agentId}" has no tweet verification record`);
    }
    return;
  }

  const data = {
    agentId,
    tweetUrl: info.tweetUrl,
    status: TWITTER_STATUS[info.status] ?? `unknown(${info.status})`,
    submittedAt: info.submittedAt ? new Date(info.submittedAt * 1000).toISOString() : null,
    lastRewardedAt: info.lastRewardedAt ? new Date(info.lastRewardedAt * 1000).toISOString() : null,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Agent ID:      ${data.agentId}`);
    console.log(`  Tweet:         ${data.tweetUrl}`);
    console.log(`  Status:        ${data.status}`);
    if (data.submittedAt) console.log(`  Submitted:     ${data.submittedAt}`);
    if (data.lastRewardedAt) console.log(`  Last rewarded: ${data.lastRewardedAt}`);
    console.log("");
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
    console.log(`  Register Fee:              ${data.registerFee} NARA`);
    console.log(`  Referral Register Fee:     ${data.referralRegisterFee} NARA`);
    console.log(`  Referral Fee Share:        ${data.referralFeeShare} NARA`);
    console.log(`  Activity Reward:           ${data.activityReward} NARA`);
    console.log(`  Referral Activity Reward:  ${data.referralActivityReward} NARA`);
    console.log(`  Points (self):             ${data.pointsSelf}`);
    console.log(`  Points (referral):         ${data.pointsReferral}`);
    console.log(`  Referral Register Points:  ${data.referralRegisterPoints}`);
    console.log(`  Twitter Verify Fee:        ${data.twitterVerificationFee} NARA`);
    console.log(`  Twitter Verify Reward:     ${data.twitterVerificationReward} NARA`);
    console.log(`  Twitter Verify Points:     ${data.twitterVerificationPoints}`);
    console.log(`  Tweet Verify Reward:       ${data.tweetVerifyReward} NARA`);
    console.log(`  Tweet Verify Points:       ${data.tweetVerifyPoints}`);
    console.log("");
  }
}

async function handleAgentMyId(options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const networkConfig = loadNetworkConfig(rpcUrl);
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
    .command("get <agent-id>")
    .description("Get agent info (bio, metadata, version)")
    .action(async (agentId: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentGet(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent set-bio
  agent
    .command("set-bio <agent-id> <bio>")
    .description("Set agent bio (max 512 bytes)")
    .action(async (agentId: string, bio: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentSetBio(agentId, bio, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent set-metadata
  agent
    .command("set-metadata <agent-id> <json>")
    .description("Set agent JSON metadata (max 800 bytes)")
    .action(async (agentId: string, jsonStr: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentSetMetadata(agentId, jsonStr, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent upload-memory
  agent
    .command("upload-memory <agent-id> <file>")
    .description("Upload memory data from file")
    .action(async (agentId: string, filePath: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentUploadMemory(agentId, filePath, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent memory
  agent
    .command("memory <agent-id>")
    .description("Read agent memory content")
    .action(async (agentId: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentMemory(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent transfer
  agent
    .command("transfer <agent-id> <new-authority>")
    .description("Transfer agent authority to another wallet")
    .action(async (agentId: string, newAuthority: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentTransfer(agentId, newAuthority, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent close-buffer
  agent
    .command("close-buffer <agent-id>")
    .description("Close upload buffer, reclaim rent")
    .action(async (agentId: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
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
        const networkConfig = loadNetworkConfig(rpcUrl);
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
    .command("set-referral <agent-id> <referral-agent-id>")
    .description("Set referral agent on-chain")
    .action(async (agentId: string, referralAgentId: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentSetReferral(agentId, referralAgentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent log
  agent
    .command("log <agent-id> <activity> <log>")
    .description("Log an activity event on-chain")
    .option("--model <name>", "Model identifier")
    .option("--referral <agent-id>", "Referral agent ID")
    .action(async (agentId: string, activity: string, log: string, opts: { model?: string; referral?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentLog(agentId, activity, log, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // ─── Twitter commands ───────────────────────────────────────────

  // agent twitter <agent-id>
  agent
    .command("twitter <agent-id>")
    .description("Get agent's twitter binding status")
    .action(async (agentId: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentTwitterGet(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent set-twitter <agent-id> <username> <tweet-url>
  agent
    .command("set-twitter <agent-id> <username> <tweet-url>")
    .description("Bind a twitter account to your agent (charges verification fee). Tweet must contain your agent ID.")
    .action(async (agentId: string, username: string, tweetUrl: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentTwitterSet(agentId, username, tweetUrl, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent unbind-twitter <agent-id> <username>
  agent
    .command("unbind-twitter <agent-id> <username>")
    .description("Unbind twitter from your agent")
    .action(async (agentId: string, username: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentTwitterUnbind(agentId, username, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent submit-tweet <agent-id> <username> <tweet-url>
  agent
    .command("submit-tweet <agent-id> <username> <tweet-url>")
    .description("Submit a tweet for verification and earn rewards (charges verification fee)")
    .action(async (agentId: string, username: string, tweetUrl: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentSubmitTweet(agentId, username, tweetUrl, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // agent tweet-status <agent-id>
  agent
    .command("tweet-status <agent-id>")
    .description("Check tweet verification status")
    .action(async (agentId: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleAgentTweetStatus(agentId, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
