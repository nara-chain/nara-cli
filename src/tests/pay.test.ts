/**
 * Test: pay NARA to model-hub, charge, then fetch user info
 *
 * Flow:
 *   1. Transfer 10 NARA on-chain via CLI
 *   2. sign-url + fetch /model-hub-api/charge?tx=<sig>
 *   3. sign-url + fetch /model-hub-api/user/info
 *
 * Requires PRIVATE_KEY in .env and >= 10 NARA balance.
 *
 * Run: npm run test:pay
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, hasWallet } from "./helpers.js";

const MODEL_HUB_BASE = "https://model-api.nara.build";
const CHARGE_ADDRESS = "MoDRtxeD2xfyPxswH7qnuZyQpNNWpjqTskNY79KuZqX";
const NARA_AMOUNT = "10";

describe("pay test (model-hub)", { skip: !hasWallet ? "no wallet" : undefined }, () => {
  let transferSig: string;

  it("step 1: transfer 10 NARA to charge address", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "transfer", CHARGE_ADDRESS, NARA_AMOUNT,
    ]);
    const output = stdout + stderr;
    assert.equal(exitCode, 0, `Transfer failed: ${output}`);

    // Extract signature from text output (printInfo pollutes --json stdout)
    const sigMatch = output.match(/Signature:\s+(\S+)/);
    assert.ok(sigMatch, `should show signature in output: ${output}`);
    transferSig = sigMatch![1]!;
    console.log(`  TX: ${transferSig}`);
    console.log(`  Amount: ${NARA_AMOUNT} NARA → ${CHARGE_ADDRESS}`);
  });

  it("step 2: charge via model-hub API", async () => {
    assert.ok(transferSig, "transfer signature required from step 1");

    // Use sign-url to build signed charge URL
    const { stdout: signedUrl, exitCode: signExit } = await runCli([
      "sign-url", `${MODEL_HUB_BASE}/model-hub-api/charge?tx=${transferSig}`,
    ]);
    assert.equal(signExit, 0, "sign-url failed");
    const url = signedUrl.trim();
    console.log(`  Charge URL: ${url}`);

    const res = await fetch(url);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }

    assert.ok(res.ok, `Charge failed (${res.status}): ${JSON.stringify(json)}`);
    console.log(`  Charge response: ${JSON.stringify(json)}`);
  });

  it("step 3: fetch user info", async () => {
    const { stdout: signedUrl, exitCode: signExit } = await runCli([
      "sign-url", `${MODEL_HUB_BASE}/model-hub-api/user/info`,
    ]);
    assert.equal(signExit, 0, "sign-url failed");
    const url = signedUrl.trim();
    console.log(`  Info URL: ${url}`);

    const res = await fetch(url);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }

    assert.ok(res.ok, `User info failed (${res.status}): ${JSON.stringify(json)}`);
    console.log(`  User info: ${JSON.stringify(json)}`);
  });
});
