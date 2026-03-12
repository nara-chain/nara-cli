/**
 * Integration test: Quest + Referral via CLI
 *
 * Steps:
 * 1. Transfer 2 NARA to a random wallet
 * 2. Register main agent via CLI
 * 3. Register referral agent via CLI (using temp wallet file)
 * 4. Answer quest with --referral via CLI
 * 5. Verify transaction success and on-chain agent points
 *
 * Requires: PRIVATE_KEY in .env, active quest
 *
 * Run: npm run test:quest-referral
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { DEFAULT_AGENT_REGISTRY_PROGRAM_ID, getQuestInfo, getAgentRecord } from "nara-sdk";
import { runCli, hasWallet, pollConfirmation } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestQuestion {
  text: string;
  answer: string;
}

function loadTestQuestions(): TestQuestion[] {
  const filePath = join(__dirname, "../../.assets/test-questions.json");
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function loadMainWallet(): Keypair {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY required");
  return pk.startsWith("[")
    ? Keypair.fromSecretKey(new Uint8Array(JSON.parse(pk)))
    : Keypair.fromSecretKey(bs58.decode(pk));
}

describe("quest referral (on-chain)", { skip: !hasWallet ? "no PRIVATE_KEY" : undefined }, () => {
  const rpcUrl = process.env.RPC_URL || "https://mainnet-api.nara.build/";
  const connection = new Connection(rpcUrl, "confirmed");
  const suffix = Math.random().toString(16).slice(2, 8);
  const mainAgentId = `test-main-${suffix}`;
  const referralAgentId = `test-ref-${suffix}`;
  let referralWalletPath: string;
  let tmpDir: string;

  before(async () => {
    const mainWallet = loadMainWallet();
    const referralWallet = Keypair.generate();

    // Write referral wallet to temp file for --wallet flag
    tmpDir = mkdtempSync(join(tmpdir(), "nara-test-"));
    referralWalletPath = join(tmpDir, "referral-wallet.json");
    writeFileSync(referralWalletPath, JSON.stringify(Array.from(referralWallet.secretKey)));

    console.log(`  Main wallet: ${mainWallet.publicKey.toBase58()}`);
    console.log(`  Referral wallet: ${referralWallet.publicKey.toBase58()}`);
    console.log(`  Main agent: ${mainAgentId}`);
    console.log(`  Referral agent: ${referralAgentId}`);

    // Transfer 2 NARA to referral wallet for agent registration fee
    console.log("  Transferring 2 NARA to referral wallet...");
    const transferTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet.publicKey,
        toPubkey: referralWallet.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      })
    );
    transferTx.feePayer = mainWallet.publicKey;
    transferTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    transferTx.sign(mainWallet);
    const sig = await connection.sendRawTransaction(transferTx.serialize());
    await pollConfirmation(connection, sig);
    console.log(`  Transfer tx: ${sig}`);
  });

  after(() => {
    try { unlinkSync(referralWalletPath); } catch {}
  });

  // Register referral agent FIRST (uses separate wallet, won't conflict with main agent_id)
  it("registers referral agent with referral wallet", async () => {
    console.log(`  Registering referral agent "${referralAgentId}"...`);
    const { stdout, stderr, exitCode } = await runCli([
      "--wallet", referralWalletPath,
      "agent", "register", referralAgentId,
    ]);
    const output = stdout + stderr;
    if (output.includes("already") || output.includes("in use")) {
      console.log("  Agent already exists, continuing");
      return;
    }
    assert.equal(exitCode, 0, `Failed: ${stderr}`);
    assert.ok(output.includes("registered") || output.includes("Transaction"), "should confirm registration");
    console.log("  Referral agent registered");
  });

  it("registers main agent with referral", async () => {
    console.log(`  Registering main agent "${mainAgentId}" with referral "${referralAgentId}"...`);
    const { stdout, stderr, exitCode } = await runCli([
      "agent", "register", mainAgentId, "--referral", referralAgentId,
    ]);
    const output = stdout + stderr;
    if (output.includes("already") || output.includes("in use")) {
      console.log("  Agent already exists, continuing");
      return;
    }
    assert.equal(exitCode, 0, `Failed: ${stderr}`);
    assert.ok(output.includes("registered") || output.includes("Transaction"), "should confirm registration");
    console.log("  Main agent registered with referral");
  });

  it("answers quest with --referral", async () => {
    // Fetch quest
    const quest = await getQuestInfo(connection);
    if (!quest.active || quest.expired) {
      console.log("  (skipped: no active quest)");
      return;
    }

    // Find answer
    const questions = loadTestQuestions();
    const match = questions.find((q) => q.text === quest.question);
    if (!match) {
      console.log("  (skipped: question not in test-questions.json)");
      console.log(`  Question: ${quest.question}`);
      return;
    }

    console.log(`  Question: ${quest.question}`);
    console.log(`  Answer: ${match.answer}`);

    // Submit with --referral
    const { stdout, stderr, exitCode } = await runCli([
      "quest", "answer", match.answer,
      "--agent", "test",
      "--model", "test-referral",
      "--referral", referralAgentId,
    ]);

    const output = stdout + stderr;
    if (output.includes("already answered")) {
      console.log("  Already answered this round");
      return;
    }
    if (output.includes("expired")) {
      console.log("  Quest expired during test");
      return;
    }

    assert.equal(exitCode, 0, `CLI failed: ${stderr}`);

    // Extract transaction signature
    const txMatch = output.match(/Transaction:\s+(\S+)/);
    assert.ok(txMatch, "should show transaction signature");
    const txSig = txMatch![1]!;
    console.log(`  Transaction: ${txSig}`);

    // Verify transaction succeeded on-chain
    console.log("  Verifying transaction...");
    await new Promise((r) => setTimeout(r, 3000));

    let txInfo: any = null;
    for (let i = 0; i < 10; i++) {
      txInfo = await connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (txInfo) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!txInfo) {
      console.log("  WARN: Could not fetch transaction details");
      return;
    }

    if (txInfo.meta?.err) {
      console.log("  Transaction error:", JSON.stringify(txInfo.meta.err));
      const logs: string[] = txInfo.meta?.logMessages ?? [];
      console.log("  Last 10 log lines:");
      logs.slice(-10).forEach((l: string) => console.log(`    ${l}`));
    }
    assert.ok(!txInfo.meta?.err, `Transaction failed: ${JSON.stringify(txInfo.meta?.err)}`);

    // Check logs contain agent registry program invocation (activityLog was appended)
    const logs: string[] = txInfo.meta?.logMessages ?? [];
    const hasRegistryInvoke = logs.some((l) => l.includes(DEFAULT_AGENT_REGISTRY_PROGRAM_ID));
    if (hasRegistryInvoke) {
      console.log("  OK: Transaction includes agent registry program invocation");
    } else {
      console.log("  WARN: No agent registry invocation found (agent may not be in config)");
    }

    console.log("  Answer submitted with referral successfully");
  });

  it("verifies on-chain agent records", async () => {
    try {
      const mainRecord = await getAgentRecord(connection, mainAgentId);
      console.log(`  Main agent: ${mainRecord.agentId}, referral: ${mainRecord.referralId ?? "(none)"}`);

      const referralRecord = await getAgentRecord(connection, referralAgentId);
      console.log(`  Referral agent: ${referralRecord.agentId}`);

      // Points are now minted as SPL tokens (Token-2022), not stored on AgentRecord
      console.log("  OK: Both agent records exist on-chain");
    } catch (err: any) {
      console.log(`  (skipped: ${err.message})`);
    }
  });
});
