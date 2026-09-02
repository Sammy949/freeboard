# Freeboard

**Prove your DeFi position is solvent without revealing it.**

A lender, an OTC desk or a counterparty wants to know your loan is not about to
be liquidated. Today the only way to show them is to hand over your position —
collateral, debt, the whole book. Freeboard replaces that with a zero-knowledge
proof on [Midnight](https://midnight.network): the circuit computes your
Aave-style health factor privately and discloses exactly one bit — **SAFE** or
**AT_RISK** — against a threshold the verifier chooses.

The numbers never leave your machine. The verdict is all that goes on-chain.

## Why this isn't security theater

A circuit over self-reported numbers proves only that you can do arithmetic. It
says nothing about whether the position is real, so it is worth nothing to a
counterparty.

So the position must arrive **signed by an attester**, and Freeboard verifies
that signature *inside the circuit*, before the health-factor math runs. The
verdict is therefore bound to a position an oracle actually observed. The
attester's public key is fixed at deployment and there is deliberately no
circuit to change it — an unauthenticated rotate would let a prover install
their own key and attest to their own numbers, which is the exact hole this
closes.

Signature scheme is Schnorr over JubJub, straight from the Compact standard
library. The signed payload is `[collateral, debt, liquidationThresholdBps,
asOf]`; `asOf` sits inside the signature, so an attestation cannot be
re-stamped and replayed forward.

## The math

Aave's health factor is `HF = (collateral × liquidationThreshold) / debt`.
Compact is integer-only and division is to be avoided, so checking `HF ≥ T`
becomes a cross-multiplication — with both sides in basis points the 10000s
cancel:

```
collateral × liquidationThresholdBps  ≥  minHealthFactorBps × debt
```

No division, no precision loss. `debt == 0` is an infinite health factor, so
trivially safe. The verdict enum is ordered `{ at_risk, safe }` so that the
default ledger value of `0` means **at_risk** — you are at risk until a proof
says otherwise.

## Status

Working end to end on a local ledger-9 devnet, as of 2026-08-29.

- ✅ **The contract works.** `contracts/freeboard.compact` compiles against
  Compact 0.34.0 with proving and verifier keys emitted, including the
  in-circuit Schnorr check.
- ✅ **Deploy, CLI and the e2e check are ported and verified on-chain.** A signed
  position produces a SAFE verdict, an under-collateralised one produces
  AT_RISK, and a position tampered with after signing is **rejected in-circuit**
  with no verdict written.
- ⚠️ **The attester is a mock oracle.** Its signing key lives on the same machine
  as the prover, so the check proves the *mechanism*, not that any position is
  real. Replacing it with an independent attester needs no contract change —
  that is why the check is in-circuit already. See `src/attester.ts`.
- 🚧 **Not deployed to a public testnet, and no web UI yet.**

### Try it

```bash
npm install
npm run devnet:start                 # ledger-9 devnet, waits for healthy
npm run compile                      # -> contracts/managed/freeboard/
npm run deploy -- --network undeployed-l9
npm run cli                          # interactive menu
```

Or non-interactively:

```bash
npx tsx src/cli.ts --read            # the verifier's view: verdict only
npx tsx src/cli.ts --check --read    # prove a position, then read the verdict
npx tsx src/cli.ts --check --collateral 1000000 --debt 900000 --threshold 8500 --min-hf 15000 --read
npx tsx src/cli.ts --check --tamper  # watch the in-circuit check reject it
npm run test:e2e                     # asserts the public state leaks no position
```

A real run against the devnet:

```
Position (PRIVATE): collateral=1000000 debt=400000 threshold=8500bps
Verifier threshold (PUBLIC): 15000bps
Health factor (local, display only): 2.1250

✅ Accepted. Verdict: ✅ SAFE

─── Public ledger state (all a verifier can see) ───
Verdict:          ✅ SAFE
Attestation asOf: 1787957676
Checks performed: 1
↳ note what is NOT here: no collateral, no debt, no threshold.
```

And the tampered case — collateral inflated ×1000 *after* signing:

```
⚠ TAMPERING: inflating collateral ×1000 after signing.
   signed collateral    = 1000000
   submitted collateral = 1000000000
Local signature check: INVALID

🛑 REJECTED IN-CIRCUIT: position is not signed by the registered attester.
   No verdict was written.
```

There is a version story behind the toolchain, and it is not a small one: every
installable Compact compiler emits runtime 0.19.x, while the current stable SDK
hard-pins 0.16.0. Freeboard therefore runs the 5.0.0-beta SDK deliberately, on a
devnet assembled from pre-release images that upstream publishes no matrix for.
`notes/03-midnight-toolchain.md` has the full investigation, including two
failures worth knowing about if you rebuild this stack.

## Repo layout

```
freeboard/
├── contracts/
│   └── freeboard.compact           # the contract — this is the product
├── notes/                          # design + research, written as we go
│   ├── 01-concept-and-pitch.md
│   ├── 02-architecture.md
│   ├── 03-midnight-toolchain.md    # version skew, the beta-SDK decision
│   └── 04-roadmap-and-open-questions.md
├── src/
│   ├── attester.ts                 # the mock oracle: signs positions
│   ├── witnesses.ts                # how a position reaches the circuit
│   ├── deploy.ts                   # deploys, fixing the attester key
│   ├── cli.ts                      # run checks, read verdicts
│   └── network.ts, wallet.ts, …    # network config + wallet glue
├── patches/cross-fetch/            # shim; see the file for why
├── docker-compose.yml              # ledger-8 devnet (known good, but too old)
└── docker-compose.ledger9.yml      # ledger-9 devnet (what 0.34.0 needs)
```

Built for Midnight Wave 1. The contract is the product; the CLI comes with it;
a web dashboard is the demo skin.

---

# Scaffold documentation

Everything below is inherited `create-mn-app` documentation. Most of it still
applies (networks, wallets, env overrides); the parts describing a
`hello-world` contract do not.

## Quick start

Requirements: Node 22, Docker (with Compose v2), and the Compact compiler at the version pinned in `.compact-version` at the create-mn-app repo root (the version this project was scaffolded against).

```bash
npm install
npm run setup
npm run test:e2e
```

`npm run setup` runs end-to-end with no prompts:

1. `docker compose -f <network's compose file> up -d --wait` — starts a local Midnight devnet (node, indexer, proof-server) and blocks until all three pass their healthchecks.
2. `npm run compile` — compiles `contracts/freeboard.compact` to `contracts/managed/freeboard/`.
3. `npm run deploy` — derives the genesis-seed wallet (NIGHT pre-minted), registers UTXOs for DUST generation, loads or generates the attester key, deploys the contract with that key as its constructor argument, writes `.midnight-state.json`.

`npm run test:e2e` reconnects to the deployed contract, reads its ledger state, and asserts the public state carries a verdict and no position data. Exits 0 on success.

## Local devnets

Two stacks ship with the project. Ports differ so both can run at once.

| Service        | ledger-9 (`docker-compose.ledger9.yml`) | ledger-8 (`docker-compose.yml`) |
| -------------- | --------------------------------------- | ------------------------------- |
| `node`         | 19944                                   | 9944                            |
| `indexer`      | 18088                                   | 8088                            |
| `proof-server` | 16300                                   | 6300                            |

The ledger-9 stack is the one Freeboard needs. Shortcuts:

```bash
npm run devnet:start     # ledger-9 stack, waits for healthy
npm run devnet:stop
npm run devnet:clean     # also drops volumes
```

State lives in container-managed volumes. `devnet:clean` (or `docker compose
-f <file> down -v`) removes all containers, networks, and volumes, so the next
`npm run setup` starts from a clean slate.

## ⚠️ LOCAL DEVNET ONLY

The deploy script uses a well-known genesis seed (`0000…0001`) so the
pre-minted NIGHT in the `dev` chain preset is immediately available. **Do
not use this seed against Preprod, mainnet, or any environment that
handles real value** — anyone running this devnet has full access to
funds at this seed.

## Networks

Four networks. Note there are **two local devnets** — they run different ledger
versions, so which one you want depends on which compiler built your contract.

| Network | When to use | Default? |
|---|---|---|
| `undeployed-l9` | Ledger-9 devnet (`docker-compose.ledger9.yml`, ports +10000). What compiler 0.34.0 targets, so this is where Freeboard deploys. Genesis seed, no funding needed. | yes |
| `undeployed` | Ledger-8 devnet (`docker-compose.yml`). The combination upstream actually tests, but it **cannot run a 0.34.0-compiled contract**. Kept as the known-good fallback. | |
| `preview` | Public preview testnet. Faucet at `https://midnight-tmnight-preview.nethermind.dev`. |  |
| `preprod` | Public preprod testnet. Faucet at `https://midnight-tmnight-preprod.nethermind.dev`. |  |

The two devnets are separate networks rather than one with a switch, because
they are genuinely different chains: each keeps its own deploy record and wallet
sync cache, and a contract address from one means nothing on the other. Both
speak the `undeployed` protocol network id on the wire.

The active network is **sticky**: whichever network you last interacted
with stays active until you switch. Any command run with `--network <name>`
also sets that network active for subsequent commands. The default on a
fresh project is `undeployed-l9`.

```sh
npm run setup -- --network preview   # runs on preview AND makes it active
npm run cli                          # still uses preview
npm run check-balance                # still uses preview
```

You can also switch without running anything else:

```sh
npm run network preview         # active network is now preview
npm run network                 # prints current active network
npm run network undeployed-l9   # switch back to the ledger-9 devnet
```

### How wallets work across networks

- Both devnets use a hardcoded genesis seed, pre-funded by the `dev` preset.
- `preview` and `preprod` generate a fresh wallet on first use: a 24-word
  BIP-39 recovery phrase (printed once) plus its derived seed, both stored
  in `.midnight-state.json` (gitignored). The wallet survives switching
  networks — switch back later and your funded wallet returns.
- **Back up your recovery phrase** if you fund a public-network wallet you
  care about. It is printed when the wallet is created and kept in
  `.midnight-state.json` under `wallets.<network>.mnemonic`. Anyone holding
  the phrase controls the wallet.
- Wallets created before mnemonic support keep working from their stored
  `seed`; they just have no phrase to import into Lace.

### Using the same wallet as Lace

Seeds are derived with the standard BIP-39 `mnemonicToSeed` step — the same
convention Lace uses — so identity is portable in both directions:

- **Bring your Lace wallet here**: pass your recovery phrase via the
  `MIDNIGHT_WALLET_MNEMONIC` env var — the derived addresses match Lace.
  To keep the phrase out of your shell history, enter it with a hidden
  prompt instead of typing it inline:

  ```bash
  read -s MIDNIGHT_WALLET_MNEMONIC && export MIDNIGHT_WALLET_MNEMONIC
  npm run deploy
  ```
- **Take a scaffold wallet to Lace**: restore Lace from the 24-word phrase
  in `.midnight-state.json`.

### Funding a public-network wallet

On the first run with `--network preview` (or `preprod`):

1. `setup` will print your wallet address and the faucet URL.
2. Open the faucet URL, paste the address, request tNIGHT.
3. `setup` polls the wallet balance every 10 s and continues automatically
   once funds arrive.
4. The default poll budget is 10 minutes. Override with
   `MIDNIGHT_FAUCET_TIMEOUT_MS=1800000` (30 min) for unattended runs.

If the faucet is slow or the script times out, your seed is preserved.
Re-run `npm run setup -- --network preview` once the funds land.

### Environment overrides

These env vars override the active network's config (no per-network
suffix — they apply to whichever network is active for the run):

| Variable | Effect |
|---|---|
| `MIDNIGHT_WALLET_SEED` | Use this hex seed (32-128 hex chars; a Lace-compatible BIP-39 seed is 128) instead of generating/persisting one. Useful for CI with a pre-funded wallet. |
| `MIDNIGHT_WALLET_MNEMONIC` | Use this BIP-39 recovery phrase instead of generating a wallet — e.g. your Lace phrase, for the same addresses as Lace. Not persisted. Set only one of seed/mnemonic. |
| `MIDNIGHT_INDEXER_URL` | Override the indexer GraphQL URL. |
| `MIDNIGHT_INDEXER_WS_URL` | Override the indexer WS URL. |
| `MIDNIGHT_NODE_URL` | Override the node RPC URL. |
| `MIDNIGHT_FAUCET_URL` | Override the faucet URL printed during setup. |
| `MIDNIGHT_PROOF_SERVER_URL` | Override the proof server URL — set to a public proof server (e.g. `https://lace-proof-pub.preview.midnight.network`) to skip running one locally. |
| `MIDNIGHT_FAUCET_TIMEOUT_MS` | Faucet poll budget in milliseconds (default 600000 = 10 min). |

By default all networks use the **local** proof server. Public proof
servers exist (see the env override above) but the local default keeps
your witness data on your machine and avoids depending on a remote
service for the deploy hot path.

### Switching back to local devnet

```sh
npm run network undeployed-l9  # or: npm run setup -- --network undeployed-l9
```

Your preview/preprod wallet seeds and deploy addresses stay in
`.midnight-state.json`. Switch back later, and they're still there.

### Wallet sync cache

After each `deploy`, `cli`, or `check-balance` run, the scripts serialize the
wallet's synced state to `.midnight-wallet-state/<network>/` (gitignored).
The next run on the same network restores from that snapshot and only catches
up to the latest block instead of replaying from genesis — meaningful on
`preview` / `preprod` where a from-seed sync takes minutes.

If the cache is stale or corrupt (e.g. after an SDK upgrade with an
incompatible state format) the wallet falls back to a fresh from-seed sync
with a one-line warning. `npm run clean` removes the cache along with other
generated state.

## Available scripts

| Script                  | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `npm run setup`         | One-shot: start devnet, compile, deploy.                       |
| `npm run compile`       | Compile the Compact contract.                                  |
| `npm run deploy`        | Deploy the compiled contract (requires devnet up + compiled).  |
| `npm run cli`           | Run solvency checks / read verdicts. Interactive, or `--check` / `--read` / `--tamper` for one-shot. |
| `npm run serve`         | Local HTTP service over the same client, for the web demo. **Loopback only, no auth** — it holds the attester signing key. One synced wallet per process; checks are serialized. |
| `npm run check-balance` | Print the genesis-seed wallet's NIGHT and DUST balances.       |
| `npm run test:cache`    | Pure check on wallet-cache chain binding. No devnet needed.    |
| `npm run test:e2e`      | Read-back check: contract is live, and its public state leaks no position. |
| `npm run clean`         | Remove `contracts/managed/`, `.midnight-state.json`, `.midnight-attester.json`, and `.midnight-wallet-state/`. |
| `npm run devnet:start` / `:stop` / `:clean` | Ledger-9 devnet lifecycle (`:clean` also drops volumes). |
| `npm run devnet:ps`     | Show every freeboard container, both stacks, running or not.   |
| `npm run devnet:stop-all` | Bring down both stacks. Use this if you are unsure what is up. |
| `npm run devnet8:start` / `:stop` | Ledger-8 fallback stack. **Never run alongside the ledger-9 stack** — two nodes, two indexers and two proof servers will exhaust a typical dev machine. Was named `proof-server:start`, which implied it started only a proof server; it starts all three services. |

(See **Repo layout** near the top for the current structure.)

## Compact compiler version

`.compact-version` at the create-mn-app repo root pinned the compiler
version this project was scaffolded against. To upgrade your local
compiler to that version:

```bash
compact update <version>
compact use <version>
```
