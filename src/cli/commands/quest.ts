/**
 * Quest commands - interact with nara-quest on-chain quiz
 */

import { Command } from "commander";
import { Connection, Keypair } from "@solana/web3.js";
import { join } from "node:path";
import { loadWallet, getRpcUrl } from "../utils/wallet";
import {
  formatOutput,
  printError,
  printInfo,
  printSuccess,
  printWarning,
} from "../utils/output";
import type { GlobalOptions } from "../types";
import {
  getQuestInfo,
  getQuestConfig,
  hasAnswered,
  generateProof,
  submitAnswer,
  submitAnswerViaRelay,
  parseQuestReward,
  stake as questStake,
  unstake as questUnstake,
  getStakeInfo,
  type ActivityLog,
  type StakeInfo,
  type QuestOptions,
} from "nara-sdk";
import { loadNetworkConfig } from "../utils/agent-config";

// In CJS bundle (dist/naracli.cjs), import.meta.url is undefined and SDK
// cannot auto-resolve ZK circuit paths. Provide them explicitly via __dirname.
// Use indirect access to avoid esbuild empty-import-meta warning.
const _getMetaUrl = () => { try { return import.meta.url; } catch { return undefined; } };
function getZkOptions(): QuestOptions | undefined {
  if (_getMetaUrl()) return undefined; // dev mode: SDK resolves paths itself
  return {
    circuitWasmPath: join(__dirname, "zk", "answer_proof.wasm"),
    zkeyPath: join(__dirname, "zk", "answer_proof_final.zkey"),
  };
}

const DEFAULT_QUEST_RELAY_URL = process.env.QUEST_RELAY_URL || "https://quest-api.nara.build/";

// ─── Anchor error parsing ────────────────────────────────────────
const QUEST_ERRORS: Record<number, string> = {
  6000: "unauthorized",
  6001: "poolNotActive",
  6002: "deadlineExpired",
  6003: "invalidProof",
  6004: "invalidDeadline",
  6005: "insufficientReward",
  6006: "questionTooLong",
  6007: "alreadyAnswered",
  6008: "invalidMinRewardCount",
  6009: "invalidMaxRewardCount",
  6010: "unstakeNotReady",
  6011: "insufficientStakeBalance",
};

function anchorErrorCode(err: any): string {
  const code = err?.error?.errorCode?.code;
  if (code) return code;
  const raw = err?.message ?? JSON.stringify(err) ?? "";
  const m = raw.match(/"Custom":(\d+)/);
  if (m) return QUEST_ERRORS[parseInt(m[1])] ?? "";
  return "";
}

// ─── Helpers ─────────────────────────────────────────────────────
function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "expired";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Command: quest get ──────────────────────────────────────────
async function handleQuestGet(options: GlobalOptions & { verbose?: boolean }) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  let wallet: Keypair;
  try {
    wallet = await loadWallet(options.wallet);
  } catch {
    wallet = Keypair.generate();
  }

  let quest;
  try {
    quest = await getQuestInfo(connection, wallet);
  } catch (err: any) {
    printError(`Failed to fetch quest info: ${err.message}`);
    process.exit(1);
  }

  if (!quest.active) {
    printWarning("No active quest at the moment");
    if (options.json) {
      formatOutput({ active: false }, true);
    }
    return;
  }

  // Stake is always required to answer quests
  const stakeRequired = true;

  // Fetch free credits (stake-free answer quota)
  let freeCredits = 0;
  try {
    const stakeInfo = await getStakeInfo(connection, wallet.publicKey);
    if (stakeInfo) {
      freeCredits = stakeInfo.freeCredits;
    }
  } catch {
    // Ignore — wallet may not have a stake record
  }

  const data: Record<string, any> = {
    round: quest.round,
    question: quest.question,
    difficulty: quest.difficulty,
    rewardPerWinner: `${quest.rewardPerWinner} NARA`,
    totalReward: `${quest.totalReward} NARA`,
    rewardSlots: `${quest.winnerCount}/${quest.rewardCount}`,
    remainingRewardSlots: quest.remainingSlots,
    deadline: new Date(quest.deadline * 1000).toLocaleString(),
    timeRemaining: formatTimeRemaining(quest.timeRemaining),
    expired: quest.expired,
    stakeRequired,
    stakeRequirement: stakeRequired ? `${quest.effectiveStakeRequirement.toFixed(9).replace(/\.?0+$/, "")} NARA` : "0 NARA",
    stakeHigh: `${quest.stakeHigh} NARA`,
    stakeLow: `${quest.stakeLow} NARA`,
    avgParticipantStake: `${quest.avgParticipantStake} NARA`,
    freeCredits,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Question: ${quest.question}`);
    console.log(`  Round: #${quest.round}`);
    console.log(`  Difficulty: ${quest.difficulty}`);
    console.log(`  Reward per winner: ${quest.rewardPerWinner} NARA`);
    console.log(`  Total reward: ${quest.totalReward} NARA`);
    console.log(
      `  Reward slots: ${quest.winnerCount}/${quest.rewardCount} (${quest.remainingSlots} remaining)`
    );
    if (stakeRequired) {
      console.log(`  Stake requirement: ${quest.effectiveStakeRequirement.toFixed(9).replace(/\.?0+$/, "")} NARA (decays ${quest.stakeHigh} → ${quest.stakeLow})`);
    } else if (options.verbose) {
      console.log(`  Stake requirement: none (${quest.effectiveStakeRequirement.toFixed(9).replace(/\.?0+$/, "")} NARA, decays ${quest.stakeHigh} → ${quest.stakeLow})`);
    } else {
      console.log(`  Stake requirement: none`);
    }
    console.log(`  Stake-free credits: ${freeCredits}`);
    console.log(`  Deadline: ${new Date(quest.deadline * 1000).toLocaleString()}`);
    if (quest.timeRemaining > 0) {
      console.log(`  Time remaining: ${formatTimeRemaining(quest.timeRemaining)}`);
    } else {
      printWarning("Quest has expired");
    }
    console.log("");
  }
}

// ─── Command: quest config ───────────────────────────────────────
async function handleQuestConfig(options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");

  let config;
  try {
    config = await getQuestConfig(connection);
  } catch (err: any) {
    printError(`Failed to fetch quest config: ${err.message}`);
    process.exit(1);
  }

  const DECIMALS = 1e9;
  const rewardPerShare = config.rewardPerShare / DECIMALS;
  const extraReward = config.extraReward / DECIMALS;
  const stakeBpsHigh = config.stakeBpsHigh;
  const stakeBpsLow = config.stakeBpsLow;

  const data = {
    authority: config.authority.toBase58(),
    questAuthority: config.questAuthority.toBase58(),
    treasury: config.treasury.toBase58(),
    minRewardCount: config.minRewardCount,
    maxRewardCount: config.maxRewardCount,
    rewardPerShare,
    extraReward,
    stakeBpsHigh,
    stakeBpsLow,
    decayMs: config.decayMs,
    minQuestInterval: config.minQuestInterval,
  };

  if (options.json) {
    formatOutput(data, true);
  } else {
    console.log("");
    console.log(`  Min Reward Count:   ${data.minRewardCount}`);
    console.log(`  Max Reward Count:   ${data.maxRewardCount}`);
    console.log(`  Reward Per Share:   ${rewardPerShare} NARA (${config.rewardPerShare} lamports)`);
    console.log(`  Extra Reward:       ${extraReward} NARA (${config.extraReward} lamports)`);
    console.log(`  Stake BPS High:     ${stakeBpsHigh / 100}% (${stakeBpsHigh} BPS)`);
    console.log(`  Stake BPS Low:      ${stakeBpsLow / 100}% (${stakeBpsLow} BPS)`);
    console.log(`  Decay (ms):         ${data.decayMs}`);
    console.log(`  Min Quest Interval: ${data.minQuestInterval}s`);
    console.log("");
  }
}

// ─── Command: quest answer ───────────────────────────────────────
async function handleQuestAnswer(
  answer: string,
  options: GlobalOptions & { relay?: string; agent?: string; model?: string; referral?: string; stake?: string }
) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);
  const networkConfig = loadNetworkConfig(rpcUrl, wallet.publicKey.toBase58());
  const configAgentId = networkConfig.agent_id;
  const agent = options.agent ?? "naracli";
  const model = options.model ?? "";
  const referral = options.referral;

  // 1. Fetch quest info
  let quest;
  try {
    quest = await getQuestInfo(connection, wallet);
  } catch (err: any) {
    printError(`Failed to fetch quest info: ${err.message}`);
    process.exit(1);
  }

  if (!quest.active) {
    printError("No active quest at the moment");
    process.exit(1);
  }

  if (quest.expired) {
    printError("Quest has expired");
    process.exit(1);
  }

  // 2. Check if already answered this round
  const alreadyAnswered = await hasAnswered(connection, wallet);
  if (alreadyAnswered) {
    printWarning("You have already answered this round");
    process.exit(0);
  }

  // 3. Generate ZK proof
  printInfo("Generating ZK proof...");

  let proof;
  try {
    proof = await generateProof(answer, quest.answerHash, wallet.publicKey, quest.round, getZkOptions());
  } catch (err: any) {
    if (err.message?.includes("Assert Failed")) {
      printError("Wrong answer");
    } else {
      printError(`ZK proof generation failed: ${err.message}`);
    }
    process.exit(1);
  }

  // 4. Check deadline again after proof generation
  const nowAfterProof = Math.floor(Date.now() / 1000);
  if (nowAfterProof >= quest.deadline) {
    printError("Quest expired during proof generation");
    process.exit(1);
  }

  // 5. Submit answer
  if (options.relay) {
    // Relay (gasless) submission
    printInfo("Submitting answer via relay...");
    try {
      const relayResult = await submitAnswerViaRelay(
        options.relay,
        wallet.publicKey,
        proof.hex,
        agent,
        model
      );
      printSuccess("Answer submitted via relay!");
      console.log(`  Transaction: ${relayResult.txHash}`);
      await handleReward(connection, relayResult.txHash, options);
    } catch (err: any) {
      printError(`Relay submission failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Direct on-chain submission
    printInfo("Submitting answer...");
    try {
      let activityLog: ActivityLog | undefined;
      if (configAgentId) {
        activityLog = { agentId: configAgentId, activity: "PoMI", model, log: "", referralAgentId: referral };
      }
      const stakeOpt = options.stake === "auto" ? "auto" : options.stake ? parseFloat(options.stake) : undefined;
      const result = await submitAnswer(connection, wallet, proof.solana, agent, model, stakeOpt !== undefined ? { stake: stakeOpt } : undefined, activityLog);
      printSuccess("Answer submitted!");
      console.log(`  Transaction: ${result.signature}`);
      await handleReward(connection, result.signature, options);
    } catch (err: any) {
      handleSubmitError(err);
    }
  }
}

// ─── Command: quest stake ────────────────────────────────────────
async function handleQuestStake(amount: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) {
    printError("Amount must be a positive number");
    process.exit(1);
  }

  if (!options.json) printInfo(`Staking ${n} NARA...`);
  const signature = await questStake(connection, wallet, n);
  if (!options.json) printSuccess(`Staked ${n} NARA!`);

  if (options.json) {
    formatOutput({ amount: n, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

// ─── Command: quest unstake ─────────────────────────────────────
async function handleQuestUnstake(amount: string, options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) {
    printError("Amount must be a positive number");
    process.exit(1);
  }

  if (!options.json) printInfo(`Unstaking ${n} NARA...`);
  const signature = await questUnstake(connection, wallet, n);
  if (!options.json) printSuccess(`Unstaked ${n} NARA!`);

  if (options.json) {
    formatOutput({ amount: n, signature }, true);
  } else {
    console.log(`  Transaction: ${signature}`);
  }
}

// ─── Command: quest stake-info ──────────────────────────────────
async function handleQuestStakeInfo(options: GlobalOptions) {
  const rpcUrl = getRpcUrl(options.rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = await loadWallet(options.wallet);

  const stakeInfo = await getStakeInfo(connection, wallet.publicKey);
  if (!stakeInfo) {
    if (options.json) {
      formatOutput({ staked: false, amount: 0 }, true);
    } else {
      printInfo("No stake record found");
    }
    return;
  }

  if (options.json) {
    formatOutput({ staked: true, amount: stakeInfo.amount, stakeRound: stakeInfo.stakeRound }, true);
  } else {
    console.log("");
    console.log(`  Staked: ${stakeInfo.amount} NARA`);
    console.log(`  Stake round: ${stakeInfo.stakeRound}`);
    console.log("");
  }
}

// ─── Parse reward from transaction ───────────────────────────────
async function handleReward(
  connection: Connection,
  txSignature: string,
  options: GlobalOptions
) {
  printInfo("Fetching transaction details...");

  let reward;
  try {
    reward = await parseQuestReward(connection, txSignature);
  } catch {
    printWarning("Failed to fetch transaction details. Please check manually later.");
    console.log(
      `  https://explorer.nara.build/tx/${txSignature}`
    );
    return;
  }

  if (reward.rewarded) {
    printSuccess(`Congratulations! Reward received: ${reward.rewardNso} NARA (winner ${reward.winner})`);
    if (options.json) {
      formatOutput(
        {
          signature: txSignature,
          rewarded: true,
          rewardLamports: reward.rewardLamports,
          rewardNso: reward.rewardNso,
          winner: reward.winner,
        },
        true
      );
    }
  } else {
    printWarning("Correct answer, but no reward — all reward slots have been claimed");
    if (options.json) {
      formatOutput(
        { signature: txSignature, rewarded: false, rewardLamports: 0 },
        true
      );
    }
  }
}

// ─── Error handling ──────────────────────────────────────────────
function handleSubmitError(err: any) {
  const errCode = anchorErrorCode(err);
  switch (errCode) {
    case "alreadyAnswered":
      printWarning("You have already answered this round");
      break;
    case "deadlineExpired":
      printError("Quest has expired");
      break;
    case "invalidProof":
      printError("Wrong answer (ZK proof verification failed)");
      break;
    case "poolNotActive":
      printError("No active quest at the moment");
      break;
    case "unstakeNotReady":
      printError("Cannot unstake until round advances or deadline passes");
      break;
    case "insufficientStakeBalance":
      printError("Unstake amount exceeds staked balance");
      break;
    default:
      printError(`Failed to submit answer: ${err.message ?? String(err)}`);
      if (err.logs) {
        console.log("  Logs:");
        err.logs.slice(-5).forEach((l: string) => console.log(`    ${l}`));
      }
  }
  process.exit(1);
}

// ─── Register commands ───────────────────────────────────────────
export function registerQuestCommands(program: Command): void {
  const quest = program
    .command("quest")
    .description("PoMI quest commands — mine NARA by answering on-chain quests with ZK proofs");

  // quest get
  quest
    .command("get")
    .description("Get current quest info (question, deadline, difficulty, stake requirement)")
    .option("-v, --verbose", "Show stake details even when not required")
    .action(async (opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleQuestGet({ ...globalOpts, verbose: opts.verbose });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // quest answer
  quest
    .command("answer <answer>")
    .description("Submit a quest answer with ZK proof. Generates a proof locally and submits on-chain. Use --relay when balance is 0 (gasless). Always pass --agent and --model for reward tracking.")
    .option("--relay [url]", `Submit via gasless relay (default: ${DEFAULT_QUEST_RELAY_URL}, backup: https://quest2-api.nara.build/)`)
    .option("--agent <name>", "Agent/platform type: claude-code, cursor, chatgpt, openclaw, etc. (default: naracli)")
    .option("--model <name>", "AI model used: claude-opus-4-6, claude-sonnet-4-6, gpt-4o, etc.")
    .option("--referral <agent-id>", "Referral agent ID for earning referral points")
    .option("--stake [amount]", 'Stake NARA in the same tx ("auto" to top-up to requirement, or an exact amount)')
    .action(async (answer: string, opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        const relayUrl = opts.relay === true ? DEFAULT_QUEST_RELAY_URL : opts.relay;
        const stakeVal = opts.stake === true ? "auto" : opts.stake;
        await handleQuestAnswer(answer, { ...globalOpts, relay: relayUrl, agent: opts.agent, model: opts.model, referral: opts.referral, stake: stakeVal });
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // quest config
  quest
    .command("config")
    .description("Show quest program config (reward counts, stake params, decay, intervals)")
    .action(async (_opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleQuestConfig(globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // quest stake
  quest
    .command("stake <amount>")
    .description("Stake NARA to participate in quests")
    .action(async (amount: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleQuestStake(amount, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // quest unstake
  quest
    .command("unstake <amount>")
    .description("Unstake NARA (available after round advances or deadline passes)")
    .action(async (amount: string, _opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleQuestUnstake(amount, globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });

  // quest stake-info
  quest
    .command("stake-info")
    .description("Get your current quest stake info")
    .action(async (_opts: any, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
        await handleQuestStakeInfo(globalOpts);
      } catch (error: any) {
        printError(error.message);
        process.exit(1);
      }
    });
}
