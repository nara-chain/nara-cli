/**
 * Nara CLI - Command-line interface for the Nara chain
 */

import { Command } from "commander";
import { registerCommands } from "../src/cli/index";
// __CLI_VERSION__ is injected by the build script via esbuild --define.
// In dev mode (tsx), fall back to "dev".
declare const __CLI_VERSION__: string;
const version = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "dev";

// Create program
const program = new Command();

// Set program metadata
program
  .name("naracli")
  .description("CLI for the Nara chain (Solana-compatible)")
  .version(version);

// Add global options
program
  .option("-r, --rpc-url <url>", "RPC endpoint URL")
  .option("-w, --wallet <path>", "Path to wallet keypair JSON file")
  .option("-j, --json", "Output in JSON format");

// Register all command modules
registerCommands(program);

// Show help if no command provided, then exit cleanly
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// Parse arguments and execute
program.parse(process.argv);
