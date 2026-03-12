/**
 * Tests for `config` CLI commands and agent-config utilities
 *
 * - Config get/set/reset via CLI
 * - rpcUrlToNetworkName conversion
 * - Global and network config load/save
 *
 * Run: npm run test:config
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { runCli } from "./helpers.js";
import { rpcUrlToNetworkName } from "../cli/utils/agent-config.js";

const CONFIG_DIR = join(homedir(), ".config", "nara");
const GLOBAL_CONFIG_PATH = join(CONFIG_DIR, "config.json");

// Backup and restore global config around tests
let originalConfig: string | null = null;

before(() => {
  try {
    originalConfig = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
  } catch {
    originalConfig = null;
  }
});

after(() => {
  if (originalConfig !== null) {
    writeFileSync(GLOBAL_CONFIG_PATH, originalConfig);
  } else if (existsSync(GLOBAL_CONFIG_PATH)) {
    // Restore to no config (delete if it didn't exist before)
    unlinkSync(GLOBAL_CONFIG_PATH);
  }
});

// ─── rpcUrlToNetworkName ──────────────────────────────────────────

describe("rpcUrlToNetworkName", () => {
  it("converts mainnet URL", () => {
    assert.equal(rpcUrlToNetworkName("https://mainnet-api.nara.build/"), "mainnet-api-nara-build");
  });

  it("converts devnet URL", () => {
    assert.equal(rpcUrlToNetworkName("https://devnet-api.nara.build/"), "devnet-api-nara-build");
  });

  it("converts localhost URL", () => {
    assert.equal(rpcUrlToNetworkName("http://127.0.0.1:8899/"), "127-0-0-1-8899");
  });

  it("handles URL without trailing slash", () => {
    assert.equal(rpcUrlToNetworkName("https://mainnet-api.nara.build"), "mainnet-api-nara-build");
  });

  it("handles URL with multiple slashes", () => {
    const result = rpcUrlToNetworkName("https://example.com///");
    assert.ok(!result.includes("/"));
    assert.ok(!result.startsWith("-"));
    assert.ok(!result.endsWith("-"));
  });

  it("replaces dots and special chars with hyphens", () => {
    assert.equal(rpcUrlToNetworkName("https://my.custom.rpc:9090/"), "my-custom-rpc-9090");
  });

  it("collapses multiple hyphens", () => {
    const result = rpcUrlToNetworkName("http://a...b///c/");
    assert.ok(!result.includes("--"));
  });
});

// ─── config get ───────────────────────────────────────────────────

describe("config get", () => {
  it("shows current config in text mode", async () => {
    const { stdout, exitCode } = await runCli(["config", "get"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("RPC URL:"));
    assert.ok(stdout.includes("Wallet:"));
    assert.ok(stdout.includes("Network:"));
  });

  it("--json returns structured config", async () => {
    const { stdout, exitCode } = await runCli(["config", "get", "--json"]);
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    assert.ok(typeof data.rpc_url === "string");
    assert.ok(typeof data.wallet === "string");
    assert.ok(typeof data.network === "string");
    assert.ok(data.agent_id === null || typeof data.agent_id === "string");
    assert.ok(Array.isArray(data.zk_ids));
  });
});

// ─── config set ───────────────────────────────────────────────────

describe("config set", () => {
  it("sets rpc-url", async () => {
    const testUrl = "https://test-rpc.example.com/";
    const { exitCode, stdout } = await runCli(["config", "set", "rpc-url", testUrl]);
    assert.equal(exitCode, 0);

    // Verify it was saved
    const { stdout: getOut } = await runCli(["config", "get", "--json"]);
    const data = JSON.parse(getOut);
    assert.equal(data.rpc_url, testUrl);
    assert.equal(data.rpc_url_custom, true);
  });

  it("sets wallet path", async () => {
    const testPath = "/tmp/test-wallet.json";
    const { exitCode } = await runCli(["config", "set", "wallet", testPath]);
    assert.equal(exitCode, 0);

    const { stdout } = await runCli(["config", "get", "--json"]);
    const data = JSON.parse(stdout);
    assert.equal(data.wallet, testPath);
    assert.equal(data.wallet_custom, true);
  });

  it("rejects unknown config key", async () => {
    const { exitCode, stderr } = await runCli(["config", "set", "unknown-key", "value"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown config key"));
  });

  it("--json returns set confirmation", async () => {
    const { stdout, exitCode } = await runCli(["config", "set", "rpc-url", "https://example.com/", "--json"]);
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.key, "rpc-url");
    assert.equal(data.value, "https://example.com/");
  });
});

// ─── config reset ─────────────────────────────────────────────────

describe("config reset", () => {
  before(async () => {
    // Set both values first
    await runCli(["config", "set", "rpc-url", "https://test.example.com/"]);
    await runCli(["config", "set", "wallet", "/tmp/test.json"]);
  });

  it("resets a single key", async () => {
    const { exitCode } = await runCli(["config", "reset", "rpc-url"]);
    assert.equal(exitCode, 0);

    const { stdout } = await runCli(["config", "get", "--json"]);
    const data = JSON.parse(stdout);
    assert.equal(data.rpc_url_custom, false);
    // wallet should still be custom
    assert.equal(data.wallet_custom, true);
  });

  it("resets all keys", async () => {
    // Set again to ensure both are custom
    await runCli(["config", "set", "rpc-url", "https://test.example.com/"]);
    const { exitCode } = await runCli(["config", "reset"]);
    assert.equal(exitCode, 0);

    const { stdout } = await runCli(["config", "get", "--json"]);
    const data = JSON.parse(stdout);
    assert.equal(data.rpc_url_custom, false);
    assert.equal(data.wallet_custom, false);
  });

  it("rejects unknown reset key", async () => {
    const { exitCode, stderr } = await runCli(["config", "reset", "bad-key"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown config key"));
  });

  it("--json returns reset confirmation", async () => {
    const { stdout, exitCode } = await runCli(["config", "reset", "rpc-url", "--json"]);
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.key, "rpc-url");
    assert.equal(data.reset, true);
  });
});

// ─── config --help ────────────────────────────────────────────────

describe("config --help", () => {
  it("shows subcommands", async () => {
    const { stdout, exitCode } = await runCli(["config", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("get"));
    assert.ok(stdout.includes("set"));
    assert.ok(stdout.includes("reset"));
  });
});
