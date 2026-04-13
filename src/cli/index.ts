/**
 * CLI command registration
 */

import { Command } from "commander";
import {
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { registerWalletCommands } from "./commands/wallet";
import { registerQuestCommands } from "./commands/quest";
import { registerSkillsCommands } from "./commands/skills";
import { registerZkIdCommands } from "./commands/zkid";
import { registerAgentCommands } from "./commands/agent";
import { registerConfigCommands } from "./commands/config";
import { registerBridgeCommands } from "./commands/bridge";
import { registerDexCommands } from "./commands/dex";
import {
  handleWalletAddress,
  handleWalletBalance,
  handleTokenBalance,
  handleTxStatus,
  handleTransferNara,
  handleTransferToken,
} from "./commands/wallet";
import { loadWallet, getRpcUrl } from "./utils/wallet";
import { NaraSDK, signUrl } from "nara-sdk";
import { printError, printInfo, printSuccess } from "./utils/output";
import type {
  GlobalOptions,
  WalletBalanceOptions,
  TokenBalanceOptions,
  TxStatusOptions,
  TransferNaraOptions,
  TransferTokenOptions,
} from "./types";

/**
 * Poll for transaction confirmation via HTTP
 */
async function pollConfirmation(
  connection: any,
  signature: string,
  timeoutMs = 15000,
  intervalMs = 1000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value?.[0];
    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Transaction confirmation timeout");
}

/**
 * Register all CLI commands
 * @param program Commander program
 */
export function registerCommands(program: Command): void {
  // wallet (create, import only)
  registerWalletCommands(program);

  // quest
  registerQuestCommands(program);

  // skills
  registerSkillsCommands(program);

  // zkid
  registerZkIdCommands(program);

  // agent
  registerAgentCommands(program);

  // bridge
  registerBridgeCommands(program);

  // dex
  registerDexCommands(program);

  // config
  registerConfigCommands(program);

  // Top-level: guide
  program
    .command("guide")
    .description("Show the full NARA usage guide (SKILL.md)")
    .action(async () => {
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { join, resolve } = await import("node:path");
        // Try multiple paths: project root (dev), dist dir (bundle), npm global
        const candidates = [
          join(resolve("."), "skills", "nara", "SKILL.md"),
        ];
        // CJS bundle mode: __dirname is available
        if (typeof __dirname !== "undefined") {
          candidates.push(join(__dirname, "..", "skills", "nara", "SKILL.md"));
          candidates.push(join(__dirname, "skills", "nara", "SKILL.md"));
        }
        let content = "";
        for (const p of candidates) {
          if (existsSync(p)) {
            content = readFileSync(p, "utf-8");
            break;
          }
        }
        if (!content) {
          printError("SKILL.md not found. Reinstall naracli or run from the project directory.");
          process.exit(1);
        }
        // Strip frontmatter
        const stripped = content.replace(/^---[\s\S]*?---\n*/, "");
        console.log(stripped);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: activity
  program
    .command("activity")
    .description("Show current community activities and events (check daily for new rewards)")
    .action(async () => {
      try {
        const res = await fetch("https://nara.build/activity.md");
        if (!res.ok) {
          printError(`Failed to fetch activity info (HTTP ${res.status})`);
          process.exit(1);
        }
        const content = await res.text();
        const stripped = content.replace(/^---[\s\S]*?---\n*/, "");
        console.log(stripped);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: address
  program
    .command("address")
    .description("Show wallet public address (run this first to check if a wallet exists)")
    .action(async () => {
      const opts = program.opts() as GlobalOptions;
      try {
        await handleWalletAddress(opts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: balance
  program
    .command("balance")
    .description("Check NARA balance (native coin, not SOL)")
    .argument("[address]", "Wallet address (optional, defaults to current wallet)")
    .action(async (address: string | undefined) => {
      const opts = program.opts() as WalletBalanceOptions;
      try {
        await handleWalletBalance(address, opts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });


  // Top-level: token-balance
  program
    .command("token-balance [token-address]")
    .description("Check token balance. Without token-address, shows USDC, USDT, SOL balances.")
    .option("--owner <address>", "Owner address (optional, defaults to current wallet)")
    .action(async (tokenAddress: string | undefined, options: { owner?: string }) => {
      const opts = program.opts() as TokenBalanceOptions;
      try {
        if (tokenAddress) {
          await handleTokenBalance(tokenAddress, { ...opts, ...options });
        } else {
          // Show common token balances
          const { Connection, PublicKey } = await import("@solana/web3.js");
          const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");
          const rpcUrl = getRpcUrl(opts.rpcUrl);
          const connection = new Connection(rpcUrl, "confirmed");

          let owner: PublicKey;
          if (options.owner) {
            owner = new PublicKey(options.owner);
          } else {
            const wallet = await loadWallet(opts.wallet);
            owner = wallet.publicKey;
          }

          const tokens = [
            { symbol: "USDC", mint: "8P7UGWjq86N3WUmwEgKeGHJZLcoMJqr5jnRUmeBN7YwR", program: TOKEN_2022_PROGRAM_ID, decimals: 6 },
            { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", program: TOKEN_PROGRAM_ID, decimals: 6 },
            { symbol: "SOL",  mint: "7fKh7DqPZmsYPHdGvt9Qw2rZkSEGp9F5dBa3XuuuhavU", program: TOKEN_2022_PROGRAM_ID, decimals: 9 },
          ];

          // Build all ATA addresses
          const atas = await Promise.all(
            tokens.map(t => getAssociatedTokenAddress(new PublicKey(t.mint), owner, true, t.program))
          );

          // Batch fetch with getMultipleAccountsInfo
          const accounts = await connection.getMultipleAccountsInfo(atas);

          const results = tokens.map((t, i) => {
            const acc = accounts[i];
            let balance = "0";
            let amount = "0";
            if (acc) {
              try {
                // Parse token account data: amount is at offset 64, 8 bytes LE
                const raw = BigInt("0x" + Buffer.from(acc.data.slice(64, 72)).reverse().toString("hex"));
                amount = raw.toString();
                balance = (Number(raw) / 10 ** t.decimals).toString();
              } catch {}
            }
            return { symbol: t.symbol, mint: t.mint, balance, amount };
          });

          if (opts.json) {
            console.log(JSON.stringify({ owner: owner.toBase58(), tokens: results }, null, 2));
          } else {
            console.log(`\n  Owner: ${owner.toBase58()}\n`);
            for (const r of results) {
              console.log(`  ${r.mint}  ${r.symbol.padEnd(6)} ${r.balance}`);
            }
            console.log("");
          }
        }
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: tx-status
  program
    .command("tx-status <signature>")
    .description("Check transaction status")
    .action(async (signature: string) => {
      const opts = program.opts() as TxStatusOptions;
      try {
        await handleTxStatus(signature, opts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: transfer
  program
    .command("transfer <to> <amount>")
    .description("Transfer NARA to another wallet")
    .option("-e, --export-tx", "Export unsigned transaction", false)
    .action(async (to: string, amount: string, options: { exportTx?: boolean }) => {
      const opts = program.opts() as TransferNaraOptions;
      try {
        await handleTransferNara(to, amount, { ...opts, ...options });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: transfer-token
  program
    .command("transfer-token <token-address> <to> <amount>")
    .description("Transfer tokens to another wallet")
    .option("--decimals <number>", "Token decimals", "6")
    .option("-e, --export-tx", "Export unsigned transaction", false)
    .action(async (tokenAddress: string, to: string, amount: string, options: { decimals?: string; exportTx?: boolean }) => {
      const opts = program.opts() as TransferTokenOptions;
      try {
        await handleTransferToken(tokenAddress, to, amount, { ...opts, decimals: options.decimals ? parseInt(options.decimals) : undefined, exportTx: options.exportTx });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: sign-url
  program
    .command("sign-url <url>")
    .description("Sign a URL with wallet keypair (adds address, ts, sign params)")
    .action(async (url: string) => {
      const opts = program.opts() as GlobalOptions;
      try {
        const wallet = await loadWallet(opts.wallet);
        // Extract existing query params so they're included in the signature
        const parsed = new URL(url);
        const params: Record<string, string> = {};
        parsed.searchParams.forEach((v, k) => { params[k] = v; });
        parsed.search = "";
        const signed = signUrl(parsed.toString(), wallet, params);
        if (opts.json) {
          console.log(JSON.stringify({ url: signed }, null, 2));
        } else {
          console.log(signed);
        }
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // Top-level: sign
  program
    .command("sign <base64-tx>")
    .description("Sign a base64-encoded transaction (supports legacy and versioned transactions)")
    .option("--send", "Sign and broadcast the transaction on-chain", false)
    .action(async (base64Tx: string, options: { send?: boolean }) => {
      const opts = program.opts() as GlobalOptions;
      try {
        const wallet = await loadWallet(opts.wallet);
        const buf = Buffer.from(base64Tx, "base64");

        // Try VersionedTransaction first, fall back to legacy
        let tx: Transaction | VersionedTransaction;
        try {
          tx = VersionedTransaction.deserialize(new Uint8Array(buf));
        } catch {
          tx = Transaction.from(buf);
        }

        // Sign
        if (tx instanceof VersionedTransaction) {
          tx.sign([wallet]);
        } else {
          tx.sign(wallet);
        }

        if (options.send) {
          const rpcUrl = getRpcUrl(opts.rpcUrl);
          const sdk = new NaraSDK({ rpcUrl, commitment: "confirmed" });
          const connection = sdk.getConnection();

          printInfo("Sending transaction...");
          let signature: string;
          if (tx instanceof VersionedTransaction) {
            signature = await connection.sendTransaction(tx, { maxRetries: 3 });
          } else {
            signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
          }

          printInfo("Confirming transaction...");
          await pollConfirmation(connection, signature);

          if (opts.json) {
            console.log(JSON.stringify({ signature }, null, 2));
          } else {
            printSuccess("Transaction sent!");
            console.log(`Signature: ${signature}`);
          }
        } else {
          // Output signed base64
          const serialized = tx instanceof VersionedTransaction
            ? Buffer.from(tx.serialize()).toString("base64")
            : Buffer.from(tx.serialize()).toString("base64");

          if (opts.json) {
            console.log(JSON.stringify({ transaction: serialized }, null, 2));
          } else {
            console.log(serialized);
          }
        }
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
