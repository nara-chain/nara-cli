/**
 * Agent config utilities - read/write ~/.config/nara/agent.json
 */

import { join } from "node:path";
import { homedir } from "node:os";

const AGENT_CONFIG_PATH = join(homedir(), ".config", "nara", "agent.json");

export interface AgentConfig {
  agent_ids: string[];
  zk_ids: string[];
}

const DEFAULT_CONFIG: AgentConfig = { agent_ids: [], zk_ids: [] };

export async function loadAgentConfig(): Promise<AgentConfig> {
  const fs = await import("node:fs/promises");
  try {
    const raw = await fs.readFile(AGENT_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      agent_ids: Array.isArray(parsed.agent_ids) ? parsed.agent_ids : [],
      zk_ids: Array.isArray(parsed.zk_ids) ? parsed.zk_ids : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  const fs = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await fs.mkdir(dirname(AGENT_CONFIG_PATH), { recursive: true });
  await fs.writeFile(AGENT_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export async function addAgentId(id: string): Promise<void> {
  const config = await loadAgentConfig();
  config.agent_ids = [id, ...config.agent_ids.filter((x) => x !== id)];
  await saveAgentConfig(config);
}

export async function addZkId(name: string): Promise<void> {
  const config = await loadAgentConfig();
  config.zk_ids = [name, ...config.zk_ids.filter((x) => x !== name)];
  await saveAgentConfig(config);
}
