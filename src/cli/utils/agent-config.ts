/**
 * Agent config utilities
 *
 * Global config:  ~/.config/nara/config.json        — rpc_url, wallet
 * Network config: ~/.config/nara/agent-{network}.json — agent_ids, zk_ids
 *
 * {network} is derived from the effective RPC URL:
 *   https://mainnet-api.nara.build/ → mainnet-api-nara-build
 *   https://devnet-api.nara.build/  → devnet-api-nara-build
 *   http://127.0.0.1:8899/          → 127-0-0-1-8899
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { DEFAULT_RPC_URL } from "nara-sdk";

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

// ─── Network config (agent_ids, zk_ids) ──────────────────────────

export interface NetworkConfig {
  agent_ids: string[];
  zk_ids: string[];
}

const DEFAULT_NETWORK_CONFIG: NetworkConfig = { agent_ids: [], zk_ids: [] };

/**
 * Load network-specific config.
 * @param rpcUrl - effective RPC URL (determines which file to load)
 */
export function loadNetworkConfig(rpcUrl?: string): NetworkConfig {
  const url = rpcUrl || getConfiguredRpcUrl();
  const path = networkConfigPath(url);
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      agent_ids: Array.isArray(parsed.agent_ids) ? parsed.agent_ids : [],
      zk_ids: Array.isArray(parsed.zk_ids) ? parsed.zk_ids : [],
    };
  } catch {
    return { ...DEFAULT_NETWORK_CONFIG };
  }
}

/**
 * Save network-specific config.
 */
export function saveNetworkConfig(config: NetworkConfig, rpcUrl?: string): void {
  const url = rpcUrl || getConfiguredRpcUrl();
  const path = networkConfigPath(url);
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

// ─── Convenience helpers ─────────────────────────────────────────

export function addAgentId(id: string, rpcUrl?: string): void {
  const config = loadNetworkConfig(rpcUrl);
  config.agent_ids = [id, ...config.agent_ids.filter((x) => x !== id)];
  saveNetworkConfig(config, rpcUrl);
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
      agent_ids: Array.isArray(parsed.agent_ids) ? parsed.agent_ids : [],
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
