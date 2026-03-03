/**
 * skills add / remove / list / check / update
 *
 * Pulls skill content from the Nara chain and installs it into local
 * AI-agent skill directories (same layout as nara-skills / agentskills.io).
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { searchMultiselect, cancelSymbol } from "../prompts/searchMultiselect";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { Connection } from "@solana/web3.js";
import { getSkillInfo, getSkillContent, getSkillRecord } from "nara-sdk";
import { getRpcUrl } from "../utils/wallet";
import { formatOutput } from "../utils/output";
import type { GlobalOptions } from "../types";

// ─── Agent registry ──────────────────────────────────────────────

const home = homedir();
const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config");
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
const codexHome = process.env.CODEX_HOME?.trim() || join(home, ".codex");

function openClawGlobalDir(): string {
  if (existsSync(join(home, ".openclaw"))) return join(home, ".openclaw/skills");
  if (existsSync(join(home, ".clawdbot"))) return join(home, ".clawdbot/skills");
  if (existsSync(join(home, ".moltbot")))  return join(home, ".moltbot/skills");
  return join(home, ".openclaw/skills");
}

interface AgentConfig {
  displayName: string;
  /** Relative path used for project-local installs */
  projectDir: string;
  /** Absolute path used for global installs */
  globalDir: string;
  detect: () => boolean;
  /** Set false to exclude from the locked Universal section even if projectDir is .agents/skills */
  showInUniversalList?: boolean;
}

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  // ── Universal agents (share .agents/skills) ───────────────────
  amp: {
    displayName: "Amp",
    projectDir: ".agents/skills",
    globalDir: join(xdgConfig, "agents/skills"),
    detect: () => existsSync(join(xdgConfig, "amp")),
  },
  cline: {
    displayName: "Cline",
    projectDir: ".agents/skills",
    globalDir: join(home, ".agents/skills"),
    detect: () => existsSync(join(home, ".cline")),
  },
  codex: {
    displayName: "Codex",
    projectDir: ".agents/skills",
    globalDir: join(codexHome, "skills"),
    detect: () => existsSync(codexHome) || existsSync("/etc/codex"),
  },
  cursor: {
    displayName: "Cursor",
    projectDir: ".agents/skills",
    globalDir: join(home, ".cursor/skills"),
    detect: () => existsSync(join(home, ".cursor")),
  },
  "gemini-cli": {
    displayName: "Gemini CLI",
    projectDir: ".agents/skills",
    globalDir: join(home, ".gemini/skills"),
    detect: () => existsSync(join(home, ".gemini")),
  },
  "github-copilot": {
    displayName: "GitHub Copilot",
    projectDir: ".agents/skills",
    globalDir: join(home, ".copilot/skills"),
    detect: () => existsSync(join(home, ".copilot")),
  },
  "kimi-cli": {
    displayName: "Kimi Code CLI",
    projectDir: ".agents/skills",
    globalDir: join(home, ".config/agents/skills"),
    detect: () => existsSync(join(home, ".kimi")),
  },
  opencode: {
    displayName: "OpenCode",
    projectDir: ".agents/skills",
    globalDir: join(xdgConfig, "opencode/skills"),
    detect: () => existsSync(join(xdgConfig, "opencode")),
  },
  replit: {
    displayName: "Replit",
    projectDir: ".agents/skills",
    globalDir: join(xdgConfig, "agents/skills"),
    detect: () => existsSync(join(process.cwd(), ".replit")),
    showInUniversalList: false,
  },

  // ── Additional agents (custom skill dirs) ─────────────────────
  adal: {
    displayName: "AdaL",
    projectDir: ".adal/skills",
    globalDir: join(home, ".adal/skills"),
    detect: () => existsSync(join(home, ".adal")),
  },
  antigravity: {
    displayName: "Antigravity",
    projectDir: ".agent/skills",
    globalDir: join(home, ".gemini/antigravity/skills"),
    detect: () => existsSync(join(home, ".gemini/antigravity")),
  },
  augment: {
    displayName: "Augment",
    projectDir: ".augment/skills",
    globalDir: join(home, ".augment/skills"),
    detect: () => existsSync(join(home, ".augment")),
  },
  "claude-code": {
    displayName: "Claude Code",
    projectDir: ".claude/skills",
    globalDir: join(claudeHome, "skills"),
    detect: () => existsSync(claudeHome),
  },
  codebuddy: {
    displayName: "CodeBuddy",
    projectDir: ".codebuddy/skills",
    globalDir: join(home, ".codebuddy/skills"),
    detect: () => existsSync(join(process.cwd(), ".codebuddy")) || existsSync(join(home, ".codebuddy")),
  },
  "command-code": {
    displayName: "Command Code",
    projectDir: ".commandcode/skills",
    globalDir: join(home, ".commandcode/skills"),
    detect: () => existsSync(join(home, ".commandcode")),
  },
  continue: {
    displayName: "Continue",
    projectDir: ".continue/skills",
    globalDir: join(home, ".continue/skills"),
    detect: () => existsSync(join(process.cwd(), ".continue")) || existsSync(join(home, ".continue")),
  },
  cortex: {
    displayName: "Cortex Code",
    projectDir: ".cortex/skills",
    globalDir: join(home, ".snowflake/cortex/skills"),
    detect: () => existsSync(join(home, ".snowflake/cortex")),
  },
  crush: {
    displayName: "Crush",
    projectDir: ".crush/skills",
    globalDir: join(home, ".config/crush/skills"),
    detect: () => existsSync(join(home, ".config/crush")),
  },
  droid: {
    displayName: "Droid",
    projectDir: ".factory/skills",
    globalDir: join(home, ".factory/skills"),
    detect: () => existsSync(join(home, ".factory")),
  },
  goose: {
    displayName: "Goose",
    projectDir: ".goose/skills",
    globalDir: join(xdgConfig, "goose/skills"),
    detect: () => existsSync(join(xdgConfig, "goose")),
  },
  "iflow-cli": {
    displayName: "iFlow CLI",
    projectDir: ".iflow/skills",
    globalDir: join(home, ".iflow/skills"),
    detect: () => existsSync(join(home, ".iflow")),
  },
  junie: {
    displayName: "Junie",
    projectDir: ".junie/skills",
    globalDir: join(home, ".junie/skills"),
    detect: () => existsSync(join(home, ".junie")),
  },
  kilo: {
    displayName: "Kilo Code",
    projectDir: ".kilocode/skills",
    globalDir: join(home, ".kilocode/skills"),
    detect: () => existsSync(join(home, ".kilocode")),
  },
  "kiro-cli": {
    displayName: "Kiro CLI",
    projectDir: ".kiro/skills",
    globalDir: join(home, ".kiro/skills"),
    detect: () => existsSync(join(home, ".kiro")),
  },
  kode: {
    displayName: "Kode",
    projectDir: ".kode/skills",
    globalDir: join(home, ".kode/skills"),
    detect: () => existsSync(join(home, ".kode")),
  },
  mcpjam: {
    displayName: "MCPJam",
    projectDir: ".mcpjam/skills",
    globalDir: join(home, ".mcpjam/skills"),
    detect: () => existsSync(join(home, ".mcpjam")),
  },
  "mistral-vibe": {
    displayName: "Mistral Vibe",
    projectDir: ".vibe/skills",
    globalDir: join(home, ".vibe/skills"),
    detect: () => existsSync(join(home, ".vibe")),
  },
  mux: {
    displayName: "Mux",
    projectDir: ".mux/skills",
    globalDir: join(home, ".mux/skills"),
    detect: () => existsSync(join(home, ".mux")),
  },
  neovate: {
    displayName: "Neovate",
    projectDir: ".neovate/skills",
    globalDir: join(home, ".neovate/skills"),
    detect: () => existsSync(join(home, ".neovate")),
  },
  openclaw: {
    displayName: "OpenClaw",
    projectDir: "skills",
    globalDir: openClawGlobalDir(),
    detect: () =>
      existsSync(join(home, ".openclaw")) ||
      existsSync(join(home, ".clawdbot")) ||
      existsSync(join(home, ".moltbot")),
  },
  openhands: {
    displayName: "OpenHands",
    projectDir: ".openhands/skills",
    globalDir: join(home, ".openhands/skills"),
    detect: () => existsSync(join(home, ".openhands")),
  },
  pi: {
    displayName: "Pi",
    projectDir: ".pi/skills",
    globalDir: join(home, ".pi/agent/skills"),
    detect: () => existsSync(join(home, ".pi/agent")),
  },
  pochi: {
    displayName: "Pochi",
    projectDir: ".pochi/skills",
    globalDir: join(home, ".pochi/skills"),
    detect: () => existsSync(join(home, ".pochi")),
  },
  qoder: {
    displayName: "Qoder",
    projectDir: ".qoder/skills",
    globalDir: join(home, ".qoder/skills"),
    detect: () => existsSync(join(home, ".qoder")),
  },
  "qwen-code": {
    displayName: "Qwen Code",
    projectDir: ".qwen/skills",
    globalDir: join(home, ".qwen/skills"),
    detect: () => existsSync(join(home, ".qwen")),
  },
  roo: {
    displayName: "Roo Code",
    projectDir: ".roo/skills",
    globalDir: join(home, ".roo/skills"),
    detect: () => existsSync(join(home, ".roo")),
  },
  trae: {
    displayName: "Trae",
    projectDir: ".trae/skills",
    globalDir: join(home, ".trae/skills"),
    detect: () => existsSync(join(home, ".trae")),
  },
  "trae-cn": {
    displayName: "Trae CN",
    projectDir: ".trae/skills",
    globalDir: join(home, ".trae-cn/skills"),
    detect: () => existsSync(join(home, ".trae-cn")),
  },
  windsurf: {
    displayName: "Windsurf",
    projectDir: ".windsurf/skills",
    globalDir: join(home, ".codeium/windsurf/skills"),
    detect: () => existsSync(join(home, ".codeium/windsurf")),
  },
  zencoder: {
    displayName: "Zencoder",
    projectDir: ".zencoder/skills",
    globalDir: join(home, ".zencoder/skills"),
    detect: () => existsSync(join(home, ".zencoder")),
  },
};

// ─── Lock file ───────────────────────────────────────────────────

interface SkillLockEntry {
  chainVersion: number;
  description: string | null;
  installedAt: string;
  updatedAt: string;
}

interface SkillLock {
  version: 1;
  skills: Record<string, SkillLockEntry>;
}

function getLockPath(global: boolean, cwd: string): string {
  return global
    ? join(xdgConfig, "nara/skills-lock.json")
    : join(cwd, ".nara/skills-lock.json");
}

async function readLock(global: boolean, cwd: string): Promise<SkillLock> {
  try {
    const raw = await readFile(getLockPath(global, cwd), "utf-8");
    return JSON.parse(raw) as SkillLock;
  } catch {
    return { version: 1, skills: {} };
  }
}

async function writeLock(lock: SkillLock, global: boolean, cwd: string): Promise<void> {
  const lockPath = getLockPath(global, cwd);
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
}

// ─── Agent helpers ───────────────────────────────────────────────

function detectAgents(): string[] {
  return Object.entries(AGENT_CONFIGS)
    .filter(([, cfg]) => cfg.detect())
    .map(([id]) => id);
}

function resolveInstallDirs(
  agentIds: string[],
  global: boolean,
  cwd: string
): Array<{ agentId: string; displayName: string; dir: string }> {
  return agentIds.map((id) => {
    const cfg = AGENT_CONFIGS[id];
    if (!cfg) {
      throw new Error(
        `Unknown agent: "${id}". Valid agents: ${Object.keys(AGENT_CONFIGS).join(", ")}`
      );
    }
    return {
      agentId: id,
      displayName: cfg.displayName,
      dir: global ? cfg.globalDir : join(cwd, cfg.projectDir),
    };
  });
}

// ─── File I/O helpers ────────────────────────────────────────────

async function writeSkillFiles(
  name: string,
  content: Buffer,
  targets: Array<{ dir: string }>
): Promise<string[]> {
  const written: string[] = [];
  for (const { dir } of targets) {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), content);
    written.push(join(skillDir, "SKILL.md"));
  }
  return written;
}

async function removeSkillFiles(
  name: string,
  targets: Array<{ dir: string }>
): Promise<void> {
  for (const { dir } of targets) {
    await rm(join(dir, name), { recursive: true, force: true });
  }
}

// ─── Command handlers ────────────────────────────────────────────

type InstallOptions = GlobalOptions & { global?: boolean; agent?: string[]; yes?: boolean };

// ─── Helpers (mirrors nara-skills/src/add.ts) ────────────────────

function shortenPath(fullPath: string, cwd: string): string {
  const h = homedir();
  if (fullPath === h || fullPath.startsWith(h + "/")) return "~" + fullPath.slice(h.length);
  if (fullPath === cwd || fullPath.startsWith(cwd + "/")) return "." + fullPath.slice(cwd.length);
  return fullPath;
}

// ─── handleSkillsAdd ─────────────────────────────────────────────

export async function handleSkillsAdd(name: string, options: InstallOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const cwd = process.cwd();
  const nonInteractive = options.json || options.yes || !process.stdin.isTTY;

  // ── Intro (matches nara-skills) ──────────────────────────────
  if (!options.json) {
    console.log();
    p.intro(pc.bgCyan(pc.black(" skills ")));
  }

  // ── 1. Fetch skill info from chain ───────────────────────────
  const fetchSpinner = p.spinner();
  fetchSpinner.start("Fetching skill info...");

  let info: Awaited<ReturnType<typeof getSkillInfo>>;
  let content: Buffer | null;
  try {
    [info, content] = await Promise.all([
      getSkillInfo(connection, name),
      getSkillContent(connection, name),
    ]);
  } catch (err: any) {
    fetchSpinner.stop(pc.red("Failed to fetch skill"));
    throw err;
  }

  if (!content) {
    fetchSpinner.stop(pc.red("No content on chain"));
    throw new Error(`Skill "${name}" has no content on chain. Upload content first with: skills upload`);
  }

  fetchSpinner.stop(`Skill: ${pc.cyan(name)}  v${info.record.version}`);
  if (!options.json) {
    p.log.message(pc.dim(info.description ?? "(no description)"));
  }

  // ── 2. Resolve agents ────────────────────────────────────────
  let agentIds: string[];

  if (options.agent?.length) {
    const invalid = options.agent.filter((a) => !AGENT_CONFIGS[a]);
    if (invalid.length) {
      throw new Error(`Unknown agent(s): ${invalid.join(", ")}. Valid: ${Object.keys(AGENT_CONFIGS).join(", ")}`);
    }
    agentIds = options.agent;
    p.log.info(`Installing to: ${agentIds.map((id) => pc.cyan(AGENT_CONFIGS[id]!.displayName)).join(", ")}`);
  } else if (nonInteractive) {
    const detected = detectAgents();
    if (detected.length === 0) {
      throw new Error("No supported agents detected. Use --agent to specify one (e.g. --agent claude-code)");
    }
    agentIds = detected;
    p.log.info(`Installing to: ${agentIds.map((id) => pc.cyan(AGENT_CONFIGS[id]!.displayName)).join(", ")}`);
  } else {
    const agentSpinner = p.spinner();
    agentSpinner.start("Loading agents...");
    const detected = detectAgents();
    agentSpinner.stop(`${Object.keys(AGENT_CONFIGS).length} agents`);

    // Universal agents share .agents/skills (and have showInUniversalList !== false)
    const universalIds = Object.entries(AGENT_CONFIGS)
      .filter(([, c]) => c.projectDir === ".agents/skills" && c.showInUniversalList !== false)
      .map(([id]) => id);
    const additionalIds = Object.keys(AGENT_CONFIGS).filter((id) => !universalIds.includes(id));

    const lockedSection = {
      title: "Universal (.agents/skills)",
      items: universalIds.map((id) => ({ value: id, label: AGENT_CONFIGS[id]!.displayName })),
    };

    const searchItems = additionalIds.map((id) => ({
      value: id,
      label: AGENT_CONFIGS[id]!.displayName,
      hint: AGENT_CONFIGS[id]!.projectDir,
    }));

    const result = await searchMultiselect({
      message: "Which agents do you want to install to?",
      items: searchItems,
      initialSelected: detected.filter((id) => additionalIds.includes(id)),
      required: false,
      lockedSection,
    });

    if (result === cancelSymbol) { p.cancel("Installation cancelled"); process.exit(0); }
    agentIds = result as string[];
  }

  // ── 3. Scope ─────────────────────────────────────────────────
  let installGlobally: boolean;

  if (options.global !== undefined) {
    installGlobally = options.global;
  } else if (!nonInteractive) {
    const scope = await p.select({
      message: "Installation scope",
      options: [
        { value: false, label: "Project", hint: "Install in current directory (committed with your project)" },
        { value: true,  label: "Global",  hint: "Install in home directory (available across all projects)" },
      ],
    });
    if (p.isCancel(scope)) { p.cancel("Installation cancelled"); process.exit(0); }
    installGlobally = scope as boolean;
  } else {
    installGlobally = false;
  }

  // ── 4. Summary + confirmation ────────────────────────────────
  const targets = resolveInstallDirs(agentIds, installGlobally, cwd);

  if (!nonInteractive) {
    const universalProjectDir = ".agents/skills";
    const universalIds = Object.entries(AGENT_CONFIGS)
      .filter(([, c]) => c.projectDir === universalProjectDir && c.showInUniversalList !== false)
      .map(([id]) => id);

    const universalTargets = targets.filter((t) => universalIds.includes(t.agentId));
    const additionalTargets = targets.filter((t) => !universalIds.includes(t.agentId));

    const summaryLines: string[] = [];

    if (universalTargets.length > 0) {
      const canonicalPath = join(universalTargets[0]!.dir, name);
      summaryLines.push(`${pc.cyan(shortenPath(canonicalPath, cwd))}`);
      summaryLines.push(
        `  ${pc.dim("──")} ${pc.bold("Universal (.agents/skills)")} ${pc.dim("── always included ────────────")}`
      );
      for (const t of universalTargets) {
        summaryLines.push(`    ${pc.green("•")} ${t.displayName}`);
      }
    }

    for (const t of additionalTargets) {
      if (summaryLines.length > 0) summaryLines.push("");
      const filePath = join(t.dir, name, "SKILL.md");
      summaryLines.push(`${pc.cyan(shortenPath(filePath, cwd))}`);
      summaryLines.push(`    ${pc.green("•")} ${t.displayName}`);
    }

    p.note(summaryLines.join("\n"), "Installation Summary");

    const confirmed = await p.confirm({ message: "Proceed with installation?" });
    if (p.isCancel(confirmed) || !confirmed) { p.cancel("Installation cancelled"); process.exit(0); }
  }

  // ── 5. Install ───────────────────────────────────────────────
  const installSpinner = p.spinner();
  if (!options.json) installSpinner.start("Installing...");

  const written = await writeSkillFiles(name, content, targets);

  const lock = await readLock(installGlobally, cwd);
  const now = new Date().toISOString();
  lock.skills[name] = {
    chainVersion: info.record.version,
    description: info.description,
    installedAt: lock.skills[name]?.installedAt ?? now,
    updatedAt: now,
  };
  await writeLock(lock, installGlobally, cwd);

  // ── 6. Result ────────────────────────────────────────────────
  if (options.json) {
    formatOutput({ name, chainVersion: info.record.version, agents: written }, true);
  } else {
    installSpinner.stop("Installation complete");
    const resultLines = written.map((p) => `${pc.green("✓")} ${shortenPath(p, cwd)}`);
    p.note(resultLines.join("\n"), pc.green(`Installed ${name}`));
    console.log();
    p.outro(pc.green("Done!") + pc.dim("  Review skills before use; they run with full agent permissions."));
  }
}

export async function handleSkillsRemove(name: string, options: InstallOptions) {
  const cwd = process.cwd();
  const isGlobal = options.global ?? false;
  const lock = await readLock(isGlobal, cwd);

  if (!lock.skills[name]) {
    throw new Error(`Skill "${name}" is not installed (not found in lock file)`);
  }

  const agentIds = options.agent?.length ? options.agent : Object.keys(AGENT_CONFIGS);
  const targets = resolveInstallDirs(agentIds, isGlobal, cwd);
  await removeSkillFiles(name, targets);

  delete lock.skills[name];
  await writeLock(lock, isGlobal, cwd);

  if (options.json) {
    formatOutput({ name, removed: true }, true);
  } else {
    console.log(pc.green(`Skill "${name}" removed`));
  }
}

export async function handleSkillsList(options: InstallOptions) {
  const cwd = process.cwd();
  const isGlobal = options.global ?? false;
  const lock = await readLock(isGlobal, cwd);
  const entries = Object.entries(lock.skills);

  if (options.json) {
    formatOutput(
      entries.map(([n, e]) => ({
        name: n,
        chainVersion: e.chainVersion,
        description: e.description,
        updatedAt: e.updatedAt,
      })),
      true
    );
    return;
  }

  const scope = isGlobal ? "Global" : "Project";
  if (entries.length === 0) {
    console.log(pc.dim(`No ${scope.toLowerCase()} skills installed via naracli.`));
    return;
  }

  console.log(`${pc.bold(scope + " Skills")}`);
  console.log();

  for (const [name] of entries) {
    // Collect all agents that have this skill installed; use the first matching
    // dir as the representative path (canonical), matching nara-skills display.
    const installedAgents: string[] = [];
    let canonicalPath = "";
    for (const [, cfg] of Object.entries(AGENT_CONFIGS)) {
      // Only include agents whose software is currently installed (mirrors nara-skills detectInstalledAgents)
      if (!cfg.detect()) continue;
      const dir = isGlobal ? cfg.globalDir : join(cwd, cfg.projectDir);
      if (existsSync(join(dir, name, "SKILL.md"))) {
        if (!canonicalPath) canonicalPath = shortenPath(join(dir, name), cwd);
        installedAgents.push(cfg.displayName);
      }
    }

    if (installedAgents.length === 0) {
      console.log(`${pc.cyan(name)}  ${pc.dim("(files not found on disk)")}`);
    } else {
      const agentInfo =
        installedAgents.length <= 5
          ? installedAgents.join(", ")
          : `${installedAgents.slice(0, 5).join(", ")} +${installedAgents.length - 5} more`;
      console.log(`${pc.cyan(name)} ${pc.dim(canonicalPath)}`);
      console.log(`  ${pc.dim("Agents:")} ${agentInfo}`);
    }
    console.log();
  }
}

export async function handleSkillsCheck(options: InstallOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const cwd = process.cwd();
  const isGlobal = options.global ?? false;
  const lock = await readLock(isGlobal, cwd);
  const entries = Object.entries(lock.skills);

  if (entries.length === 0) {
    if (options.json) {
      formatOutput([], true);
    } else {
      console.log(pc.dim("No skills installed."));
    }
    return;
  }

  const spinner = p.spinner();
  if (!options.json) spinner.start("Checking for updates...");

  const results = await Promise.all(
    entries.map(async ([n, local]) => {
      try {
        const record = await getSkillRecord(connection, n);
        return {
          name: n,
          localVersion: local.chainVersion,
          chainVersion: record.version,
          updateAvailable: record.version > local.chainVersion,
        };
      } catch {
        return { name: n, localVersion: local.chainVersion, chainVersion: null, updateAvailable: false };
      }
    })
  );

  if (!options.json) spinner.stop("Done");

  if (options.json) {
    formatOutput(results, true);
    return;
  }

  console.log("");
  const maxName = Math.max(...results.map((r) => r.name.length), 4);
  for (const r of results) {
    const padded = r.name.padEnd(maxName);
    if (r.chainVersion === null) {
      console.log(`  ${pc.cyan(padded)}  v${r.localVersion}  ${pc.dim("(chain error)")}`);
    } else if (r.updateAvailable) {
      console.log(
        `  ${pc.cyan(padded)}  v${r.localVersion} → v${r.chainVersion}  ${pc.yellow("(update available)")}`
      );
    } else {
      console.log(`  ${pc.cyan(padded)}  v${r.localVersion}  ${pc.dim("(up to date)")}`);
    }
  }
  console.log("");
}

export async function handleSkillsUpdate(names: string[], options: InstallOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const cwd = process.cwd();
  const isGlobal = options.global ?? false;
  const lock = await readLock(isGlobal, cwd);

  let toUpdate: string[];

  if (names.length > 0) {
    for (const n of names) {
      if (!lock.skills[n]) throw new Error(`Skill "${n}" is not installed`);
    }
    toUpdate = names;
  } else {
    const spinner = p.spinner();
    if (!options.json) spinner.start("Checking for updates...");
    const checks = await Promise.all(
      Object.keys(lock.skills).map(async (n) => {
        try {
          const record = await getSkillRecord(connection, n);
          return { name: n, hasUpdate: record.version > lock.skills[n]!.chainVersion };
        } catch {
          return { name: n, hasUpdate: false };
        }
      })
    );
    if (!options.json) spinner.stop("Done");
    toUpdate = checks.filter((c) => c.hasUpdate).map((c) => c.name);
  }

  if (toUpdate.length === 0) {
    if (options.json) {
      formatOutput({ updated: [] }, true);
    } else {
      console.log(pc.green("All skills are up to date."));
    }
    return;
  }

  const agentIds = options.agent?.length ? options.agent : Object.keys(AGENT_CONFIGS);
  const targets = resolveInstallDirs(agentIds, isGlobal, cwd);
  const updated: Array<{ name: string; chainVersion: number; agents: string[] }> = [];

  for (const n of toUpdate) {
    const spinner = p.spinner();
    if (!options.json) spinner.start(`Updating "${n}"...`);

    const [info, content] = await Promise.all([
      getSkillInfo(connection, n),
      getSkillContent(connection, n),
    ]);

    if (!content) {
      if (!options.json) spinner.stop(pc.yellow(`"${n}" has no content on chain — skipped`));
      continue;
    }

    const written = await writeSkillFiles(n, content, targets);
    const now = new Date().toISOString();
    lock.skills[n] = {
      chainVersion: info.record.version,
      description: info.description,
      installedAt: lock.skills[n]?.installedAt ?? now,
      updatedAt: now,
    };
    updated.push({ name: n, chainVersion: info.record.version, agents: written });

    if (!options.json) spinner.stop(pc.green(`"${n}" updated to v${info.record.version}`));
  }

  await writeLock(lock, isGlobal, cwd);

  if (options.json) {
    formatOutput({ updated }, true);
  } else if (updated.length > 0) {
    console.log(pc.green(`\nUpdated ${updated.length} skill(s)`));
  }
}
