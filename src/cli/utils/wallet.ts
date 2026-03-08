/**
 * Wallet loading utilities
 */

import { Keypair } from "@solana/web3.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_RPC_URL } from "nara-sdk";
import { loadGlobalConfig, migrateIfNeeded } from "./agent-config";

const DEFAULT_WALLET_PATH = join(homedir(), ".config", "nara", "id.json");

/**
 * Resolve wallet path (expand ~ to home directory)
 */
function resolvePath(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/**
 * Load wallet keypair from file
 *
 * Priority:
 * 1. CLI flag (walletPath parameter)
 * 2. Global config (~/.config/nara/config.json wallet field)
 * 3. Default path (~/.config/nara/id.json)
 */
export async function loadWallet(walletPath?: string): Promise<Keypair> {
  let path = walletPath;
  if (!path) {
    const config = loadGlobalConfig();
    path = config.wallet ? resolvePath(config.wallet) : DEFAULT_WALLET_PATH;
  } else {
    path = resolvePath(path);
  }

  try {
    const fs = await import("node:fs/promises");
    const file = await fs.readFile(path, "utf-8");
    const data = JSON.parse(file);

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
 * Get RPC URL
 *
 * Priority:
 * 1. CLI flag (rpcUrl parameter)
 * 2. Global config (~/.config/nara/config.json rpc_url field)
 * 3. Default (from SDK constants)
 *
 * Also triggers migration from legacy agent.json if needed.
 */
export function getRpcUrl(rpcUrl?: string): string {
  const effective = rpcUrl || loadGlobalConfig().rpc_url || DEFAULT_RPC_URL;
  migrateIfNeeded(effective);
  return effective;
}
