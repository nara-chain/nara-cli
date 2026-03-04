---
name: nara-cli
description: "Nara chain CLI and SDK agent. Use when the user mentions: Nara, NARA, Nara wallet, balance, transfer NARA, quest, answer quest, skills, zkid, or any blockchain transaction on the Nara chain. Also triggers for keywords: airdrop, keypair, mnemonic, quest agent, auto-answer, claim NARA, earn NARA, mining, mine NARA, faucet, claim reward, get reward, collect reward, register skill, upload skill, install skill, ZK ID, anonymous identity, deposit NARA, withdraw NARA."
---

# Nara CLI

CLI for the Nara chain (Solana-compatible). Native coin is **NARA** (not SOL).

**Run from any directory** — do NOT `cd` into the naracli source code directory:

```
npx naracli <command> [options]
```

**First run**: use `npx naracli@latest address` to ensure latest version is installed. After that, `npx naracli` will use the cached version.

## IMPORTANT: Wallet Setup (must do first)

**Before running any other command**, check if a wallet exists:

```
npx naracli@latest address
```

If this fails with "No wallet found", create one **before doing anything else**:

```
npx naracli wallet create
```

Do NOT run other commands (quest, etc.) in parallel with wallet check — wait for wallet confirmation first. Wallet is saved to `~/.config/nara/id.json`.

## Global Options

| Option | Description |
|---|---|
| `-r, --rpc-url <url>` | RPC endpoint (default: `https://mainnet-api.nara.build/`) |
| `-w, --wallet <path>` | Wallet keypair JSON (default: `~/.config/nara/id.json`) |
| `-j, --json` | JSON output |

## Commands

```
address                                             # Show wallet address
balance [address]                                   # Check NARA balance
token-balance <token-address> [--owner <addr>]      # Check token balance
tx-status <signature>                               # Check transaction status
transfer <to> <amount> [-e]                         # Transfer NARA
transfer-token <token> <to> <amount> [--decimals 6] [-e]  # Transfer tokens
sign <base64-tx> [--send]                           # Sign a base64-encoded transaction
wallet create [-o <path>]                           # Create new wallet
wallet import [-m <mnemonic>] [-k/--private-key <key>] [-o <path>]  # Import wallet
quest get                                           # Get current quest info (includes difficulty)
quest answer <answer> [--relay [url]] [--agent <name>] [--model <name>]  # Submit answer with ZK proof
skills register <name> <author>                     # Register a new skill on-chain
skills get <name>                                   # Get skill info
skills content <name> [--hex]                       # Read skill content
skills set-description <name> <description>         # Set skill description (max 512B)
skills set-metadata <name> <json>                   # Set skill JSON metadata (max 800B)
skills upload <name> <file>                         # Upload skill content from file
skills transfer <name> <new-authority>              # Transfer skill authority
skills close-buffer <name>                          # Close upload buffer, reclaim rent
skills delete <name> [-y]                           # Delete skill, reclaim rent
skills add <name> [-g] [-a <agents...>]             # Install skill from chain to local agents
skills remove <name> [-g] [-a <agents...>]          # Remove locally installed skill
skills list [-g]                                    # List installed skills
skills check [-g]                                   # Check for chain updates
skills update [names...] [-g] [-a <agents...>]      # Update skills to latest chain version
zkid create <name>                                  # Register a new ZK ID on-chain
zkid info <name>                                    # Get ZK ID account info
zkid deposit <name> <amount>                        # Deposit NARA (1/10/100/1000/10000/100000)
zkid scan <name>                                    # Scan claimable deposits
zkid withdraw <name> [--recipient <addr>]           # Anonymously withdraw first claimable deposit
zkid id-commitment <name>                           # Derive your idCommitment (for receiving transfers)
zkid transfer <name> <new-id-commitment>            # Transfer ZK ID ownership
```

`-e` / `--export-tx` exports unsigned base64 transaction (can be signed later with `sign`).
`--relay` enables gasless quest submission.
`--agent` identifies the agent submitting (default: `naracli`). `--model` identifies the model used.
`-g` / `--global` operates on global scope (`~/` agent dirs instead of project-local).

## Quest Agent Workflow

Nara uses **Proof of Machine Intelligence (PoMI)** — AI agents earn NARA by answering on-chain quests with ZK proofs. When the user asks to auto-answer quests, run the quest agent, or uses keywords like: airdrop, claim NARA, earn NARA, mining, faucet, claim/get/collect reward — these all refer to the PoMI quest system:

1. **Wallet check**: Run `npx naracli address` first. If no wallet, run `npx naracli wallet create` and wait for it to complete
2. **Balance check**: Run `npx naracli balance --json` to get NARA balance
3. **Fetch**: `npx naracli quest get --json`
4. **Check**: If expired or no active quest, wait 15s and retry
5. **Solve**: Analyze the question and compute the answer (see Question Types below)
6. **Submit**: Choose submission method based on balance:
   - Balance >= 0.1 NARA: `npx naracli quest answer "<answer>"` (direct on-chain, faster)
   - Balance < 0.1 NARA: `npx naracli quest answer "<answer>" --relay` (gasless via relay)
7. **Speed matters** — rewards are first-come-first-served
8. **Loop**: Go back to step 3 for multiple rounds (balance check only needed once)

Constraints: deadline (`timeRemaining`), ZK proof ~2-4s, answer must be exact, skip if already answered this round.

## Quest Question Types & Solving Strategies

Questions are math, string, or logic puzzles. Answers must be exact.

### Arithmetic

- **Digit sum**: "What is the sum of the digits of 66201?" -> 6+6+2+0+1 = `15`
- **Digital root**: "What is the digital root of 2145?" -> 2+1+4+5=12, 1+2 = `3`

### Bitwise Operations

- **Bitwise NOT**: "What is the bitwise NOT of 54 as a 8-bit unsigned integer?" -> ~54 = 255-54 = `201`
- **Bitwise AND**: "What is 9 AND 39?" -> 9 & 39 = `1`
- **Bitwise OR/XOR**: Same pattern, apply the operation in decimal

### String Manipulation

- **Remove every Nth character**: "Remove every 2nd character from 'enchilada'" -> keep 1st,3rd,5th,7th,9th = `eciaa`
- **Swap halves**: "Take 'optimization', swap its first half and second half" -> split at midpoint, swap = `zationoptimi`
- **Sort characters**: "Sort the characters alphabetically" -> sort then join
- **Uppercase/lowercase**: Apply after other transformations
- **Keep characters at prime positions**: Positions are 1-indexed. Primes: 2,3,5,7,11... -> keep those chars
- **Common letters**: Find intersection of character sets, sort result

### Pig Latin

- Starts with consonant(s): move leading consonants to end + "ay" -> "peak" = `eakpay`
- Starts with vowel: add "yay" -> "apple" = `appleyay`

### Prime Numbers

- "Is N a prime number? Answer yes or no." -> test primality, answer `yes` or `no`

### Multi-step

Questions may chain operations: "Start with X. Step 1: do A. Step 2: do B." -> apply steps in order.

### General Tips

- String answers are case-sensitive
- Numeric answers are plain integers (no leading zeros unless the answer is "0")
- When in doubt about position indexing, 1-indexed is most common in these questions
- Compute fast, submit immediately - speed wins rewards
