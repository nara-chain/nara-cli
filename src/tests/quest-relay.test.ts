/**
 * Tests for quest relay (gasless) submission
 *
 * Requires PRIVATE_KEY in .env and an active quest.
 *
 * Run: npm run test:quest-relay
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection } from "@solana/web3.js";
import { runCli, hasWallet } from "./helpers.js";
import { getQuestInfo } from "nara-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestQuestion {
  text: string;
  answer: string;
}

function loadTestQuestions(): TestQuestion[] {
  const filePath = join(__dirname, "../../.assets/test-questions.json");
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

// ─── Relay quest answer ──────────────────────────────────────────

describe("quest answer (relay)", { skip: !hasWallet ? "no wallet" : undefined }, () => {
  it("submits answer via relay and outputs tx", async () => {
    const rpcUrl = process.env.RPC_URL || "https://mainnet-api.nara.build/";
    const relayUrl = process.env.QUEST_RELAY_URL || "https://quest-api.nara.build/";
    console.log(`  Relay: ${relayUrl}`);
    const connection = new Connection(rpcUrl, "confirmed");

    const quest = await getQuestInfo(connection);
    if (!quest.active || quest.expired) {
      console.log("  (skipped: no active quest)");
      return;
    }

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
      "--relay",
      "--agent", "test",
      "--model", "test",
    ]);

    const output = stdout + stderr;

    if (output.includes("already answered") || output.includes("Already answered")) {
      console.log("  Already answered this round");
      return;
    }
    if (output.includes("expired")) {
      console.log("  Quest expired during test");
      return;
    }

    assert.equal(exitCode, 0, `CLI failed: ${stderr}`);
    assert.ok(output.includes("Transaction:") || output.includes("submitted"), "should confirm submission");

    // Extract and print tx signature
    const txMatch = output.match(/Transaction:\s+(\S+)/);
    if (txMatch) {
      console.log(`  TX: ${txMatch[1]}`);
    }

    // Print reward info
    if (output.includes("Reward received")) {
      const rewardMatch = output.match(/Reward received:\s+(.+)/);
      console.log(`  Reward: ${rewardMatch ? rewardMatch[1] : "yes"}`);
    } else if (output.includes("no reward") || output.includes("all reward slots")) {
      console.log("  Reward: none (all slots claimed)");
    }
  });
});
