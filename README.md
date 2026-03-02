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

```text
address                              Show wallet address
balance [address]                    Check NSO balance
token-balance <token-address>        Check token balance
tx-status <signature>                Check transaction status
transfer <to> <amount>               Transfer NSO
transfer-token <token> <to> <amount> Transfer tokens
sign <base64-tx> [--send]            Sign (and optionally send) a transaction
wallet create                        Create a new wallet
wallet import                        Import wallet from mnemonic or private key
quest get                            Get current quest info
quest answer <answer>                Submit answer with ZK proof
```

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

# Sign and send an exported transaction
npx naracli sign <base64-tx> --send

# Answer a quest
npx naracli quest get
npx naracli quest answer "your answer"
```

## SDK

For programmatic usage, install [nara-sdk](https://www.npmjs.com/package/nara-sdk) directly:

```bash
npm install nara-sdk
```

## License

MIT
