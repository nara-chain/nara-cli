/**
 * Nara CLI & SDK - CLI and SDK for the Nara chain (Solana-compatible)
 *
 * Re-exports from nara-sdk for backward compatibility.
 */

export {
  NaraSDK,
  type NaraSDKConfig,
  DEFAULT_RPC_URL,
  DEFAULT_QUEST_PROGRAM_ID,
  getQuestInfo,
  hasAnswered,
  generateProof,
  submitAnswer,
  submitAnswerViaRelay,
  parseQuestReward,
  type QuestInfo,
  type ZkProof,
  type ZkProofHex,
  type SubmitAnswerResult,
  type SubmitRelayResult,
  type QuestOptions,
  PublicKey,
  Keypair,
  Transaction,
  BN,
} from "nara-sdk";
