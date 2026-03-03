/**
 * End-to-end tests for `skills` commands (hits real testnet)
 *
 * Requires PRIVATE_KEY in .env and sufficient NARA balance.
 * Run: npm run test:e2e
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli, hasWallet, uniqueName } from "./helpers.js";

if (!hasWallet) {
  console.log("Skipping skills e2e tests: PRIVATE_KEY not set");
  process.exit(0);
}

// ─── Shared state across tests ────────────────────────────────────

const SKILL_NAME = uniqueName("e2e-skill");
const AUTHOR = "e2e-test-author";
let tmpDir: string;
let contentFile: string;

// ─── Setup ────────────────────────────────────────────────────────

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "naracli-test-"));
  contentFile = join(tmpDir, "skill-content.md");
  writeFileSync(contentFile, `# ${SKILL_NAME}\n\nThis is e2e test content.\n`);
  console.log(`\nUsing skill name: ${SKILL_NAME}`);
});

// ─── Cleanup ──────────────────────────────────────────────────────

after(async () => {
  try { unlinkSync(contentFile); } catch {}
  // Delete on-chain skill (reclaim rent)
  const { exitCode, stderr } = await runCli(["skills", "delete", SKILL_NAME]);
  if (exitCode !== 0) {
    console.warn(`  Warning: failed to delete skill "${SKILL_NAME}": ${stderr}`);
  } else {
    console.log(`  Cleaned up skill "${SKILL_NAME}"`);
  }
});

// ─── Tests ────────────────────────────────────────────────────────

describe(`skills e2e (name=${SKILL_NAME})`, () => {
  it("register skill on-chain", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "skills", "register", SKILL_NAME, AUTHOR,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes("registered") || stdout.includes("Transaction"), `stdout: ${stdout}`);
  });

  it("get skill returns correct name and author", async () => {
    const { stdout, exitCode, stderr } = await runCli([
      "skills", "get", "--json", SKILL_NAME,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const json = JSON.parse(stdout);
    assert.equal(json.name, SKILL_NAME);
    assert.equal(json.author, AUTHOR);
    assert.equal(json.version, 0);
    assert.equal(json.description, null);
  });

  it("set-description updates description", async () => {
    const desc = "An e2e test skill";
    const { exitCode, stderr } = await runCli([
      "skills", "set-description", SKILL_NAME, desc,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    const { stdout } = await runCli(["skills", "get", "--json", SKILL_NAME]);
    const json = JSON.parse(stdout);
    assert.equal(json.description, desc);
  });

  it("set-metadata updates metadata", async () => {
    const meta = JSON.stringify({ env: "e2e", version: "1.0.0" });
    const { exitCode, stderr } = await runCli([
      "skills", "set-metadata", SKILL_NAME, meta,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    const { stdout } = await runCli(["skills", "get", "--json", SKILL_NAME]);
    const json = JSON.parse(stdout);
    assert.equal(json.metadata, meta);
  });

  it("upload content and read back matches original", async () => {
    const { exitCode, stderr } = await runCli([
      "skills", "upload", SKILL_NAME, contentFile,
    ]);
    assert.equal(exitCode, 0, `stderr: ${stderr}`);

    // Read back via skills content
    const { stdout: contentOut, exitCode: cExit } = await runCli([
      "skills", "content", SKILL_NAME,
    ]);
    assert.equal(cExit, 0);
    assert.ok(contentOut.includes(SKILL_NAME), `content mismatch: ${contentOut}`);
  });

  it("skills content --json includes size field", async () => {
    const { stdout, exitCode } = await runCli([
      "skills", "content", "--json", SKILL_NAME,
    ]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.ok(typeof json.size === "number" && json.size > 0);
    assert.ok(typeof json.content === "string" && json.content.length > 0);
  });

  it("get skill shows updated version after upload", async () => {
    const { stdout, exitCode } = await runCli(["skills", "get", "--json", SKILL_NAME]);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout);
    assert.ok(json.version >= 1, `expected version >= 1, got ${json.version}`);
  });
});
