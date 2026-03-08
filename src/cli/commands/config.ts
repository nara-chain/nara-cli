/**
 * Config commands - manage CLI configuration
 */

import { Command } from "commander";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  loadNetworkConfig,
  rpcUrlToNetworkName,
} from "../utils/agent-config";
import { getRpcUrl } from "../utils/wallet";
import { printError, printSuccess, formatOutput } from "../utils/output";
import { DEFAULT_RPC_URL } from "nara-sdk";
import type { GlobalOptions } from "../types";

function handleConfigGet(options: GlobalOptions) {
  const globalConfig = loadGlobalConfig();
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const networkConfig = loadNetworkConfig(rpcUrl);
  const networkName = rpcUrlToNetworkName(rpcUrl);

  const data = {
    rpc_url: globalConfig.rpc_url ?? DEFAULT_RPC_URL,
    wallet: globalConfig.wallet ?? "~/.config/nara/id.json",
    rpc_url_custom: !!globalConfig.rpc_url,
    wallet_custom: !!globalConfig.wallet,
    network: networkName,
    agent_ids: networkConfig.agent_ids,
    zk_ids: networkConfig.zk_ids,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  RPC URL:  ${data.rpc_url}${data.rpc_url_custom ? "" : " (default)"}`);
    console.log(`  Wallet:   ${data.wallet}${data.wallet_custom ? "" : " (default)"}`);
    console.log(`  Network:  ${networkName}`);
    if (networkConfig.agent_ids.length > 0)
      console.log(`  Agents:   ${networkConfig.agent_ids.join(", ")}`);
    if (networkConfig.zk_ids.length > 0)
      console.log(`  ZK IDs:   ${networkConfig.zk_ids.join(", ")}`);
    console.log("");
  }
}

function handleConfigSet(key: string, value: string, options: GlobalOptions) {
  const config = loadGlobalConfig();

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

  saveGlobalConfig(config);
  if (!options.json) printSuccess(`Config "${key}" set to "${value}"`);
  if (options.json) formatOutput({ key, value }, true);
}

function handleConfigReset(key: string | undefined, options: GlobalOptions) {
  const config = loadGlobalConfig();

  if (!key) {
    delete config.rpc_url;
    delete config.wallet;
    saveGlobalConfig(config);
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
    saveGlobalConfig(config);
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
