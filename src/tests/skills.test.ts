/**
 * Tests for `skills` CLI commands
 *
 * - Help / validation tests run without wallet or chain
 * - On-chain tests (register, upload, etc.) require PRIVATE_KEY in .env
 *
 * Run: npm test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli, hasWallet, uniqueName } from "./helpers.js";

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

// ─── On-chain tests (requires wallet + NARA balance) ─────────────

describe("skills on-chain", () => {
  const SKILL_NAME = uniqueName("test-skill");
  const AUTHOR = "test-author";
  let tmpDir: string;
  let contentFile: string;

  before(() => {
    if (!hasWallet) return;
    tmpDir = mkdtempSync(join(tmpdir(), "naracli-test-"));
    contentFile = join(tmpDir, "skill-content.md");
    writeFileSync(contentFile, `# ${SKILL_NAME}\n\nThis is test content.\n`);
    console.log(`\nUsing skill name: ${SKILL_NAME}`);
  });

  after(async () => {
    if (!hasWallet) return;
    try { unlinkSync(contentFile); } catch {}
    const { exitCode, stderr } = await runCli(["skills", "delete", SKILL_NAME]);
    if (exitCode !== 0) {
      console.warn(`  Warning: failed to delete skill "${SKILL_NAME}": ${stderr}`);
    } else {
      console.log(`  Cleaned up skill "${SKILL_NAME}"`);
    }
  });

  it("register a new skill on-chain", async () => {
    if (!hasWallet) return;
    const { stdout, stderr, exitCode } = await runCli([
      "skills", "register", SKILL_NAME, AUTHOR,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("registered") || stdout.includes("Transaction"), `stdout: ${stdout}`);
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
    const desc = "A test skill description";
    const { exitCode, stderr } = await runCli([
      "skills", "set-description", SKILL_NAME, desc,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    const { stdout } = await runCli(["skills", "get", "--json", SKILL_NAME]);
    assert.equal(JSON.parse(stdout).description, desc);
  });

  it("set-metadata updates metadata on-chain", async () => {
    if (!hasWallet) return;
    const meta = JSON.stringify({ env: "test", ok: true });
    const { exitCode, stderr } = await runCli([
      "skills", "set-metadata", SKILL_NAME, meta,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    const { stdout } = await runCli(["skills", "get", "--json", SKILL_NAME]);
    assert.equal(JSON.parse(stdout).metadata, meta);
  });

  it("upload content from file", async () => {
    if (!hasWallet) return;
    const { stdout, stderr, exitCode } = await runCli([
      "skills", "upload", SKILL_NAME, contentFile,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("Transaction") || stdout.includes("Finalize"), `stdout: ${stdout}`);
  });

  it("get --json shows version=1 after upload", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode, stderr } = await runCli([
      "skills", "get", "--json", SKILL_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.equal(json.version, 1);
    assert.ok(json.updatedAt !== null, "updatedAt should be set after content upload");
  });

  it("content --json reads back uploaded data", async () => {
    if (!hasWallet) return;
    const { stdout, exitCode, stderr } = await runCli([
      "skills", "content", "--json", SKILL_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.ok(typeof json.size === "number" && json.size > 0);
    assert.ok(typeof json.content === "string" && json.content.includes(SKILL_NAME));
  });

  it("delete removes the skill from chain", async () => {
    if (!hasWallet) return;
    const { exitCode, stderr } = await runCli(["skills", "delete", SKILL_NAME]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    const { exitCode: getExit } = await runCli(["skills", "get", SKILL_NAME]);
    assert.equal(getExit, 1);
  });
});
