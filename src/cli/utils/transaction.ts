/**
 * Transaction handling utilities
 */

import {
  Transaction,
  VersionedTransaction,
  Keypair,
  Connection,
} from "@solana/web3.js";
import { NaraSDK } from "nara-sdk";
import { printInfo, printSuccess } from "./output";

/**
 * Result of transaction handling
 */
export interface TransactionResult {
  /** Transaction signature (if sent) */
  signature?: string;
  /** Base64-encoded transaction (if exported) */
  base64?: string;
}

/**
 * Handle transaction signing and sending or exporting
 *
 * @param sdk NaraSDK SDK instance
 * @param transaction Transaction or VersionedTransaction
 * @param signers Array of keypairs to sign with
 * @param exportMode Whether to export unsigned transaction
 * @returns Transaction result with signature or base64
 */
export async function handleTransaction(
  sdk: NaraSDK,
  transaction: Transaction | VersionedTransaction,
  signers: Keypair[],
  exportMode: boolean = false
): Promise<TransactionResult> {
  if (exportMode) {
    // Export unsigned transaction as base64
    return exportTransaction(transaction);
  }

  // Sign and send transaction
  return await signAndSendTransaction(sdk, transaction, signers);
}

/**
 * Export unsigned transaction as base64
 * @param transaction Transaction to export
 * @returns Base64-encoded transaction
 */
function exportTransaction(
  transaction: Transaction | VersionedTransaction
): TransactionResult {
  try {
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const base64 = Buffer.from(serialized).toString("base64");

    return { base64 };
  } catch (error: any) {
    throw new Error(`Failed to serialize transaction: ${error.message}`);
  }
}

/**
 * Sign and send transaction
 * @param sdk NaraSDK SDK instance
 * @param transaction Transaction to sign and send
 * @param signers Keypairs to sign with
 * @returns Transaction signature
 */
async function signAndSendTransaction(
  sdk: NaraSDK,
  transaction: Transaction | VersionedTransaction,
  signers: Keypair[]
): Promise<TransactionResult> {
  const connection = sdk.getConnection();

  try {
    printInfo("Signing transaction...");

    let signature: string;

    if (transaction instanceof VersionedTransaction) {
      transaction.sign(signers);
      printInfo("Sending transaction...");
      signature = await connection.sendTransaction(transaction, {
        maxRetries: 3,
      });
    } else {
      transaction.sign(...signers);
      printInfo("Sending transaction...");
      signature = await connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: true }
      );
    }

    printInfo("Confirming transaction...");
    await pollConfirmation(connection, signature);

    return { signature };
  } catch (error: any) {
    throw new Error(`Transaction failed: ${error.message}`);
  }
}

/**
 * Poll for transaction confirmation via HTTP (no WebSocket needed)
 */
async function pollConfirmation(
  connection: Connection,
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
 * Print transaction result
 * @param result Transaction result
 * @param jsonMode Whether to output in JSON format
 */
export function printTransactionResult(
  result: TransactionResult,
  jsonMode: boolean = false
): void {
  if (result.signature) {
    if (jsonMode) {
      console.log(JSON.stringify({ signature: result.signature }, null, 2));
    } else {
      printSuccess("Transaction successful!");
      console.log(`Signature: ${result.signature}`);
      console.log(
        `View on explorer: https://explorer.nara.build/tx/${result.signature}`
      );
    }
  } else if (result.base64) {
    if (jsonMode) {
      console.log(JSON.stringify({ transaction: result.base64 }, null, 2));
    } else {
      printSuccess("Transaction exported!");
      console.log(`\nBase64 transaction:\n${result.base64}`);
    }
  }
}
