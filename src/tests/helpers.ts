/**
 * Test helpers - run the CLI as a subprocess and capture output
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../../bin/nara-cli.ts");
const ROOT = join(__dirname, "../../");
const ENV_FILE = join(ROOT, ".env");

/** Parse .env file into an object (simple key=value, skips comments) */
function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key) env[key] = val;
  }
  return env;
}

const ENV = loadEnvFile(ENV_FILE);

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI with given args, stream stdout/stderr to parent in real-time
 * while also capturing them for assertions.
 */
export function runCli(args: string[], extraEnv: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", CLI, ...args], {
      env: { ...process.env, ...ENV, ...extraEnv },
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/** Whether a wallet is configured (for write-command tests) */
export const hasWallet = !!(ENV.PRIVATE_KEY || process.env.PRIVATE_KEY);

/** Generate a unique test resource name using a timestamp */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}
