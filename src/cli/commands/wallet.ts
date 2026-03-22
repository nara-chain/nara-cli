/**
 * Wallet commands
 */

import { Command } from "commander";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, writeFile, access } from "node:fs/promises";
import bs58 from "bs58";
import { NaraSDK } from "nara-sdk";

const _DEFAULT_WALLET_PATH = process.env.WALLET_PATH || "~/.config/nara/id.json";
import { loadWallet, getRpcUrl } from "../utils/wallet";
import { validatePublicKey, validatePositiveNumber } from "../utils/validation";
import {
  handleTransaction,
  printTransactionResult,
} from "../utils/transaction";
import { formatOutput, printError, printInfo, printSuccess, printWarning } from "../utils/output";
import type {
  GlobalOptions,
  WalletBalanceOptions,
  TokenBalanceOptions,
  TxStatusOptions,
  TransferSolOptions,
  TransferTokenOptions,
} from "../types";

/**
 * Resolve wallet path (expand ~ to home directory)
 */
const DEFAULT_WALLET_PATH = _DEFAULT_WALLET_PATH.startsWith("~")
  ? join(homedir(), _DEFAULT_WALLET_PATH.slice(1))
  : _DEFAULT_WALLET_PATH;

/**
 * Register wallet commands
 * @param program Commander program
 */
export function registerWalletCommands(program: Command): void {
  const wallet = program
    .command("wallet")
    .description("Wallet management commands");

  // wallet create
  wallet
    .command("create")
    .description("Create a new wallet")
    .option("-o, --output <path>", "Output path for wallet file (default: ~/.config/nara/id.json)")
    .action(async (options: { output?: string }) => {
      try {
        await handleWalletCreate(options);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // wallet import
  wallet
    .command("import")
    .description("Import a wallet from mnemonic or private key")
    .option("-m, --mnemonic <phrase>", "Mnemonic phrase (12 or 24 words)")
    .option("-k, --private-key <key>", "Private key (base58 or JSON array)")
    .option("-o, --output <path>", "Output path for wallet file (default: ~/.config/nara/id.json)")
    .action(async (options: { mnemonic?: string; privateKey?: string; output?: string }) => {
      try {
        await handleWalletImport(options);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

}

/**
 * Handle wallet balance command
 * @param address Wallet address
 * @param options Command options
 */
export async function handleWalletBalance(
  address: string | undefined,
  options: WalletBalanceOptions
): Promise<void> {
  const rpcUrl = getRpcUrl(options.rpcUrl);

  printInfo(`Using RPC: ${rpcUrl}`);

  // Initialize SDK
  const sdk = new NaraSDK({
    rpcUrl,
    commitment: "confirmed",
  });

  const connection = sdk.getConnection();

  // Determine which address to query
  let pubkey: PublicKey;
  if (address) {
    pubkey = validatePublicKey(address);
  } else {
    // Load wallet to get address
    const wallet = await loadWallet(options.wallet);
    pubkey = wallet.publicKey;
  }

  printInfo(`Checking balance for: ${pubkey.toBase58()}`);

  // Get balance
  const balance = await connection.getBalance(pubkey);
  const balanceSOL = balance / LAMPORTS_PER_SOL;

  // Output result
  if (options.json) {
    const output = {
      address: pubkey.toBase58(),
      balance: balanceSOL,
      lamports: balance,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\nWallet: ${pubkey.toBase58()}`);
    console.log(`Balance: ${balanceSOL.toFixed(4)} NARA (${balance.toLocaleString()} lamports)`);
  }
}

/**
 * Handle token balance command
 * @param tokenAddress Token address
 * @param options Command options
 */
export async function handleTokenBalance(
  tokenAddress: string,
  options: Omit<TokenBalanceOptions, "tokenAddress">
): Promise<void> {
  const rpcUrl = getRpcUrl(options.rpcUrl);

  printInfo(`Using RPC: ${rpcUrl}`);

  // Validate token address
  const tokenMint = validatePublicKey(tokenAddress);

  // Initialize SDK
  const sdk = new NaraSDK({
    rpcUrl,
    commitment: "confirmed",
  });

  const connection = sdk.getConnection();

  // Determine owner address
  let owner: PublicKey;
  if (options.owner) {
    owner = validatePublicKey(options.owner);
  } else {
    // Load wallet to get owner
    const wallet = await loadWallet(options.wallet);
    owner = wallet.publicKey;
  }

  printInfo(`Owner: ${owner.toBase58()}`);
  printInfo(`Token: ${tokenAddress}`);

  // Get associated token account
  const tokenAccount = await getAssociatedTokenAddress(tokenMint, owner);

  // Get token account balance
  try {
    const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
    const balance = accountInfo.value;

    // Output result
    if (options.json) {
      const output = {
        owner: owner.toBase58(),
        tokenAddress,
        tokenAccount: tokenAccount.toBase58(),
        balance: balance.uiAmountString,
        amount: balance.amount,
        decimals: balance.decimals,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`\nToken Account: ${tokenAccount.toBase58()}`);
      console.log(`Balance: ${balance.uiAmountString || "0"} tokens`);
      console.log(`Amount: ${balance.amount} (smallest unit)`);
      console.log(`Decimals: ${balance.decimals}`);
    }
  } catch (error: any) {
    if (error.message?.includes("could not find account")) {
      if (options.json) {
        const output = {
          owner: owner.toBase58(),
          tokenAddress,
          tokenAccount: tokenAccount.toBase58(),
          balance: "0",
          amount: "0",
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        printInfo("\nToken account does not exist yet.");
        console.log(`Balance: 0 tokens`);
        console.log(`Token Account (will be created on first transfer): ${tokenAccount.toBase58()}`);
      }
    } else {
      throw error;
    }
  }
}

/**
 * Handle transaction status command
 * @param signature Transaction signature
 * @param options Command options
 */
export async function handleTxStatus(
  signature: string,
  options: Omit<TxStatusOptions, "signature">
): Promise<void> {
  const rpcUrl = getRpcUrl(options.rpcUrl);

  printInfo(`Using RPC: ${rpcUrl}`);
  printInfo(`Checking transaction: ${signature}`);

  // Initialize SDK
  const sdk = new NaraSDK({
    rpcUrl,
    commitment: "confirmed",
  });

  const connection = sdk.getConnection();

  // Get transaction status
  const status = await connection.getSignatureStatus(signature);

  if (!status || !status.value) {
    if (options.json) {
      console.log(JSON.stringify({ signature, status: "not_found" }, null, 2));
    } else {
      printError("Transaction not found");
    }
    return;
  }

  // Get transaction details
  const transaction = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  // Build output
  const output: any = {
    signature,
    status: status.value.confirmationStatus || "unknown",
    slot: status.value.slot,
    confirmations: status.value.confirmations,
  };

  if (status.value.err) {
    output.error = status.value.err;
    output.success = false;
  } else {
    output.success = true;
  }

  if (transaction) {
    output.blockTime = transaction.blockTime;
    output.fee = transaction.meta?.fee;
  }

  // Output result
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\nTransaction: ${signature}`);
    console.log(`Status: ${output.status}`);
    console.log(`Success: ${output.success ? "Yes" : "No"}`);
    console.log(`Slot: ${output.slot}`);
    if (output.confirmations !== null) {
      console.log(`Confirmations: ${output.confirmations}`);
    }
    if (output.blockTime) {
      const date = new Date(output.blockTime * 1000);
      console.log(`Time: ${date.toISOString()}`);
    }
    if (output.fee) {
      console.log(`Fee: ${output.fee / LAMPORTS_PER_SOL} NARA`);
    }
    if (output.error) {
      console.log(`Error: ${JSON.stringify(output.error)}`);
    }
    console.log(
      `\nView on explorer: https://explorer.nara.build/tx/${signature}`
    );
  }
}

/**
 * Handle transfer SOL command
 * @param to Recipient address
 * @param amount Amount in SOL
 * @param options Command options
 */
export async function handleTransferSol(
  to: string,
  amount: string,
  options: Omit<TransferSolOptions, "to" | "amount">
): Promise<void> {
  // Load wallet
  const wallet = await loadWallet(options.wallet);
  const rpcUrl = getRpcUrl(options.rpcUrl);

  printInfo(`Using RPC: ${rpcUrl}`);
  printInfo(`From: ${wallet.publicKey.toBase58()}`);

  // Validate inputs
  const recipient = validatePublicKey(to);
  const amountSOL = validatePositiveNumber(amount, "amount");
  const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

  printInfo(`To: ${recipient.toBase58()}`);
  printInfo(`Amount: ${amountSOL} NARA`);

  // Initialize SDK
  const sdk = new NaraSDK({
    rpcUrl,
    commitment: "confirmed",
  });

  const connection = sdk.getConnection();

  // Create transfer instruction
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: recipient,
    lamports,
  });

  // Create transaction
  const transaction = new Transaction().add(transferInstruction);

  // Get latest blockhash
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  // Handle transaction
  const txResult = await handleTransaction(
    sdk,
    transaction,
    [wallet],
    options.exportTx || false
  );

  // Output result
  if (options.json) {
    const output = {
      from: wallet.publicKey.toBase58(),
      to: recipient.toBase58(),
      amount: amountSOL,
      lamports,
      ...(txResult.signature && { signature: txResult.signature }),
      ...(txResult.base64 && { transaction: txResult.base64 }),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\nTransfer Details:`);
    console.log(`  From: ${wallet.publicKey.toBase58()}`);
    console.log(`  To: ${recipient.toBase58()}`);
    console.log(`  Amount: ${amountSOL} NARA`);
    printTransactionResult(txResult, false);
  }
}

/**
 * Handle transfer token command
 * @param tokenAddress Token address
 * @param to Recipient address
 * @param amount Amount in tokens
 * @param options Command options
 */
export async function handleTransferToken(
  tokenAddress: string,
  to: string,
  amount: string,
  options: Omit<TransferTokenOptions, "tokenAddress" | "to" | "amount">
): Promise<void> {
  // Load wallet
  const wallet = await loadWallet(options.wallet);
  const rpcUrl = getRpcUrl(options.rpcUrl);

  printInfo(`Using RPC: ${rpcUrl}`);
  printInfo(`From: ${wallet.publicKey.toBase58()}`);

  // Validate inputs
  const tokenMint = validatePublicKey(tokenAddress);
  const recipient = validatePublicKey(to);
  const amountInToken = validatePositiveNumber(amount, "amount");
  const decimals = parseInt(String(options.decimals || "6"));
  const amountInSmallestUnit = Math.floor(amountInToken * 10 ** decimals);

  printInfo(`To: ${recipient.toBase58()}`);
  printInfo(`Token: ${tokenAddress}`);
  printInfo(`Amount: ${amountInToken} tokens`);

  // Initialize SDK
  const sdk = new NaraSDK({
    rpcUrl,
    commitment: "confirmed",
  });

  const connection = sdk.getConnection();

  // Get source and destination token accounts
  const sourceAccount = await getAssociatedTokenAddress(
    tokenMint,
    wallet.publicKey
  );
  const destinationAccount = await getAssociatedTokenAddress(
    tokenMint,
    recipient
  );

  // Create transfer instruction
  const transferInstruction = createTransferInstruction(
    sourceAccount,
    destinationAccount,
    wallet.publicKey,
    amountInSmallestUnit,
    [],
    TOKEN_PROGRAM_ID
  );

  // Create transaction
  const transaction = new Transaction().add(transferInstruction);

  // Get latest blockhash
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  // Handle transaction
  const txResult = await handleTransaction(
    sdk,
    transaction,
    [wallet],
    options.exportTx || false
  );

  // Output result
  if (options.json) {
    const output = {
      from: wallet.publicKey.toBase58(),
      to: recipient.toBase58(),
      tokenAddress,
      amount: amountInToken,
      amountSmallestUnit: amountInSmallestUnit.toString(),
      decimals,
      ...(txResult.signature && { signature: txResult.signature }),
      ...(txResult.base64 && { transaction: txResult.base64 }),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\nToken Transfer Details:`);
    console.log(`  From: ${wallet.publicKey.toBase58()}`);
    console.log(`  To: ${recipient.toBase58()}`);
    console.log(`  Token: ${tokenAddress}`);
    console.log(`  Amount: ${amountInToken} tokens`);
    printTransactionResult(txResult, false);
  }
}

/**
 * Handle wallet create command
 * @param options Command options
 */
async function handleWalletCreate(options: { output?: string }): Promise<void> {
  const outputPath = options.output || DEFAULT_WALLET_PATH;

  // Check if wallet file already exists
  try {
    await access(outputPath);
    throw new Error(
      `Wallet file already exists at ${outputPath}. Please use a different path or remove the existing file first.`
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }

  // Generate mnemonic (12 words by default, can be changed to 24)
  const mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words, 256 bits = 24 words

  // Derive keypair from mnemonic using Solana's derivation path
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key;
  const keypair = Keypair.fromSeed(derivedSeed);

  // Ensure directory exists
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });

  // Save wallet to file
  const walletData = Array.from(keypair.secretKey);
  await writeFile(outputPath, JSON.stringify(walletData, null, 2));

  // Display results
  console.log("\n✅ Wallet created successfully!");
  console.log(`\n📁 Wallet saved to: ${outputPath}`);
  console.log(`🔑 Public Key: ${keypair.publicKey.toBase58()}`);

  printWarning("\n⚠️  IMPORTANT: Save your mnemonic phrase securely!");
  printWarning("⚠️  You will need it to recover your wallet.");
  console.log("\n📝 Mnemonic phrase (12 words):");
  console.log(`\n${mnemonic}\n`);

  printWarning("⚠️  Never share your mnemonic phrase with anyone!");
  printWarning("⚠️  Anyone with your mnemonic can access your funds.\n");
}

/**
 * Handle wallet import command
 * @param options Command options
 */
async function handleWalletImport(options: {
  mnemonic?: string;
  privateKey?: string;
  output?: string;
}): Promise<void> {
  const outputPath = options.output || DEFAULT_WALLET_PATH;

  // Check if wallet file already exists
  try {
    await access(outputPath);
    throw new Error(
      `Wallet file already exists at ${outputPath}. Please use a different path or remove the existing file first.`
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }

  let keypair: Keypair;

  if (options.mnemonic) {
    // Import from mnemonic
    const mnemonic = options.mnemonic.trim();

    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error("Invalid mnemonic phrase. Please check your words and try again.");
    }

    // Derive keypair from mnemonic
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key;
    keypair = Keypair.fromSeed(derivedSeed);

    printInfo("Importing wallet from mnemonic...");
  } else if (options.privateKey) {
    // Import from private key
    const privateKey = options.privateKey.trim();

    try {
      if (privateKey.startsWith("[")) {
        // JSON array format
        const data = JSON.parse(privateKey);
        keypair = Keypair.fromSecretKey(new Uint8Array(data));
      } else {
        // Base58 format
        keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      }
      printInfo("Importing wallet from private key...");
    } catch (error: any) {
      throw new Error(`Invalid private key format: ${error.message}`);
    }
  } else {
    throw new Error("Please provide either --mnemonic or --private-key option.");
  }

  // Ensure directory exists
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });

  // Save wallet to file
  const walletData = Array.from(keypair.secretKey);
  await writeFile(outputPath, JSON.stringify(walletData, null, 2));

  // Display results
  console.log("\n✅ Wallet imported successfully!");
  console.log(`\n📁 Wallet saved to: ${outputPath}`);
  console.log(`🔑 Public Key: ${keypair.publicKey.toBase58()}\n`);
}

/**
 * Handle wallet address command
 * @param options Command options
 */
export async function handleWalletAddress(options: GlobalOptions): Promise<void> {
  const wallet = await loadWallet(options.wallet);

  if (options.json) {
    console.log(JSON.stringify({ address: wallet.publicKey.toBase58() }, null, 2));
  } else {
    console.log(wallet.publicKey.toBase58());
  }
}
