/**
 * Tests for `skills` CLI commands
 *
 * Run: npm test
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, hasWallet, uniqueName } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SKILL_FILE = join(__dirname, "test_skill.md");

// ─── Help output ──────────────────────────────────────────────────

describe("skills --help", () => {
  it("shows all subcommands", async () => {
    const { stdout, exitCode } = await runCli(["skills", "--help"]);
    assert.equal(exitCode, 0);
    for (const cmd of ["register", "get", "content", "set-description", "set-metadata", "upload", "transfer", "close-buffer", "delete"]) {
      assert.ok(stdout.includes(cmd), `missing command: ${cmd}`);
    }
  });

  it("skills register --help shows <name> and <author>", async () => {
    const { stdout, exitCode } = await runCli(["skills", "register", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<name>"));
    assert.ok(stdout.includes("<author>"));
  });

  it("skills upload --help shows <file>", async () => {
    const { stdout, exitCode } = await runCli(["skills", "upload", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("<file>"));
  });

  it("skills content --help shows --hex option", async () => {
    const { stdout, exitCode } = await runCli(["skills", "content", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("--hex"));
  });
});

// ─── Argument validation (no chain needed) ────────────────────────

describe("skills argument errors", () => {
  it("skills get with no name exits non-zero", async () => {
    const { exitCode } = await runCli(["skills", "get"]);
    assert.notEqual(exitCode, 0);
  });

  it("skills register with missing author exits non-zero", async () => {
    const { exitCode } = await runCli(["skills", "register", "myskill"]);
    assert.notEqual(exitCode, 0);
  });

  it("skills set-metadata rejects invalid JSON", async () => {
    if (!hasWallet) return;
    const { stderr, exitCode } = await runCli(["skills", "set-metadata", "anyskill", "not-valid-json"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Invalid JSON"), `stderr: ${stderr}`);
  });

  it("skills transfer rejects invalid public key", async () => {
    if (!hasWallet) return;
    const { stderr, exitCode } = await runCli(["skills", "transfer", "anyskill", "not-a-pubkey"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Invalid public key"), `stderr: ${stderr}`);
  });

  it("skills upload with non-existent file fails", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["skills", "upload", "anyskill", "/tmp/__no_such_file__.bin"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.length > 0);
  });
});

// ─── Read-only chain queries ──────────────────────────────────────

describe("skills read-only queries", () => {
  it("skills get non-existent skill exits with error", async () => {
    const { exitCode, stderr } = await runCli(["skills", "get", "definitely-does-not-exist-xyz123"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.length > 0);
  });
});

// ─── Success cases (requires wallet) ─────────────────────────────

describe("skills success cases", () => {
  const SKILL_NAME = uniqueName("unit-skill");
  const AUTHOR = "unit-test-author";

  after(async () => {
    if (!hasWallet) return;
    await runCli(["skills", "delete", SKILL_NAME]);
  });

  it("register a new skill on-chain", async () => {
    if (!hasWallet) return;
    const { stdout, stderr, exitCode } = await runCli([
      "skills", "register", SKILL_NAME, AUTHOR,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("Transaction"), `stdout: ${stdout}`);
  });

  it("get --json returns correct name, author and initial state", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode, stderr } = await runCli([
      "skills", "get", "--json", SKILL_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.equal(json.name, SKILL_NAME);
    assert.equal(json.author, AUTHOR);
    assert.equal(json.version, 0);
    assert.equal(json.description, null);
    assert.equal(json.metadata, null);
    assert.ok(typeof json.authority === "string" && json.authority.length > 0);
    assert.ok(typeof json.createdAt === "string");
  });

  it("set-description updates description on-chain", async () => {
    if (!hasWallet) return;
    const desc = "A unit-test skill description";
    const { exitCode, stderr } = await runCli([
      "skills", "set-description", SKILL_NAME, desc,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    const { stdout } = await runCli(["skills", "get", "--json", SKILL_NAME]);
    assert.equal(JSON.parse(stdout).description, desc);
  });

  it("set-metadata updates metadata on-chain", async () => {
    if (!hasWallet) return;
    const meta = JSON.stringify({ env: "unit-test", ok: true });
    const { exitCode, stderr } = await runCli([
      "skills", "set-metadata", SKILL_NAME, meta,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    const { stdout } = await runCli(["skills", "get", "--json", SKILL_NAME]);
    assert.equal(JSON.parse(stdout).metadata, meta);
  });

  it("upload test_skill.md uploads content on-chain", async () => {
    if (!hasWallet) return;
    const { stdout, stderr, exitCode } = await runCli([
      "skills", "upload", SKILL_NAME, TEST_SKILL_FILE,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("Transaction") || stdout.includes("Finalize"), `stdout: ${stdout}`);
  });

  it("get --json shows version=1 and non-null updatedAt after upload", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode, stderr } = await runCli([
      "skills", "get", "--json", SKILL_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.equal(json.version, 1);
    assert.ok(json.updatedAt !== null, "updatedAt should be set after content upload");
  });

  it("content --json reads back uploaded file", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode, stderr } = await runCli([
      "skills", "content", "--json", SKILL_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.ok(typeof json.size === "number" && json.size > 0);
    assert.ok(typeof json.content === "string" && json.content.length > 0);
  });

  it("delete removes the skill from chain", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["skills", "delete", SKILL_NAME]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    // Verify it's gone
    const { exitCode: getExit } = await runCli(["skills", "get", SKILL_NAME]);
    assert.equal(getExit, 1);
  });
});
