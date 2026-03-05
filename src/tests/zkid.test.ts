/**
 * Tests for `zkid` CLI commands
 *
 * - Help / validation tests run without wallet or chain
 * - On-chain tests (create, deposit, etc.) require PRIVATE_KEY in .env
 *
 * Run: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, hasWallet, uniqueName } from "./helpers.js";

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

// ─── Deposit validation (no chain needed) ─────────────────────────

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

// ─── Transfer validation (no chain needed) ────────────────────────

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

// ─── Withdraw validation (no chain needed) ────────────────────────

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

// ─── id-commitment (requires wallet, no chain) ───────────────────

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

// ─── On-chain tests (requires wallet + NARA balance) ─────────────

describe("zkid on-chain", () => {
  const ZKID_NAME = uniqueName("test-zkid");

  it("id-commitment is deterministic", async () => {
    if (!hasWallet) return;
    console.log(`\nUsing ZK ID name: ${ZKID_NAME}`);
    const r1 = await runCli(["zkid", "id-commitment", "--json", ZKID_NAME]);
    const r2 = await runCli(["zkid", "id-commitment", "--json", ZKID_NAME]);
    assert.equal(r1.exitCode, 0, `stderr: ${r1.stderr}`);
    assert.equal(r2.exitCode, 0);
    const c1 = JSON.parse(r1.stdout);
    const c2 = JSON.parse(r2.stdout);
    assert.match(c1.idCommitment, /^[0-9a-f]{64}$/);
    assert.equal(c1.idCommitment, c2.idCommitment, "commitment not deterministic");
  });

  it("create registers a new ZK ID on-chain", async () => {
    if (!hasWallet) return;
    const { stdout, stderr, exitCode } = await runCli([
      "zkid", "create", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("registered") || stdout.includes("Transaction"), `stdout: ${stdout}`);
  });

  it("create again exits 0 with warning (already exists)", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode } = await runCli(["zkid", "create", ZKID_NAME]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("already exists"), `stdout: ${stdout}`);
  });

  it("info returns correct fields for existing ZK ID", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode, stderr } = await runCli([
      "zkid", "info", "--json", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.equal(json.name, ZKID_NAME);
    assert.equal(json.depositCount, 0);
    assert.equal(json.commitmentStartIndex, 0);
    assert.match(json.idCommitment, /^[0-9a-f]{64}$/);
  });

  it("id-commitment matches the commitment stored on-chain", async () => {
    if (!hasWallet) return;
    const commitResult = await runCli(["zkid", "id-commitment", "--json", ZKID_NAME]);
    const infoResult = await runCli(["zkid", "info", "--json", ZKID_NAME]);
    assert.equal(commitResult.exitCode, 0);
    assert.equal(infoResult.exitCode, 0);
    const localCommitment = JSON.parse(commitResult.stdout).idCommitment;
    const chainCommitment = JSON.parse(infoResult.stdout).idCommitment;
    assert.equal(localCommitment, chainCommitment, "local commitment != on-chain commitment");
  });

  it("deposit 1 NARA into the ZK ID", async () => {
    if (!hasWallet) return;
    const { stdout, stderr, exitCode } = await runCli([
      "zkid", "deposit", ZKID_NAME, "1",
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("Transaction"), `stdout: ${stdout}`);
  });

  it("info shows depositCount=1 after deposit", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode } = await runCli(["zkid", "info", "--json", ZKID_NAME]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.equal(json.depositCount, 1);
  });

  it("scan finds 1 claimable deposit", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode, stderr } = await runCli([
      "zkid", "scan", "--json", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.equal(json.count, 1);
    assert.equal(json.deposits[0].nara, 1);
  });

  it("withdraw sends funds to auto-generated recipient", async () => {
    if (!hasWallet) return;
    const { stdout, stderr, exitCode } = await runCli([
      "zkid", "withdraw", "--json", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.ok(json.recipient, "no recipient in output");
    assert.ok(json.signature, "no signature in output");
    assert.equal(json.nara, 1);
  });

  it("scan shows 0 claimable deposits after withdrawal", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode } = await runCli([
      "zkid", "scan", "--json", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.equal(json.count, 0, `expected 0, got ${json.count}`);
  });
});
