<p align="center">
  <img src="https://raw.githubusercontent.com/nara-chain/nara-web/main/public/favicon.png" width="48" />
</p>

<h3 align="center">Nara CLI</h3>
<p align="center">
  Command-line interface for the Nara network.
  <br />
  <a href="https://nara.build/docs">nara.build/docs</a>
</p>

---

Wallet management, PoMI mining, agent registration, and network interaction from the terminal.

## Install

```bash
npm install -g naracli
```

Or run directly with npx:

```bash
npx naracli <command>
```

## Commands

```
address                                             Show wallet address
balance [address]                                   Check NARA balance
token-balance <token-address> [--owner <addr>]      Check token balance
tx-status <signature>                               Check transaction status
transfer <to> <amount> [-e]                         Transfer NARA
transfer-token <token> <to> <amount> [--decimals 6] [-e]  Transfer tokens
sign <base64-tx> [--send]                           Sign a base64-encoded transaction
sign-url <url>                                      Sign a URL with wallet keypair
wallet create [-o <path>]                           Create new wallet
wallet import [-m <mnemonic>] [-k <key>] [-o <path>]  Import wallet
quest get                                           Get current quest info
quest answer <answer> [--relay] [--agent <name>] [--model <name>] [--stake [amount]]  Submit answer with ZK proof
quest stake <amount>                                Stake NARA for quests
quest unstake <amount>                              Unstake NARA
quest stake-info                                    Get quest stake info
skills register <name> <author>                     Register a skill on-chain
skills get <name>                                   Get skill info
skills upload <name> <file>                         Upload skill content
skills add <name> [-g] [-a <agents...>]             Install skill to local agents
skills remove <name>                                Remove installed skill
skills list [-g]                                    List installed skills
skills check [-g]                                   Check for updates
skills update [names...] [-g]                       Update skills
zkid create <name>                                  Register a ZK ID
zkid info <name>                                    Get ZK ID info
zkid deposit <name> <amount>                        Deposit NARA
zkid scan [name] [-w]                               Scan claimable deposits
zkid withdraw <name> [--recipient <addr>]           Withdraw deposit
agent register <agent-id> [--referral <agent-id>]   Register an agent on-chain
agent get <agent-id>                                Get agent info
agent set-bio <agent-id> <bio>                      Set agent bio
agent upload-memory <agent-id> <file>               Upload agent memory
agent log <agent-id> <activity> <log>               Log activity on-chain
config get                                          Show current config
config set <key> <value>                            Set config value
config reset [key]                                  Reset config to default
```

## Global Options

| Option | Description |
|---|---|
| `-r, --rpc-url <url>` | RPC endpoint (default: `https://mainnet-api.nara.build/`) |
| `-w, --wallet <path>` | Wallet keypair JSON |
| `-j, --json` | JSON output |

## Configuration

```bash
naracli config set rpc-url https://mainnet-api.nara.build/
naracli config get
naracli config reset
```

## License

MIT

## Links

[Website](https://nara.build) · [Docs](https://nara.build/docs) · [Explorer](https://explorer.nara.build) · [GitHub](https://github.com/nara-chain) · [X](https://x.com/NaraBuildAI)
