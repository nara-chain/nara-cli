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
  getAgentInfo,
  getAgentMemory,
  setBio,
  setMetadata,
  uploadMemory,
  closeAgentBuffer,
  transferAgentAuthority,
  deleteAgent,
  logActivity,
  setReferral as setReferralOnChain,
} from "nara-sdk";
import { readFileSync } from "node:fs";
import { addAgentId } from "../utils/agent-config";
import { validateName } from "../utils/validation";

// ─── Command handlers ────────────────────────────────────────────

async function handleAgentRegister(agentId: string, options: GlobalOptions & { referral?: string }) {
  validateName(agentId, "Agent ID");
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Registering agent "${agentId}"...`);
  const result = await registerAgent(connection, wallet, agentId, undefined, options.referral);
  if (!options.json) printSuccess(`Agent "${agentId}" registered!`);
  addAgentId(agentId, rpcUrl);

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
  const signature = await logActivity(connection, wallet, agentId, model, activity, log, undefined, referral);
  if (!options.json) printSuccess("Activity logged!");

  if (options.json) {
    formatOutput({ agentId, model, activity, log, referral, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

// ─── Register commands ───────────────────────────────────────────

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command("agent")
    .description("Agent Registry commands (on-chain AI agents)");

  // agent register
  agent
    .command("register <agent-id>")
    .description("Register a new agent on-chain")
    .option("--referral <agent-id>", "Referral agent ID")
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
}
