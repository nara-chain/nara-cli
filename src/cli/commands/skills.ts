/**
 * Skills commands - interact with nara-skills-hub on-chain skill registry
 */

import { Command } from "commander";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadWallet, getRpcUrl } from "../utils/wallet";
import {
  printError,
  printInfo,
  printSuccess,
  formatOutput,
} from "../utils/output";
import type { GlobalOptions } from "../types";
import {
  registerSkill,
  getSkillInfo,
  getSkillContent,
  setDescription,
  updateMetadata,
  uploadSkillContent,
  transferAuthority,
  deleteSkill,
  closeBuffer,
} from "nara-sdk";
import {
  handleSkillsAdd,
  handleSkillsRemove,
  handleSkillsList,
  handleSkillsCheck,
  handleSkillsUpdate,
} from "./skillsInstall";
import { validateName } from "../utils/validation";

// ─── Command handlers ────────────────────────────────────────────

async function handleSkillsRegister(
  name: string,
  author: string,
  options: GlobalOptions
) {
  validateName(name, "Skill name");
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  printInfo(`Registering skill "${name}" by "${author}"...`);
  const { signature, skillPubkey } = await registerSkill(connection, wallet, name, author);
  printSuccess("Skill registered!");

  if (options.json) {
    formatOutput({ name, author, skillPubkey: skillPubkey.toBase58(), signature }, true);
  } else {
    console.log(`  Skill: ${skillPubkey.toBase58()}`);
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleSkillsGet(name: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  const info = await getSkillInfo(connection, name);

  const data = {
    name: info.record.name,
    author: info.record.author,
    authority: info.record.authority.toBase58(),
    version: info.record.version,
    createdAt: new Date(info.record.createdAt * 1000).toISOString(),
    updatedAt: info.record.updatedAt
      ? new Date(info.record.updatedAt * 1000).toISOString()
      : null,
    description: info.description ?? null,
    metadata: info.metadata ?? null,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Name: ${data.name}`);
    console.log(`  Author: ${data.author}`);
    console.log(`  Authority: ${data.authority}`);
    console.log(`  Version: ${data.version}`);
    console.log(`  Created: ${data.createdAt}`);
    if (data.updatedAt) console.log(`  Updated: ${data.updatedAt}`);
    console.log(`  Description: ${data.description ?? "(none)"}`);
    console.log(`  Metadata: ${data.metadata ?? "(none)"}`);
    console.log("");
  }
}

async function handleSkillsContent(
  name: string,
  options: GlobalOptions & { hex?: boolean }
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  const content = await getSkillContent(connection, name);
  if (!content) {
    if (options.json) {
      formatOutput({ name, content: null }, true);
    } else {
      printInfo("No content uploaded yet");
    }
    return;
  }

  if (options.json) {
    formatOutput(
      { name, size: content.length, content: options.hex ? content.toString("hex") : content.toString("utf8") },
      true
    );
  } else if (options.hex) {
    console.log(content.toString("hex"));
  } else {
    console.log(content.toString("utf8"));
  }
}

async function handleSkillsSetDescription(
  name: string,
  description: string,
  options: GlobalOptions
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  printInfo(`Setting description for skill "${name}"...`);
  const signature = await setDescription(connection, wallet, name, description);
  printSuccess("Description updated!");

  if (options.json) {
    formatOutput({ name, description, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleSkillsSetMetadata(
  name: string,
  json: string,
  options: GlobalOptions
) {
  // Validate JSON
  try {
    JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON provided for metadata");
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  printInfo(`Setting metadata for skill "${name}"...`);
  const signature = await updateMetadata(connection, wallet, name, json);
  printSuccess("Metadata updated!");

  if (options.json) {
    formatOutput({ name, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleSkillsUpload(
  name: string,
  filePath: string,
  options: GlobalOptions
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  const content = await readFile(filePath);
  printInfo(`Uploading ${content.length} bytes to skill "${name}"...`);

  const signature = await uploadSkillContent(connection, wallet, name, content, {
    onProgress(chunkIndex, totalChunks, sig) {
      console.log(`  [${chunkIndex}/${totalChunks}] tx: ${sig}`);
    },
  });

  printSuccess("Content uploaded!");

  if (options.json) {
    formatOutput({ name, size: content.length, signature }, true);
  } else {
    console.log(`  Finalize tx: ${signature}`);
  }
}

async function handleSkillsTransfer(
  name: string,
  newAuthority: string,
  options: GlobalOptions
) {
  let newPubkey: PublicKey;
  try {
    newPubkey = new PublicKey(newAuthority);
  } catch {
    throw new Error(`Invalid public key: ${newAuthority}`);
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  printInfo(`Transferring authority of skill "${name}" to ${newPubkey.toBase58()}...`);
  const signature = await transferAuthority(connection, wallet, name, newPubkey);
  printSuccess("Authority transferred!");

  if (options.json) {
    formatOutput({ name, newAuthority: newPubkey.toBase58(), signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleSkillsCloseBuffer(name: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  printInfo(`Closing pending buffer for skill "${name}"...`);
  const signature = await closeBuffer(connection, wallet, name);
  printSuccess("Pending buffer closed and rent reclaimed!");

  if (options.json) {
    formatOutput({ name, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleSkillsDelete(name: string, options: GlobalOptions & { yes?: boolean }) {
  if (!options.json && !options.yes && process.stdin.isTTY) {
    console.log();
    p.intro(pc.bgRed(pc.white(" skills delete ")));
    p.log.warn(
      pc.yellow("This will permanently delete the skill from the blockchain.\n") +
      pc.dim("  · On-chain data and content will be erased\n") +
      pc.dim("  · This action cannot be undone")
    );

    const confirmed = await p.confirm({
      message: `Delete skill ${pc.cyan(name)} from the blockchain?`,
      initialValue: false,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Deletion cancelled");
      process.exit(0);
    }
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Deleting skill "${name}"...`);
  const signature = await deleteSkill(connection, wallet, name);

  if (options.json) {
    formatOutput({ name, signature }, true);
  } else {
    printSuccess("Skill deleted and rent reclaimed!");
    console.log(`  Transaction: ${signature}`);
  }
}

// ─── Register commands ───────────────────────────────────────────

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description("Skills hub commands");

  // skills register
  skills
    .command("register <name> <author>")
    .description("Register a new skill on-chain")
    .action(async (name: string, author: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsRegister(name, author, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills get
  skills
    .command("get <name>")
    .description("Get skill info (record, description, metadata)")
    .action(async (name: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsGet(name, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills content
  skills
    .command("content <name>")
    .description("Read skill content")
    .option("--hex", "Output as hex instead of text")
    .action(async (name: string, opts: { hex?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsContent(name, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills set-description
  skills
    .command("set-description <name> <description>")
    .description("Set or update the skill description (max 512 bytes)")
    .action(async (name: string, description: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsSetDescription(name, description, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills set-metadata
  skills
    .command("set-metadata <name> <json>")
    .description("Set or update the skill JSON metadata (max 800 bytes)")
    .action(async (name: string, json: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsSetMetadata(name, json, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills upload
  skills
    .command("upload <name> <file>")
    .description("Upload skill content from a local file (chunked)")
    .action(async (name: string, file: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsUpload(name, file, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills transfer
  skills
    .command("transfer <name> <new-authority>")
    .description("Transfer skill authority to a new address")
    .action(async (name: string, newAuthority: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsTransfer(name, newAuthority, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills close-buffer
  skills
    .command("close-buffer <name>")
    .description("Close a pending upload buffer and reclaim rent")
    .action(async (name: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsCloseBuffer(name, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills delete
  skills
    .command("delete <name>")
    .description("Delete a skill and reclaim all rent")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (name: string, opts: { yes?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsDelete(name, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // ─── Local install management ─────────────────────────────────

  // skills add
  skills
    .command("add <name>")
    .description("Install a skill from the chain into local agent directories")
    .option("-g, --global", "Install globally (~/<agent>/skills/) instead of project-local")
    .option("-a, --agent <agents...>", "Target specific agents (e.g. claude-code cursor)")
    .action(async (name: string, opts: { global?: boolean; agent?: string[] }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsAdd(name, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills remove
  skills
    .command("remove <name>")
    .description("Remove a locally installed skill")
    .option("-g, --global", "Remove from global scope")
    .option("-a, --agent <agents...>", "Remove from specific agents only")
    .action(async (name: string, opts: { global?: boolean; agent?: string[] }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsRemove(name, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills list
  skills
    .command("list")
    .description("List skills installed via naracli")
    .option("-g, --global", "List global skills instead of project-local")
    .action(async (opts: { global?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsList({ ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills check
  skills
    .command("check")
    .description("Check installed skills for available chain updates")
    .option("-g, --global", "Check global skills")
    .action(async (opts: { global?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsCheck({ ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // skills update
  skills
    .command("update [names...]")
    .description("Update installed skills to the latest chain version")
    .option("-g, --global", "Update global skills")
    .option("-a, --agent <agents...>", "Target specific agents")
    .action(async (names: string[], opts: { global?: boolean; agent?: string[] }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleSkillsUpdate(names, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
