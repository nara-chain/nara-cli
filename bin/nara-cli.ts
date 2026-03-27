/**
 * Nara CLI - Command-line interface for the Nara chain
 */

import { Command } from "commander";
import { registerCommands } from "../src/cli/index";
import { migrateAgentIdFormat } from "../src/cli/utils/agent-config";
// __CLI_VERSION__ is injected by the build script via esbuild --define.
// In dev mode (tsx), fall back to "dev".
declare const __CLI_VERSION__: string;
const version = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "dev";

// Create program
const program = new Command();

// Set program metadata
program
  .name("naracli")
  .description("CLI for the Nara chain. Native coin is NARA (not SOL). Mine NARA for free via PoMI quests, manage wallets, register agents, and more. Run 'naracli <command> --help' for details on any command.")
  .version(version);

// Add global options
program
  .option("-r, --rpc-url <url>", "RPC endpoint (default: https://mainnet-api.nara.build/)")
  .option("-w, --wallet <path>", "Path to wallet keypair JSON file (default: ~/.config/nara/id.json)")
  .option("-j, --json", "Output in JSON format");

// Register all command modules
registerCommands(program);

// Show help if no command provided, then exit cleanly
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// Migrate legacy agent_id format, then parse
migrateAgentIdFormat().catch(() => {}).then(() => program.parse(process.argv));
