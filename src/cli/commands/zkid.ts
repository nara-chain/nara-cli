/**
 * ZK ID commands - interact with nara-zk anonymous identity protocol
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
  createZkId,
  getZkIdInfo,
  deposit,
  scanClaimableDeposits,
  withdraw,
  transferZkIdByCommitment,
  deriveIdSecret,
  computeIdCommitment,
  isValidRecipient,
  generateValidRecipient,
  ZKID_DENOMINATIONS,
} from "nara-sdk";
import BN from "bn.js";

// ─── Denomination helpers ────────────────────────────────────────

const VALID_AMOUNTS = [1, 10, 100, 1000, 10000, 100000] as const;
type ValidAmount = (typeof VALID_AMOUNTS)[number];

const DENOM_MAP: Record<ValidAmount, BN> = {
  1: ZKID_DENOMINATIONS.NARA_1,
  10: ZKID_DENOMINATIONS.NARA_10,
  100: ZKID_DENOMINATIONS.NARA_100,
  1000: ZKID_DENOMINATIONS.NARA_1000,
  10000: ZKID_DENOMINATIONS.NARA_10000,
  100000: ZKID_DENOMINATIONS.NARA_100000,
};

function parseDenomination(amount: string): BN {
  const n = parseInt(amount, 10);
  if (!VALID_AMOUNTS.includes(n as ValidAmount)) {
    throw new Error(
      `Invalid amount "${amount}". Valid denominations: ${VALID_AMOUNTS.join(", ")} NARA`
    );
  }
  return DENOM_MAP[n as ValidAmount];
}

// ─── Command handlers ────────────────────────────────────────────

async function handleZkIdCreate(name: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Deriving idSecret for "${name}"...`);
  const idSecret = await deriveIdSecret(wallet, name);

  // Check if already exists
  const existing = await getZkIdInfo(connection, name);
  if (existing) {
    printWarning(`ZK ID "${name}" already exists (depositCount: ${existing.depositCount})`);
    process.exit(0);
  }

  if (!options.json) printInfo(`Registering ZK ID "${name}"...`);
  const signature = await createZkId(connection, wallet, name, idSecret);
  if (!options.json) printSuccess(`ZK ID "${name}" registered!`);

  if (options.json) {
    formatOutput({ name, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleZkIdInfo(name: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  const info = await getZkIdInfo(connection, name);
  if (!info) {
    if (options.json) {
      formatOutput({ name, exists: false }, true);
    } else {
      printWarning(`ZK ID "${name}" does not exist`);
    }
    return;
  }

  const data = {
    name,
    depositCount: info.depositCount,
    commitmentStartIndex: info.commitmentStartIndex,
    idCommitment: Buffer.from(info.idCommitment).toString("hex"),
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Name: ${name}`);
    console.log(`  Deposit count: ${info.depositCount}`);
    console.log(`  Commitment start index: ${info.commitmentStartIndex}`);
    console.log(`  ID commitment: ${data.idCommitment}`);
    console.log("");
  }
}

async function handleZkIdDeposit(
  name: string,
  amount: string,
  options: GlobalOptions
) {
  const denomination = parseDenomination(amount);
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Depositing ${amount} NARA into ZK ID "${name}"...`);
  const signature = await deposit(connection, wallet, name, denomination);
  if (!options.json) printSuccess("Deposit complete!");

  if (options.json) {
    formatOutput({ name, amount: parseInt(amount), signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleZkIdScan(name: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Scanning claimable deposits for "${name}"...`);
  const idSecret = await deriveIdSecret(wallet, name);
  const claimable = await scanClaimableDeposits(connection, name, idSecret);

  if (options.json) {
    formatOutput(
      {
        name,
        count: claimable.length,
        deposits: claimable.map((d) => ({
          leafIndex: d.leafIndex.toString(),
          depositIndex: d.depositIndex,
          denomination: d.denomination.toString(),
          nara: Number(d.denomination) / 1e9,
        })),
      },
      true
    );
    return;
  }

  if (claimable.length === 0) {
    printInfo("No claimable deposits found");
    return;
  }

  console.log(`\n  Found ${claimable.length} claimable deposit(s):`);
  claimable.forEach((d, i) => {
    const nara = Number(d.denomination) / 1e9;
    console.log(
      `  [${i}] ${nara} NARA  leafIndex=${d.leafIndex}  depositIndex=${d.depositIndex}`
    );
  });
  console.log("");
}

async function handleZkIdWithdraw(
  name: string,
  options: GlobalOptions & { recipient?: string }
) {
  // Validate recipient early (before any network calls)
  let recipient: PublicKey | undefined;
  if (options.recipient) {
    try {
      recipient = new PublicKey(options.recipient);
    } catch {
      throw new Error(`Invalid recipient address: ${options.recipient}`);
    }
    if (!isValidRecipient(recipient)) {
      throw new Error(
        "Recipient address is not a valid BN254 field element. " +
          "Use `zkid withdraw` without --recipient to auto-generate a valid address."
      );
    }
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Scanning deposits for "${name}"...`);
  const idSecret = await deriveIdSecret(wallet, name);
  const claimable = await scanClaimableDeposits(connection, name, idSecret);

  if (claimable.length === 0) {
    printWarning("No claimable deposits found");
    process.exit(0);
  }

  // Auto-generate recipient if not provided
  if (!recipient) {
    const kp = generateValidRecipient();
    recipient = kp.publicKey;
    if (!options.json) printInfo(`Auto-generated recipient: ${recipient.toBase58()}`);
  }

  const depositInfo = claimable[0]!;
  const nara = Number(depositInfo.denomination) / 1e9;
  if (!options.json) printInfo(`Withdrawing ${nara} NARA (depositIndex=${depositInfo.depositIndex})...`);

  const signature = await withdraw(
    connection,
    wallet,
    name,
    idSecret,
    depositInfo,
    recipient
  );
  if (!options.json) printSuccess("Withdrawal complete!");

  if (options.json) {
    formatOutput(
      {
        name,
        recipient: recipient.toBase58(),
        nara,
        depositIndex: depositInfo.depositIndex,
        signature,
      },
      true
    );
  } else {
    console.log(`  Recipient: ${recipient.toBase58()}`);
    console.log(`  Transaction: ${signature}`);
  }
}

async function handleZkIdCommitment(name: string, options: GlobalOptions) {
  const wallet = await loadWallet(options.wallet);
  const commitment = await computeIdCommitment(wallet, name);

  if (options.json) {
    formatOutput({ name, idCommitment: commitment }, true);
  } else {
    console.log("");
    console.log(`  ZK ID name: ${name}`);
    console.log(`  ID commitment: ${commitment}`);
    console.log("");
    printInfo("Share this commitment with the current owner to transfer the ZK ID.");
  }
}

async function handleZkIdTransfer(
  name: string,
  newIdCommitmentHex: string,
  options: GlobalOptions
) {
  // Parse hex commitment
  let newIdCommitment: bigint;
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(newIdCommitmentHex)) {
      throw new Error("must be a 64-char hex string");
    }
    newIdCommitment = BigInt("0x" + newIdCommitmentHex);
  } catch (e: any) {
    throw new Error(`Invalid id-commitment: ${e.message}`);
  }

  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  if (!options.json) printInfo(`Generating ownership proof for "${name}"...`);
  const currentIdSecret = await deriveIdSecret(wallet, name);

  if (!options.json) printInfo("Transferring ZK ID ownership...");
  const signature = await transferZkIdByCommitment(
    connection,
    wallet,
    name,
    currentIdSecret,
    newIdCommitment
  );
  if (!options.json) printSuccess("ZK ID ownership transferred!");

  if (options.json) {
    formatOutput({ name, newIdCommitment: newIdCommitmentHex, signature }, true);
  } else {
    console.log(`  New commitment: ${newIdCommitmentHex}`);
    console.log(`  Transaction: ${signature}`);
  }
}

// ─── Register commands ───────────────────────────────────────────

export function registerZkIdCommands(program: Command): void {
  const zkid = program
    .command("zkid")
    .description("ZK ID commands (anonymous identity protocol)");

  // zkid create
  zkid
    .command("create <name>")
    .description("Register a new ZK ID on-chain")
    .action(async (name: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleZkIdCreate(name, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // zkid info
  zkid
    .command("info <name>")
    .description("Get ZK ID account info (read-only)")
    .action(async (name: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleZkIdInfo(name, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // zkid deposit
  zkid
    .command("deposit <name> <amount>")
    .description(`Deposit fixed-denomination NARA into a ZK ID (valid: ${VALID_AMOUNTS.join(", ")})`)
    .action(async (name: string, amount: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleZkIdDeposit(name, amount, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // zkid scan
  zkid
    .command("scan <name>")
    .description("Scan claimable deposits for a ZK ID (requires wallet)")
    .action(async (name: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleZkIdScan(name, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // zkid withdraw
  zkid
    .command("withdraw <name>")
    .description("Anonymously withdraw the first claimable deposit")
    .option("--recipient <address>", "Recipient address (must be a valid BN254 field element)")
    .action(async (name: string, opts: { recipient?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleZkIdWithdraw(name, { ...globalOpts, ...opts });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // zkid id-commitment
  zkid
    .command("id-commitment <name>")
    .description("Derive and display your idCommitment (share with current owner to receive transfer)")
    .action(async (name: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleZkIdCommitment(name, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // zkid transfer
  zkid
    .command("transfer <name> <new-id-commitment>")
    .description("Transfer ZK ID ownership to the holder of a new idCommitment")
    .action(async (name: string, newIdCommitment: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleZkIdTransfer(name, newIdCommitment, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
