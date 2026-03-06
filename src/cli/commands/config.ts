/**
 * Config commands - manage CLI configuration
 */

import { Command } from "commander";
import { loadAgentConfig, saveAgentConfig } from "../utils/agent-config";
import { printError, printSuccess, formatOutput } from "../utils/output";
import { DEFAULT_RPC_URL } from "nara-sdk";
import type { GlobalOptions } from "../types";

function handleConfigGet(options: GlobalOptions) {
  const config = loadAgentConfig();
  const data = {
    rpc_url: config.rpc_url ?? DEFAULT_RPC_URL,
    wallet: config.wallet ?? "~/.config/nara/id.json",
    rpc_url_custom: !!config.rpc_url,
    wallet_custom: !!config.wallet,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  RPC URL: ${data.rpc_url}${data.rpc_url_custom ? "" : " (default)"}`);
    console.log(`  Wallet:  ${data.wallet}${data.wallet_custom ? "" : " (default)"}`);
    console.log("");
  }
}

function handleConfigSet(key: string, value: string, options: GlobalOptions) {
  const config = loadAgentConfig();

  switch (key) {
    case "rpc-url":
      config.rpc_url = value;
      break;
    case "wallet":
      config.wallet = value;
      break;
    default:
      throw new Error(`Unknown config key: "${key}". Valid keys: rpc-url, wallet`);
  }

  saveAgentConfig(config);
  if (!options.json) printSuccess(`Config "${key}" set to "${value}"`);
  if (options.json) formatOutput({ key, value }, true);
}

function handleConfigReset(key: string | undefined, options: GlobalOptions) {
  const config = loadAgentConfig();

  if (!key) {
    delete config.rpc_url;
    delete config.wallet;
    saveAgentConfig(config);
    if (!options.json) printSuccess("All config reset to defaults");
  } else {
    switch (key) {
      case "rpc-url":
        delete config.rpc_url;
        break;
      case "wallet":
        delete config.wallet;
        break;
      default:
        throw new Error(`Unknown config key: "${key}". Valid keys: rpc-url, wallet`);
    }
    saveAgentConfig(config);
    if (!options.json) printSuccess(`Config "${key}" reset to default`);
  }

  if (options.json) formatOutput({ key: key ?? "all", reset: true }, true);
}

export function registerConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("Manage CLI configuration (rpc-url, wallet)");

  config
    .command("get")
    .description("Show current configuration")
    .action((_opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        handleConfigGet(globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  config
    .command("set <key> <value>")
    .description("Set a config value (keys: rpc-url, wallet)")
    .action((key: string, value: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        handleConfigSet(key, value, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  config
    .command("reset [key]")
    .description("Reset config to default (keys: rpc-url, wallet, or omit for all)")
    .action((key: string | undefined, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        handleConfigReset(key, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
