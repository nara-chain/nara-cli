# Nara CLI

Command-line interface for the Nara chain (Solana-compatible). Built on [nara-sdk](https://www.npmjs.com/package/nara-sdk).

## Installation

```bash
npx naracli --help
```

## Setup

```bash
# Create a new wallet
npx naracli wallet create

# Or import from mnemonic / private key
npx naracli wallet import -m "your twelve word mnemonic phrase ..."
npx naracli wallet import -k "your-private-key"
```

Wallet is saved to `~/.config/nara/id.json` by default.

## Commands

### Wallet & Account

| Command | Description |
| ------- | ----------- |
| `wallet create` | Create a new wallet |
| `wallet import` | Import wallet from mnemonic or private key |
| `address` | Show wallet address |
| `balance [address]` | Check NARA balance |
| `token-balance <token-address>` | Check token balance |

### Transactions

| Command | Description |
| ------- | ----------- |
| `transfer <to> <amount>` | Transfer NARA |
| `transfer-token <token> <to> <amount>` | Transfer tokens |
| `sign <base64-tx> [--send]` | Sign (and optionally send) a transaction |
| `tx-status <signature>` | Check transaction status |

### Quest

| Command | Description |
| ------- | ----------- |
| `quest get` | Get current quest info |
| `quest answer <answer>` | Submit answer with ZK proof |

### Skills Hub

| Command | Description |
| ------- | ----------- |
| `skills register <name> <author>` | Register a new skill on-chain |
| `skills get <name>` | Get skill info (record, description, metadata) |
| `skills content <name>` | Read skill content (`--hex` for hex output) |
| `skills set-description <name> <desc>` | Set or update skill description (max 512 bytes) |
| `skills set-metadata <name> <json>` | Set or update skill JSON metadata (max 800 bytes) |
| `skills upload <name> <file>` | Upload skill content from a local file (chunked) |
| `skills transfer <name> <new-authority>` | Transfer skill authority to a new address |
| `skills close-buffer <name>` | Close a pending upload buffer and reclaim rent |
| `skills delete <name>` | Delete a skill and reclaim all rent |

### ZK Identity

| Command | Description |
| ------- | ----------- |
| `zkid create <name>` | Register a new ZK ID on-chain |
| `zkid info <name>` | Query ZK ID account info (read-only) |
| `zkid deposit <name> <amount>` | Deposit NARA into ZK ID (1 / 10 / 100 / 1000 / 10000 / 100000) |
| `zkid scan <name>` | Scan for claimable deposits |
| `zkid withdraw <name>` | Anonymously withdraw a deposit (`--recipient <addr>`) |
| `zkid id-commitment <name>` | Output idCommitment hex for this wallet + name |
| `zkid transfer <name> <commitment>` | Transfer ZK ID ownership to a new commitment holder |

Run `npx naracli <command> --help` for details.

### Global Options

| Option                | Description                 |
| --------------------- | --------------------------- |
| `-r, --rpc-url <url>` | RPC endpoint URL            |
| `-w, --wallet <path>` | Path to wallet keypair JSON |
| `-j, --json`          | Output in JSON format       |

## Quick Example

```bash
# Check balance
npx naracli balance

# Answer a quest
npx naracli quest get
npx naracli quest answer "your answer"

# Register and populate a skill
npx naracli skills register my-skill "Alice"
npx naracli skills set-description my-skill "What this skill does"
npx naracli skills upload my-skill ./skill.md
npx naracli skills get my-skill

# ZK anonymous transfers
npx naracli zkid create my-id
npx naracli zkid deposit my-id 10
npx naracli zkid scan my-id
npx naracli zkid withdraw my-id
```

## SDK

For programmatic usage, install [nara-sdk](https://www.npmjs.com/package/nara-sdk) directly:

```bash
npm install nara-sdk
```

## License

MIT
