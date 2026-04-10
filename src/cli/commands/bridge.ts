/**
 * Bridge commands - cross-chain transfer between Solana and Nara
 */

import { Command } from "commander";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { loadWallet, getRpcUrl } from "../utils/wallet";
import {
  printError,
  printInfo,
  printSuccess,
  formatOutput,
} from "../utils/output";
import type { GlobalOptions } from "../types";
import {
  bridgeTransfer,
  extractMessageId,
  queryMessageStatus,
  queryMessageSignatures,
  BRIDGE_TOKENS,
  type BridgeChain,
} from "nara-sdk";

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const NARA_RPC = "https://mainnet-api.nara.build/";

function getSourceConnection(fromChain: BridgeChain, rpcUrl?: string): Connection {
  if (rpcUrl) return new Connection(rpcUrl, "confirmed");
  return new Connection(fromChain === "solana" ? SOLANA_RPC : NARA_RPC, "confirmed");
}

function getDestConnection(toChain: BridgeChain): Connection {
  return new Connection(toChain === "solana" ? SOLANA_RPC : NARA_RPC, "confirmed");
}

// ─── Command: bridge transfer ────────────────────────────────────

async function handleBridgeTransfer(
  token: string,
  amount: string,
  options: GlobalOptions & { from: string; to?: string; recipient?: string }
) {
  const fromChain = options.from as BridgeChain;
  if (fromChain !== "solana" && fromChain !== "nara") {
    printError('--from must be "solana" or "nara"');
    process.exit(1);
  }
  const toChain: BridgeChain = fromChain === "solana" ? "nara" : "solana";

  const tokenUpper = token.toUpperCase();
  const tokenConfig = (BRIDGE_TOKENS as Record<string, any>)[tokenUpper];
  if (!tokenConfig) {
    printError(`Unknown token "${token}". Supported: ${Object.keys(BRIDGE_TOKENS).join(", ")}`);
    process.exit(1);
  }

  const wallet = await loadWallet(options.wallet);
  const recipientPubkey = options.recipient
    ? new PublicKey(options.recipient)
    : wallet.publicKey;

  const decimals = tokenConfig.decimals;
  const rawAmount = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));

  const rpcUrl = fromChain === "nara" ? getRpcUrl(options.rpcUrl) : undefined;
  const connection = getSourceConnection(fromChain, rpcUrl);

  // Check gas balance
  const gasBalance = await connection.getBalance(wallet.publicKey);
  const minGas = 0.001 * LAMPORTS_PER_SOL;
  if (gasBalance < minGas) {
    const coin = fromChain === "solana" ? "SOL" : "NARA";
    printError(`Insufficient gas. Balance: ${gasBalance / LAMPORTS_PER_SOL} ${coin}, need at least 0.001 ${coin}.`);
    process.exit(1);
  }

  // Check token balance
  const sourceSide = tokenConfig[fromChain];
  if (sourceSide.mint) {
    // SPL token — check token account balance
    const tokenAccount = await getAssociatedTokenAddress(sourceSide.mint, wallet.publicKey, false, sourceSide.tokenProgram);
    try {
      const bal = await connection.getTokenAccountBalance(tokenAccount);
      const rawBalance = BigInt(bal.value.amount);
      if (rawBalance < rawAmount) {
        printError(`Insufficient ${tokenUpper} balance. Have: ${bal.value.uiAmountString}, need: ${amount}`);
        process.exit(1);
      }
    } catch {
      printError(`No ${tokenUpper} token account found. Balance: 0`);
      process.exit(1);
    }
  } else {
    // Native token — check SOL/NARA balance (minus gas reserve)
    const available = BigInt(gasBalance) - BigInt(Math.ceil(minGas));
    if (available < rawAmount) {
      const coin = fromChain === "solana" ? "SOL" : "NARA";
      printError(`Insufficient ${coin} balance. Available: ${Number(available) / LAMPORTS_PER_SOL} (after gas reserve), need: ${amount}`);
      process.exit(1);
    }
  }

  if (!options.json) {
    printInfo(`Bridging ${amount} ${tokenUpper} from ${fromChain} to ${toChain}...`);
    printInfo(`Sender: ${wallet.publicKey.toBase58()}`);
    printInfo(`Recipient: ${recipientPubkey.toBase58()}`);
  }

  const result = await bridgeTransfer(connection, wallet, {
    token: tokenUpper,
    fromChain,
    recipient: recipientPubkey,
    amount: rawAmount,
  });

  if (!options.json) {
    printSuccess("Bridge transfer submitted!");
    console.log(`  Transaction: ${result.signature}`);
    console.log(`  Message ID: ${result.messageId ?? "(pending)"}`);
    console.log(`  Fee: ${Number(result.feeAmount) / 10 ** decimals} ${tokenUpper}`);
    console.log(`  Bridged: ${Number(result.bridgeAmount) / 10 ** decimals} ${tokenUpper}`);
    console.log("");
    console.log(`  Track delivery: npx naracli bridge status ${result.messageId ?? result.signature} --from ${fromChain}`);
  } else {
    formatOutput({
      signature: result.signature,
      messageId: result.messageId,
      feeAmount: result.feeAmount.toString(),
      bridgeAmount: result.bridgeAmount.toString(),
      fromChain,
      toChain,
      token: tokenUpper,
    }, true);
  }
}

// ─── Command: bridge status ──────────────────────────────────────

async function handleBridgeStatus(
  id: string,
  options: GlobalOptions & { from: string }
) {
  const fromChain = options.from as BridgeChain;
  if (fromChain !== "solana" && fromChain !== "nara") {
    printError('--from must be "solana" or "nara"');
    process.exit(1);
  }
  const toChain: BridgeChain = fromChain === "solana" ? "nara" : "solana";

  let messageId = id;

  // If it doesn't look like a message ID (0x...), treat as tx signature
  if (!id.startsWith("0x")) {
    if (!options.json) printInfo("Extracting message ID from transaction...");
    const sourceConn = getSourceConnection(fromChain, fromChain === "nara" ? getRpcUrl(options.rpcUrl) : undefined);
    const extracted = await extractMessageId(sourceConn, id);
    if (!extracted) {
      printError("Could not extract message ID from transaction. It may not have been confirmed yet.");
      process.exit(1);
    }
    messageId = extracted;
    if (!options.json) console.log(`  Message ID: ${messageId}`);
  }

  // Query delivery status
  if (!options.json) printInfo("Checking delivery status...");
  const destConn = getDestConnection(toChain);
  const status = await queryMessageStatus(destConn, messageId, toChain);

  // Query validator signatures
  if (!options.json) printInfo("Checking validator signatures...");
  const sigStatus = await queryMessageSignatures(messageId, fromChain);

  if (options.json) {
    formatOutput({
      messageId,
      fromChain,
      toChain,
      delivered: status.delivered,
      deliverySignature: status.deliverySignature,
      validators: {
        signed: sigStatus.signedCount,
        total: sigStatus.totalValidators,
        fullySigned: sigStatus.fullySigned,
      },
    }, true);
  } else {
    console.log("");
    console.log(`  Message ID: ${messageId}`);
    console.log(`  Route: ${fromChain} → ${toChain}`);
    console.log(`  Delivered: ${status.delivered ? "yes" : "no"}`);
    if (status.deliverySignature) console.log(`  Delivery TX: ${status.deliverySignature}`);
    console.log(`  Validators: ${sigStatus.signedCount}/${sigStatus.totalValidators} signed${sigStatus.fullySigned ? " (complete)" : ""}`);
    console.log("");
  }
}

// ─── Command: bridge tokens ──────────────────────────────────────

function handleBridgeTokens(options: GlobalOptions) {
  const tokens = Object.values(BRIDGE_TOKENS) as any[];
  if (options.json) {
    formatOutput(tokens.map((t: any) => ({
      symbol: t.symbol,
      decimals: t.decimals,
      solanaMint: t.solana.mint?.toBase58() ?? "native",
      naraMint: t.nara.mint?.toBase58() ?? "native",
    })), true);
  } else {
    console.log("");
    for (const t of tokens) {
      console.log(`  ${t.symbol} (${t.decimals} decimals)`);
      console.log(`    Solana: ${t.solana.mint?.toBase58() ?? "native SOL"} (${t.solana.mode})`);
      console.log(`    Nara:   ${t.nara.mint?.toBase58() ?? "native NARA"} (${t.nara.mode})`);
    }
    console.log("");
  }
}

// ─── Register commands ───────────────────────────────────────────

export function registerBridgeCommands(program: Command): void {
  const bridge = program
    .command("bridge")
    .description("Cross-chain bridge between Solana and Nara (powered by Hyperlane, 0.5% fee)")
    .addHelpText("after", `
Examples:
  npx naracli bridge transfer USDC 10 --from solana     # Solana → Nara
  npx naracli bridge transfer USDC 10 --from nara       # Nara → Solana`);

  // bridge transfer
  bridge
    .command("transfer <token> <amount>")
    .description("Bridge tokens between Solana and Nara (e.g. bridge transfer USDC 10 --from solana)")
    .requiredOption("--from <chain>", 'Source chain: "solana" or "nara"')
    .option("--recipient <address>", "Recipient address on destination chain (defaults to sender)")
    .action(async (token: string, amount: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleBridgeTransfer(token, amount, { ...globalOpts, from: opts.from, recipient: opts.recipient });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // bridge status
  bridge
    .command("status <tx-or-message-id>")
    .description("Check bridge transfer status by transaction signature or message ID")
    .requiredOption("--from <chain>", 'Source chain: "solana" or "nara"')
    .action(async (id: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleBridgeStatus(id, { ...globalOpts, from: opts.from });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // bridge tokens
  bridge
    .command("tokens")
    .description("List supported bridge tokens")
    .action(async (_opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        handleBridgeTokens(globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
