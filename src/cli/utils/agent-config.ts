/**
 * Agent config utilities
 *
 * Global config:  ~/.config/nara/config.json        — rpc_url, wallet
 * Network config: ~/.config/nara/agent-{network}.json — agent_id, zk_ids
 *
 * {network} is derived from the effective RPC URL:
 *   https://mainnet-api.nara.build/ → mainnet-api-nara-build
 *   https://devnet-api.nara.build/  → devnet-api-nara-build
 *   http://127.0.0.1:8899/          → 127-0-0-1-8899
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { Connection } from "@solana/web3.js";
import { DEFAULT_RPC_URL, getAgentInfo } from "nara-sdk";

const CONFIG_DIR = join(homedir(), ".config", "nara");
const GLOBAL_CONFIG_PATH = join(CONFIG_DIR, "config.json");

// ─── URL → filename ─────────────────────────────────────────────

export function rpcUrlToNetworkName(url: string): string {
  let name = url.replace(/^https?:\/\//, "");
  name = name.replace(/\/+$/, "");
  name = name.replace(/[^a-zA-Z0-9-]/g, "-");
  name = name.replace(/-+/g, "-");
  name = name.replace(/^-|-$/g, "");
  return name;
}

function networkConfigPath(rpcUrl: string): string {
  return join(CONFIG_DIR, `agent-${rpcUrlToNetworkName(rpcUrl)}.json`);
}

// ─── Global config (rpc_url, wallet) ─────────────────────────────

export interface GlobalConfig {
  rpc_url?: string;
  wallet?: string;
}

export function loadGlobalConfig(): GlobalConfig {
  try {
    const raw = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      rpc_url: parsed.rpc_url ?? undefined,
      wallet: parsed.wallet ?? undefined,
    };
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: GlobalConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Get the effective RPC URL (without CLI flag context).
 * For use when no CLI flag is available.
 */
export function getConfiguredRpcUrl(): string {
  const global = loadGlobalConfig();
  return global.rpc_url || DEFAULT_RPC_URL;
}

// ─── Network config (agent_id, zk_ids) ───────────────────────────

export interface NetworkConfig {
  agent_id: string;
  zk_ids: string[];
}

const DEFAULT_NETWORK_CONFIG: NetworkConfig = { agent_id: "", zk_ids: [] };

/** Read raw JSON from network config file. */
function loadRawNetworkConfig(rpcUrl?: string): Record<string, any> {
  const url = rpcUrl || getConfiguredRpcUrl();
  const path = networkConfigPath(url);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Write raw JSON to network config file. */
function saveRawNetworkConfig(data: Record<string, any>, rpcUrl?: string): void {
  const url = rpcUrl || getConfiguredRpcUrl();
  const path = networkConfigPath(url);
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Load network-specific config.
 * @param rpcUrl - effective RPC URL (determines which file to load)
 * @param walletPubkey - wallet public key to look up agent_id (optional)
 */
export function loadNetworkConfig(rpcUrl?: string, walletPubkey?: string): NetworkConfig {
  const raw = loadRawNetworkConfig(rpcUrl);

  // Resolve agent_id: new format uses wallet pubkey as key
  let agent_id = "";
  if (walletPubkey && typeof raw[walletPubkey] === "string") {
    agent_id = raw[walletPubkey];
  } else if (typeof raw.agent_id === "string" && raw.agent_id) {
    // Legacy format: { "agent_id": "xxx" } — return value but don't migrate here
    // Call migrateAgentIdFormat() to migrate with on-chain authority check
    agent_id = raw.agent_id;
  } else if (!walletPubkey) {
    // No wallet provided — find first agent_id from any key (best-effort)
    for (const [k, v] of Object.entries(raw)) {
      if (k !== "zk_ids" && typeof v === "string" && v) {
        agent_id = v;
        break;
      }
    }
  }

  return {
    agent_id,
    zk_ids: Array.isArray(raw.zk_ids) ? raw.zk_ids : [],
  };
}

/**
 * Save network-specific config.
 */
export function saveNetworkConfig(config: NetworkConfig, rpcUrl?: string): void {
  const raw = loadRawNetworkConfig(rpcUrl);
  // Preserve existing wallet->agentId mappings, update zk_ids
  raw.zk_ids = config.zk_ids;
  saveRawNetworkConfig(raw, rpcUrl);
}

// ─── Convenience helpers ─────────────────────────────────────────

export function setAgentId(id: string, rpcUrl?: string, walletPubkey?: string): void {
  const raw = loadRawNetworkConfig(rpcUrl);
  if (walletPubkey) {
    raw[walletPubkey] = id;
    // Clean up legacy field if present
    delete raw.agent_id;
  } else {
    raw.agent_id = id;
  }
  saveRawNetworkConfig(raw, rpcUrl);
}

export function clearAgentId(rpcUrl?: string, walletPubkey?: string): void {
  const raw = loadRawNetworkConfig(rpcUrl);
  if (walletPubkey) {
    delete raw[walletPubkey];
  }
  // Also clean up legacy field
  delete raw.agent_id;
  saveRawNetworkConfig(raw, rpcUrl);
}

/**
 * Migrate legacy { "agent_id": "xxx" } to { "<authority-pubkey>": "xxx" }.
 * Queries on-chain agent info to determine the authority.
 * No-op if no legacy agent_id field exists.
 */
export async function migrateAgentIdFormat(rpcUrl?: string): Promise<void> {
  const url = rpcUrl || getConfiguredRpcUrl();
  const raw = loadRawNetworkConfig(url);
  if (typeof raw.agent_id !== "string" || !raw.agent_id) return;

  const agentId = raw.agent_id;
  try {
    const connection = new Connection(url, "confirmed");
    const info = await getAgentInfo(connection, agentId);
    const authority = info.record.authority.toBase58();
    raw[authority] = agentId;
    delete raw.agent_id;
    saveRawNetworkConfig(raw, url);
  } catch {
    // Agent not found on-chain or RPC error — keep legacy format for now
  }
}

export function addZkId(name: string, rpcUrl?: string): void {
  const config = loadNetworkConfig(rpcUrl);
  config.zk_ids = [name, ...config.zk_ids.filter((x) => x !== name)];
  saveNetworkConfig(config, rpcUrl);
}

// ─── Migration: import old agent.json if network config doesn't exist ──

const LEGACY_CONFIG_PATH = join(CONFIG_DIR, "agent.json");

export function migrateIfNeeded(rpcUrl?: string): void {
  const url = rpcUrl || getConfiguredRpcUrl();
  const path = networkConfigPath(url);
  if (existsSync(path)) return;
  if (!existsSync(LEGACY_CONFIG_PATH)) return;

  try {
    const raw = readFileSync(LEGACY_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    // Migrate network-specific fields
    const networkConfig: NetworkConfig = {
      agent_id: typeof parsed.agent_id === "string" ? parsed.agent_id : "",
      zk_ids: Array.isArray(parsed.zk_ids) ? parsed.zk_ids : [],
    };
    saveNetworkConfig(networkConfig, url);

    // Migrate global fields if config.json doesn't exist
    if (!existsSync(GLOBAL_CONFIG_PATH)) {
      const globalConfig: GlobalConfig = {};
      if (parsed.rpc_url) globalConfig.rpc_url = parsed.rpc_url;
      if (parsed.wallet) globalConfig.wallet = parsed.wallet;
      if (Object.keys(globalConfig).length > 0) {
        saveGlobalConfig(globalConfig);
      }
    }
  } catch {
    // Ignore migration errors
  }
}
