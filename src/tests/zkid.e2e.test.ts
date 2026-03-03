/**
 * End-to-end tests for `zkid` commands (hits real testnet)
 *
 * Requires PRIVATE_KEY in .env and sufficient NARA balance.
 * Run: npm run test:e2e
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, hasWallet, uniqueName } from "./helpers.js";

if (!hasWallet) {
  console.log("Skipping zkid e2e tests: PRIVATE_KEY not set");
  process.exit(0);
}

// ─── Shared state ─────────────────────────────────────────────────

const ZKID_NAME = uniqueName("e2e-zkid");
console.log(`\nUsing ZK ID name: ${ZKID_NAME}`);

// ─── Tests ────────────────────────────────────────────────────────

describe(`zkid e2e (name=${ZKID_NAME})`, () => {
  // ── id-commitment (pure crypto, no chain) ──────────────────────

  it("id-commitment outputs a deterministic 64-char hex", async () => {
    const r1 = await runCli(["zkid", "id-commitment", "--json", ZKID_NAME]);
    const r2 = await runCli(["zkid", "id-commitment", "--json", ZKID_NAME]);
    assert.equal(r1.exitCode, 0, `stderr: ${r1.stderr}`);
    assert.equal(r2.exitCode, 0);
    const c1 = JSON.parse(r1.stdout);
    const c2 = JSON.parse(r2.stdout);
    assert.match(c1.idCommitment, /^[0-9a-f]{64}$/);
    assert.equal(c1.idCommitment, c2.idCommitment, "commitment not deterministic");
  });

  // ── create ─────────────────────────────────────────────────────

  it("create registers a new ZK ID on-chain", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "zkid", "create", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("registered") || stdout.includes("Transaction"), `stdout: ${stdout}`);
  });

  it("create again exits 0 with warning (already exists)", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "create", ZKID_NAME]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("already exists"), `stdout: ${stdout}`);
  });

  // ── info ───────────────────────────────────────────────────────

  it("info returns correct fields for existing ZK ID", async () => {
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
    const commitResult = await runCli(["zkid", "id-commitment", "--json", ZKID_NAME]);
    const infoResult = await runCli(["zkid", "info", "--json", ZKID_NAME]);
    assert.equal(commitResult.exitCode, 0);
    assert.equal(infoResult.exitCode, 0);
    const localCommitment = JSON.parse(commitResult.stdout).idCommitment;
    const chainCommitment = JSON.parse(infoResult.stdout).idCommitment;
    assert.equal(localCommitment, chainCommitment, "local commitment != on-chain commitment");
  });

  // ── deposit ────────────────────────────────────────────────────

  it("deposit 1 NARA into the ZK ID", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "zkid", "deposit", ZKID_NAME, "1",
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("Transaction"), `stdout: ${stdout}`);
  });

  it("info shows depositCount=1 after deposit", async () => {
    const { stdout, exitCode } = await runCli(["zkid", "info", "--json", ZKID_NAME]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.equal(json.depositCount, 1);
  });

  // ── scan ───────────────────────────────────────────────────────

  it("scan finds 1 claimable deposit", async () => {
    const { stdout, exitCode, stderr } = await runCli([
      "zkid", "scan", "--json", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.equal(json.count, 1);
    assert.equal(json.deposits[0].nara, 1);
  });

  // ── withdraw ───────────────────────────────────────────────────

  it("withdraw sends funds to auto-generated recipient", async () => {
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
    const { stdout, exitCode } = await runCli([
      "zkid", "scan", "--json", ZKID_NAME,
    ]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.equal(json.count, 0, `expected 0, got ${json.count}`);
  });
});
