/**
 * Test helpers - run the CLI as a subprocess and capture output
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../../bin/nara-cli.ts");

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
      env: { ...process.env, ...extraEnv },
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
export const hasWallet = !!process.env.PRIVATE_KEY;

/** Generate a unique test resource name using a timestamp */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}
