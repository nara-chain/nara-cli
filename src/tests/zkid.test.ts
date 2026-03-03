/**
 * Tests for `zkid` CLI commands
 *
 * Run: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, hasWallet } from "./helpers.js";

// ─── Help output ──────────────────────────────────────────────────

describe("zkid --help", () => {
  it("shows all subcommands", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "--help"]);
    assert.equal(exitCode, 0);
    for (const cmd of ["create", "info", "deposit", "scan", "withdraw", "id-commitment", "transfer"]) {
      assert.ok(stdout.includes(cmd), `missing subcommand: ${cmd}`);
    }
  });

  it("zkid deposit --help lists all valid denominations", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "deposit", "--help"]);
    assert.equal(exitCode, 0);
    for (const amt of ["1", "10", "100", "1000", "10000", "100000"]) {
      assert.ok(stdout.includes(amt), `missing denomination: ${amt}`);
    }
  });

  it("zkid withdraw --help shows --recipient option", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "withdraw", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("--recipient"));
  });

  it("zkid transfer --help shows <new-id-commitment>", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "transfer", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<new-id-commitment>"));
  });
});

// ─── deposit validation (no chain needed) ────────────────────────

describe("zkid deposit denomination validation", () => {
  for (const bad of ["0", "2", "5", "50", "500", "9999", "200000"]) {
    it(`rejects invalid amount "${bad}"`, async () => {
      if (!hasWallet) return;
      const { stderr, exitCode } = await runCli(["zkid", "deposit", "alice", bad]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes("Valid denominations"), `stderr: ${stderr}`);
    });
  }

  it("help text contains all valid denominations", async () => {
    const { stdout } = await runCli(["zkid", "deposit", "--help"]);
    for (const amt of ["1", "10", "100", "1000", "10000", "100000"]) {
      assert.ok(stdout.includes(amt));
    }
  });
});

// ─── transfer validation (no chain needed) ───────────────────────

describe("zkid transfer commitment validation", () => {
  it("rejects commitment shorter than 64 chars", async () => {
    if (!hasWallet) return;
    const { stderr, exitCode } = await runCli(["zkid", "transfer", "alice", "deadbeef"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Invalid id-commitment"), `stderr: ${stderr}`);
  });

  it("rejects commitment with non-hex characters", async () => {
    if (!hasWallet) return;
    const { stderr, exitCode } = await runCli(["zkid", "transfer", "alice", "z".repeat(64)]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Invalid id-commitment"), `stderr: ${stderr}`);
  });

  it("rejects commitment that is 63 chars (one short)", async () => {
    if (!hasWallet) return;
    const { stderr, exitCode } = await runCli(["zkid", "transfer", "alice", "a".repeat(63)]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Invalid id-commitment"), `stderr: ${stderr}`);
  });
});

// ─── withdraw validation (no chain needed) ───────────────────────

describe("zkid withdraw validation", () => {
  it("rejects --recipient that is not a valid public key", async () => {
    if (!hasWallet) return;
    const { stderr, exitCode } = await runCli(["zkid", "withdraw", "alice", "--recipient", "bad-key"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Invalid recipient address"), `stderr: ${stderr}`);
  });
});

// ─── Read-only chain queries ──────────────────────────────────────

describe("zkid info (read-only)", () => {
  it("--json returns { exists: false } for non-existent ZK ID", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "info", "--json", "definitely-does-not-exist-xyz999"]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.equal(json.exists, false);
  });

  it("text output mentions 'does not exist' for non-existent ZK ID", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "info", "definitely-does-not-exist-xyz999"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("does not exist"), `stdout: ${stdout}`);
  });
});

// ─── id-commitment (requires wallet) ─────────────────────────────

describe("zkid id-commitment", () => {
  it("outputs a 64-char hex commitment", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode } = await runCli(["zkid", "id-commitment", "test-name"]);
    assert.equal(exitCode, 0);
    const match = stdout.match(/ID commitment:\s+([0-9a-f]{64})/);
    assert.ok(match, `no commitment in output: ${stdout}`);
  });

  it("--json output contains idCommitment as 64-char hex", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode } = await runCli(["zkid", "id-commitment", "--json", "test-name"]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.ok("idCommitment" in json);
    assert.match(json.idCommitment, /^[0-9a-f]{64}$/);
  });

  it("same wallet+name yields the same commitment (deterministic)", async () => {
    if (!hasWallet) return;
    const r1 = await runCli(["zkid", "id-commitment", "--json", "my-id"]);
    const r2 = await runCli(["zkid", "id-commitment", "--json", "my-id"]);
    assert.equal(r1.exitCode, 0);
    assert.equal(r2.exitCode, 0);
    assert.equal(JSON.parse(r1.stdout).idCommitment, JSON.parse(r2.stdout).idCommitment);
  });

  it("different names yield different commitments", async () => {
    if (!hasWallet) return;
    const r1 = await runCli(["zkid", "id-commitment", "--json", "name-aaa"]);
    const r2 = await runCli(["zkid", "id-commitment", "--json", "name-bbb"]);
    assert.equal(r1.exitCode, 0);
    assert.equal(r2.exitCode, 0);
    assert.notEqual(JSON.parse(r1.stdout).idCommitment, JSON.parse(r2.stdout).idCommitment);
  });
});
