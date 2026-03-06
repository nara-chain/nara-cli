/**
 * Agent config utilities - read/write ~/.config/nara/agent.json
 */

import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const AGENT_CONFIG_PATH = join(homedir(), ".config", "nara", "agent.json");

export interface AgentConfig {
  agent_ids: string[];
  zk_ids: string[];
  rpc_url?: string;
  wallet?: string;
}

const DEFAULT_CONFIG: AgentConfig = { agent_ids: [], zk_ids: [] };

export function loadAgentConfig(): AgentConfig {
  try {
    const raw = readFileSync(AGENT_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      agent_ids: Array.isArray(parsed.agent_ids) ? parsed.agent_ids : [],
      zk_ids: Array.isArray(parsed.zk_ids) ? parsed.zk_ids : [],
      rpc_url: parsed.rpc_url ?? undefined,
      wallet: parsed.wallet ?? undefined,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveAgentConfig(config: AgentConfig): void {
  mkdirSync(dirname(AGENT_CONFIG_PATH), { recursive: true });
  writeFileSync(AGENT_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function addAgentId(id: string): void {
  const config = loadAgentConfig();
  config.agent_ids = [id, ...config.agent_ids.filter((x) => x !== id)];
  saveAgentConfig(config);
}

export function addZkId(name: string): void {
  const config = loadAgentConfig();
  config.zk_ids = [name, ...config.zk_ids.filter((x) => x !== name)];
  saveAgentConfig(config);
}
