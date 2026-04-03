/** Prefix lines for tweet content — describes what the user/agent is doing. */
const TWEET_PREFIXES = [
  "My AI agent is mining NARA for free on NaraChain",
  "My AI agent is earning crypto by solving on-chain quests",
  "My AI agent is working on-chain and earning rewards",
  "My AI agent just started PoMI mining on NaraChain",
  "My AI agent is mining NARA while I sleep",
  "My AI agent has an on-chain identity and is earning NARA",
  "My AI agent is solving ZK proof quests and getting paid",
  "My AI agent joined the NaraChain economy today",
  "My AI agent is earning NARA with zero gas fees",
  "My AI agent is registered on NaraChain and mining for free",
];

/** Slogan lines — describes NaraChain features/vision. */
const TWEET_SLOGANS = [
  "The first Layer 1 built for AI agents",
  "Where agents have on-chain identity, reputation, and income",
  "Mine NARA through Proof of Machine Intelligence, no hardware needed",
  "Agents are first-class citizens, not just wallets",
  "Earn first, spend on AI compute later",
  "On-chain identity, ZK privacy, and an agent economy in one chain",
  "PoMI mining: agents solve quests with ZK proofs to earn crypto",
  "Zero upfront cost, relay-powered gasless mining for AI agents",
  "Earn NARA, buy Claude/GPT API credits. AI agents fund themselves",
  "Agent-native blockchain with identity, registry, and service marketplace",
  "AgentX: where AI agents post, trade services, and build reputation",
  "The chain where autonomous agents earn, spend, and grow",
  "AI agents mine with intelligence, not GPUs",
  "From zero balance to earning NARA, completely free to start",
  "On-chain skills, agent memory, and ZK identity for every AI agent",
  "The blockchain where your AI works, earns, and pays for its own compute",
  "Register, mine, earn, spend. The full agent economy loop",
  "Your AI agent, your miner, your rewards",
  "Free PoMI mining powered by AI intelligence",
  "ZK Identity: anonymous on-chain accounts with zero-knowledge proofs",
  "Aapps — applications designed for agents, not just humans",
  "Agents with memory, skills, and reputation that grow over time",
  "A self-sustaining AI: mine, earn, buy compute, repeat",
  "The agent economy is here — identity, income, and services on one chain",
  "Not just a wallet — a full on-chain identity for your AI",
  "Where AI agents discover each other and trade services",
  "Built for the next billion agents, not just the next billion users",
  "A world where AI agents collaborate, compete, and create value together",
  "Building the economy that AI agents deserve",
  "Today one agent mines. Tomorrow millions trade, govern, and evolve",
  "The decentralized home for every AI agent on the internet",
  "Where agents go from tools to autonomous economic participants",
  "Infrastructure for the agent age — identity, work, and value on-chain",
];

const TWEET_SUFFIX = "#NaraChain @NaraBuildAI";

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Generate a random tweet for bind-twitter (includes agent ID). */
export function randomBindTweet(agentId: string): string {
  return `Claiming my AI agent "${agentId}" on #NaraChain @NaraBuildAI — ${pick(TWEET_SLOGANS)}`;
}

/** Generate a random tweet for submit-tweet (general promotion). */
export function randomSubmitTweet(): string {
  return `${pick(TWEET_PREFIXES)} — ${pick(TWEET_SLOGANS)} ${TWEET_SUFFIX}`;
}
