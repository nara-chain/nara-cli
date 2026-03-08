/**
 * Tests for `agent` CLI commands
 *
 * - Help / validation tests run without wallet or chain
 * - On-chain tests require wallet + NARA balance
 *
 * Run: npm run test:agent-cli
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, hasWallet } from "./helpers.js";

// ─── Help output ──────────────────────────────────────────────────

describe("agent --help", () => {
  it("shows all subcommands", async () => {
    const { stdout, exitCode } = await runCli(["agent", "--help"]);
    assert.equal(exitCode, 0);
    for (const cmd of [
      "register", "get", "set-bio", "set-metadata",
      "upload-memory", "memory", "transfer", "close-buffer",
      "delete", "set-referral", "log",
    ]) {
      assert.ok(stdout.includes(cmd), `missing subcommand: ${cmd}`);
    }
  });

  it("agent register --help shows --referral option", async () => {
    const { stdout, exitCode } = await runCli(["agent", "register", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("--referral"));
    assert.ok(stdout.includes("<agent-id>"));
  });

  it("agent set-referral --help shows both args", async () => {
    const { stdout, exitCode } = await runCli(["agent", "set-referral", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<agent-id>"));
    assert.ok(stdout.includes("<referral-agent-id>"));
  });

  it("agent log --help shows --model and --referral", async () => {
    const { stdout, exitCode } = await runCli(["agent", "log", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("--model"));
    assert.ok(stdout.includes("--referral"));
    assert.ok(stdout.includes("<agent-id>"));
    assert.ok(stdout.includes("<activity>"));
    assert.ok(stdout.includes("<log>"));
  });

  it("agent get --help shows <agent-id>", async () => {
    const { stdout, exitCode } = await runCli(["agent", "get", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<agent-id>"));
  });

  it("agent set-bio --help shows <bio>", async () => {
    const { stdout, exitCode } = await runCli(["agent", "set-bio", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<bio>"));
  });

  it("agent set-metadata --help shows <json>", async () => {
    const { stdout, exitCode } = await runCli(["agent", "set-metadata", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<json>"));
  });

  it("agent upload-memory --help shows <file>", async () => {
    const { stdout, exitCode } = await runCli(["agent", "upload-memory", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<file>"));
  });

  it("agent transfer --help shows <new-authority>", async () => {
    const { stdout, exitCode } = await runCli(["agent", "transfer", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<new-authority>"));
  });

  it("agent delete --help shows <agent-id>", async () => {
    const { stdout, exitCode } = await runCli(["agent", "delete", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<agent-id>"));
  });
});

// ─── Argument validation (no chain needed) ────────────────────────

describe("agent argument errors", () => {
  it("agent get with no args exits non-zero", async () => {
    const { exitCode } = await runCli(["agent", "get"]);
    assert.notEqual(exitCode, 0);
  });

  it("agent register with no args exits non-zero", async () => {
    const { exitCode } = await runCli(["agent", "register"]);
    assert.notEqual(exitCode, 0);
  });

  it("agent set-referral with no args exits non-zero", async () => {
    const { exitCode } = await runCli(["agent", "set-referral"]);
    assert.notEqual(exitCode, 0);
  });

  it("agent set-referral with only one arg exits non-zero", async () => {
    const { exitCode } = await runCli(["agent", "set-referral", "my-agent"]);
    assert.notEqual(exitCode, 0);
  });

  it("agent log with missing args exits non-zero", async () => {
    const { exitCode } = await runCli(["agent", "log"]);
    assert.notEqual(exitCode, 0);
  });

  it("agent log with only one arg exits non-zero", async () => {
    const { exitCode } = await runCli(["agent", "log", "my-agent"]);
    assert.notEqual(exitCode, 0);
  });
});

// ─── Name validation (lowercase) ─────────────────────────────────

describe("agent name validation", () => {
  it("rejects uppercase agent ID", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["agent", "register", "MyAgent"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("lowercase"), `stderr: ${stderr}`);
  });

  it("rejects agent ID starting with number", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["agent", "register", "123agent"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("lowercase"), `stderr: ${stderr}`);
  });

  it("rejects agent ID starting with hyphen", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["agent", "register", "-my-agent"]);
    // Commander may interpret -m as a flag, so check for either parse error or validation error
    assert.notEqual(exitCode, 0);
  });

  it("rejects agent ID with special characters", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["agent", "register", "my_agent"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("lowercase"), `stderr: ${stderr}`);
  });

  it("rejects agent ID with spaces", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["agent", "register", "my agent"]);
    // Commander may treat "agent" as a separate arg
    assert.notEqual(exitCode, 0);
  });
});

// ─── Read-only chain queries ──────────────────────────────────────

describe("agent get (read-only)", () => {
  it("returns error for non-existent agent", async () => {
    const { exitCode, stderr } = await runCli(["agent", "get", "definitely-does-not-exist-xyz999"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.length > 0);
  });
});

// ─── Metadata validation ─────────────────────────────────────────

describe("agent set-metadata validation", () => {
  it("rejects invalid JSON", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["agent", "set-metadata", "any-agent", "not-valid-json"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Invalid JSON"), `stderr: ${stderr}`);
  });
});

// ─── Upload validation ───────────────────────────────────────────

describe("agent upload-memory validation", () => {
  it("rejects non-existent file", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["agent", "upload-memory", "any-agent", "/tmp/__no_such_file__.bin"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Failed to read file"), `stderr: ${stderr}`);
  });
});
