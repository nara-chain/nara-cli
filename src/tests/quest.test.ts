/**
 * Tests for `quest` CLI commands
 *
 * - Help / validation tests run without wallet or chain
 * - On-chain tests require PRIVATE_KEY in .env and an active quest
 *
 * Run: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair } from "@solana/web3.js";
import { runCli, hasWallet } from "./helpers.js";
import { getQuestInfo, generateProof } from "nara-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestQuestion {
  text: string;
  answer: string;
}

function loadTestQuestions(): TestQuestion[] {
  const filePath = join(__dirname, "../../.assets/test-questions.json");
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

// ─── Help output ──────────────────────────────────────────────────

describe("quest --help", () => {
  it("shows subcommands", async () => {
    const { stdout, exitCode } = await runCli(["quest", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("get"));
    assert.ok(stdout.includes("answer"));
  });

  it("quest answer --help shows options", async () => {
    const { stdout, exitCode } = await runCli(["quest", "answer", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("--relay"));
    assert.ok(stdout.includes("--agent"));
    assert.ok(stdout.includes("--model"));
    assert.ok(stdout.includes("--referral"));
  });
});

// ─── Quest get ────────────────────────────────────────────────────

describe("quest get", () => {
  it("quest get --json returns quest info", async () => {
    const { stdout, exitCode } = await runCli(["quest", "get", "--json"]);
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    if (data.active === false) {
      // No active quest, that's fine
      assert.equal(data.active, false);
    } else {
      assert.ok(data.question, "should have a question");
      assert.ok(data.round, "should have a round");
      assert.ok(data.difficulty !== undefined, "should have difficulty");
    }
  });
});

// ─── ZK proof generation from test-questions ──────────────────────

describe("quest proof generation", () => {
  it("generates valid ZK proof for a test question", async () => {
    const rpcUrl = process.env.RPC_URL || "https://mainnet-api.nara.build/";
    const connection = new Connection(rpcUrl, "confirmed");

    // Fetch current quest
    const quest = await getQuestInfo(connection);
    if (!quest.active || quest.expired) {
      console.log("  (skipped: no active quest)");
      return;
    }

    // Find matching answer from test-questions
    const questions = loadTestQuestions();
    const match = questions.find((q) => q.text === quest.question);
    if (!match) {
      console.log(`  (skipped: question not found in test-questions.json)`);
      console.log(`  Question: ${quest.question}`);
      return;
    }

    console.log(`  Question: ${quest.question}`);
    console.log(`  Answer: ${match.answer}`);

    // Generate proof with a random pubkey (we're just testing proof generation)
    const testKeypair = Keypair.generate();
    const proof = await generateProof(match.answer, quest.answerHash, testKeypair.publicKey);

    assert.ok(proof.solana.proofA.length > 0, "proofA should not be empty");
    assert.ok(proof.solana.proofB.length > 0, "proofB should not be empty");
    assert.ok(proof.solana.proofC.length > 0, "proofC should not be empty");
    assert.ok(proof.hex.proofA.length > 0, "hex proofA should not be empty");
    console.log("  Proof generated successfully");
  });
});

// ─── On-chain quest answer ────────────────────────────────────────

describe("quest answer (on-chain)", { skip: !hasWallet ? "no wallet" : undefined }, () => {
  it("submits answer from test-questions and outputs tx", async () => {
    const rpcUrl = process.env.RPC_URL || "https://mainnet-api.nara.build/";
    const connection = new Connection(rpcUrl, "confirmed");

    // Fetch current quest
    const quest = await getQuestInfo(connection);
    if (!quest.active || quest.expired) {
      console.log("  (skipped: no active quest)");
      return;
    }

    // Find matching answer
    const questions = loadTestQuestions();
    const match = questions.find((q) => q.text === quest.question);
    if (!match) {
      console.log(`  (skipped: question not found in test-questions.json)`);
      console.log(`  Question: ${quest.question}`);
      return;
    }

    console.log(`  Question: ${quest.question}`);
    console.log(`  Answer: ${match.answer}`);

    const { stdout, stderr, exitCode } = await runCli([
      "quest", "answer", match.answer,
      "--agent", "test",
      "--model", "test",
      "--json",
    ]);

    const output = stdout + stderr;

    // Handle known non-error cases
    if (output.includes("already answered") || output.includes("Already answered")) {
      console.log("  Already answered this round");
      return;
    }
    if (output.includes("expired")) {
      console.log("  Quest expired during test");
      return;
    }

    // Handle confirmation timeout - tx was sent but ws confirmation failed
    const sigMatch = output.match(/Check signature (\w{80,})/);
    if (sigMatch) {
      console.log(`  TX (confirmation timeout): ${sigMatch[1]}`);
      return;
    }

    assert.equal(exitCode, 0, `CLI failed: ${stderr}`);

    // Parse JSON output to get tx signature
    try {
      const data = JSON.parse(stdout);
      assert.ok(data.signature, "should have signature in JSON output");
      console.log(`  TX: ${data.signature}`);
    } catch {
      assert.ok(output.includes("Transaction:") || output.includes("signature"), "should show transaction");
      console.log(`  Output: ${stdout.trim()}`);
    }
  });
});
