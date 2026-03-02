/**
 * Wallet loading utilities
 */

import { Keypair } from "@solana/web3.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_RPC_URL } from "nara-sdk";

const _DEFAULT_WALLET_PATH = process.env.WALLET_PATH || "~/.config/nara/id.json";

/**
 * Resolve wallet path (expand ~ to home directory)
 */
const DEFAULT_WALLET_PATH = _DEFAULT_WALLET_PATH.startsWith("~")
  ? join(homedir(), _DEFAULT_WALLET_PATH.slice(1))
  : _DEFAULT_WALLET_PATH;

/**
 * Load wallet keypair from file
 *
 * Priority:
 * 1. CLI flag (walletPath parameter)
 * 2. Default path (~/.config/nara/id.json)
 * 3. Error if neither exists
 *
 * @param walletPath Optional path to wallet keypair JSON file
 * @returns Keypair
 * @throws Error if wallet cannot be loaded
 */
export async function loadWallet(walletPath?: string): Promise<Keypair> {
  // Use provided path or default path
  const path = walletPath || DEFAULT_WALLET_PATH;

  try {
    const fs = await import("node:fs/promises");
    const file = await fs.readFile(path, "utf-8");
    const data = JSON.parse(file);

    // Handle both array format [1,2,3,...] and object format
    if (Array.isArray(data)) {
      return Keypair.fromSecretKey(new Uint8Array(data));
    } else if (data.secretKey) {
      return Keypair.fromSecretKey(new Uint8Array(data.secretKey));
    } else {
      throw new Error(
        "Invalid wallet file format. Expected array or object with secretKey field."
      );
    }
  } catch (error: any) {
    if (!walletPath) {
      throw new Error(
        `No wallet found. Create one first:\n\n  npx naracli wallet create\n`
      );
    } else {
      throw new Error(`Failed to load wallet from ${path}: ${error.message}`);
    }
  }
}

/**
 * Get RPC URL from options
 *
 * Priority:
 * 1. CLI flag (rpcUrl parameter)
 * 2. Default (from constants)
 *
 * @param rpcUrl Optional RPC URL from CLI flag
 * @returns RPC URL
 */
export function getRpcUrl(rpcUrl?: string): string {
  return rpcUrl || DEFAULT_RPC_URL;
}
