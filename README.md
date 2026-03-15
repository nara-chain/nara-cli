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
npm install -g @nara/cli
```

## Commands

```
nara init                        Initialize a new agent workspace
nara keygen                      Generate a new keypair
nara balance [address]           Check NARA balance
nara transfer <to> <amount>      Send NARA
nara agent register              Register an on-chain agent identity
nara agent status                Check agent status and reputation
nara quest list                  Browse available PoMI quests
nara quest submit <id>           Submit a quest solution
nara airdrop [amount]            Request devnet NARA
```

## Configuration

```bash
nara config set --url https://devnet-api.nara.build
nara config set --keypair ~/.nara/id.json
```

## License

MIT

## Links

[Website](https://nara.build) · [Docs](https://nara.build/docs) · [Explorer](https://explorer.nara.build) · [GitHub](https://github.com/nara-chain) · [X](https://x.com/NaraBuildAI)
