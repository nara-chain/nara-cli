/**
 * Tests for agent-registry SDK functions (hits real chain)
 *
 * Requires PRIVATE_KEY in .env and sufficient NARA balance.
 * Run: npm test
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  registerAgent,
  getAgentRecord,
  getAgentInfo,
  getAgentMemory,
  getAgentRegistryConfig,
  setBio,
  setMetadata,
  uploadMemory,
  deleteAgent,
  logActivity,
  DEFAULT_RPC_URL,
} from "nara-sdk";

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.log("Skipping agent-registry tests: PRIVATE_KEY not set");
  process.exit(0);
}

const RPC_URL = process.env.RPC_URL || DEFAULT_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const AGENT_ID = `test-agent-${Date.now().toString(36)}`;

console.log(`\nAgent Registry Tests`);
console.log(`  RPC: ${RPC_URL}`);
console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
console.log(`  Agent ID: ${AGENT_ID}\n`);

// ─── Cleanup ─────────────────────────────────────────────────────

after(async () => {
  try {
    const sig = await deleteAgent(connection, wallet, AGENT_ID);
    console.log(`  Cleaned up agent "${AGENT_ID}" (tx: ${sig})`);
  } catch (err: any) {
    console.warn(`  Warning: failed to delete agent "${AGENT_ID}": ${err.message}`);
  }
});

// ─── Tests ───────────────────────────────────────────────────────

describe(`agent-registry (agentId=${AGENT_ID})`, () => {
  it("getConfig returns admin and fee info", async () => {
    const config = await getAgentRegistryConfig(connection);
    console.log(`  Config: admin=${config.admin.toBase58()}, fee=${config.registerFee} lamports`);
    assert.ok(config.admin);
    assert.ok(typeof config.registerFee === "number");
    assert.ok(config.feeVault);
  });

  it("registerAgent creates agent on-chain", async () => {
    const result = await registerAgent(connection, wallet, AGENT_ID);
    console.log(`  Registered: ${result.signature}`);
    assert.ok(result.signature);
    assert.ok(result.agentPubkey);
  });

  it("getAgentRecord returns correct agent data", async () => {
    const record = await getAgentRecord(connection, AGENT_ID);
    assert.equal(record.agentId, AGENT_ID);
    assert.ok(record.authority.equals(wallet.publicKey));
    assert.equal(record.version, 0);
    assert.equal(record.pendingBuffer, null);
  });

  it("setBio updates agent bio", async () => {
    const bio = "I am a test agent";
    const sig = await setBio(connection, wallet, AGENT_ID, bio);
    console.log(`  setBio: ${sig}`);

    const info = await getAgentInfo(connection, AGENT_ID);
    assert.equal(info.bio, bio);
  });

  it("setMetadata updates agent metadata", async () => {
    const meta = JSON.stringify({ type: "test", version: "1.0.0" });
    const sig = await setMetadata(connection, wallet, AGENT_ID, meta);
    console.log(`  setMetadata: ${sig}`);

    const info = await getAgentInfo(connection, AGENT_ID);
    assert.equal(info.metadata, meta);
  });

  it("getAgentInfo returns record + bio + metadata", async () => {
    const info = await getAgentInfo(connection, AGENT_ID);
    assert.equal(info.record.agentId, AGENT_ID);
    assert.ok(info.bio);
    assert.ok(info.metadata);
  });

  it("uploadMemory (new) stores data on-chain", async () => {
    const data = Buffer.from("Hello from test agent memory!");
    const sig = await uploadMemory(connection, wallet, AGENT_ID, data, {
      onProgress: (i, total, s) => console.log(`  upload chunk ${i}/${total}: ${s}`),
    });
    console.log(`  uploadMemory (new): ${sig}`);

    const memory = await getAgentMemory(connection, AGENT_ID);
    assert.ok(memory);
    assert.equal(memory.toString("utf-8"), "Hello from test agent memory!");
  });

  it("getAgentRecord shows version=1 after upload", async () => {
    const record = await getAgentRecord(connection, AGENT_ID);
    assert.equal(record.version, 1);
  });

  it("uploadMemory (update) replaces data on-chain", async () => {
    const data = Buffer.from("Updated memory content");
    const sig = await uploadMemory(connection, wallet, AGENT_ID, data);
    console.log(`  uploadMemory (update): ${sig}`);

    const memory = await getAgentMemory(connection, AGENT_ID);
    assert.ok(memory);
    assert.equal(memory.toString("utf-8"), "Updated memory content");
  });

  it("getAgentRecord shows version=2 after update", async () => {
    const record = await getAgentRecord(connection, AGENT_ID);
    assert.equal(record.version, 2);
  });

  it("logActivity emits on-chain event", async () => {
    const sig = await logActivity(
      connection, wallet, AGENT_ID,
      "test-model", "quest_answer", "answered round #1"
    );
    console.log(`  logActivity: ${sig}`);
    assert.ok(sig);
  });
});
