# Midnight toolchain — accurate setup (from docs, 2026-08-27)

Sources:
- Quickstart: https://docs.midnight.network/getting-started/quickstart
- ZK Loan contract (our template): https://docs.midnight.network/tutorials/zk-loan/smart-contract
- Local proving: https://docs.midnight.network/guides/local-proving
- Starter templates: Edda (full-stack monorepo), MeshJS/midnight-starter-template,
  OpenZeppelin/midnight-apps

## Prerequisites
- **Compact compiler** — install via Midnight toolchain instructions. (NOT yet installed.)
- **Docker Desktop** running, with **Docker Compose v2**. (NOT installed on this machine.)
- **Node.js 22+**. (Have v24.17.0 — OK.)
- Lace wallet: NOT needed for local devnet. Only for public testnets, and even then the
  CLI generates a wallet for you.

## Scaffold commands
```
npx create-mn-app [project-name]
```
Prompts:
1. Project type: **Contract** (minimal — compile+deploy a Compact contract; recommended
   to start) or **Full DApp** (adds React/Vite frontend).
2. Template: `hello-world` (default) or `battleship`. Only `hello-world` ships the bundled
   devnet. Other templates via flag: `bboard`, `leaderboard`.

Shortcuts / flags:
```
npx create-mn-app my-app                      # default hello-world
npx create-mn-app my-app --template battleship
npx create-mn-app my-app --template bboard
npx create-mn-app my-app --template leaderboard
```
Useful flags: `-t/--template`, `--list`, `--from <owner/repo>`, `--network <name>`,
`-y` (accept defaults), `--dry-run`, `--use-npm/yarn/pnpm/bun`, `--skip-install`,
`--skip-git`, `--verbose`.

## Run
```
cd freeboard-app
npm run setup        # boots local devnet (node + indexer + proof server), compiles, deploys
npm run cli          # interact with deployed contract
npm run test:e2e     # read ledger state directly (optional)
```

## Networks
- `undeployed` (local default), `preview`, `preprod`.
- Public testnet: `npm run setup -- --network preview` (or `preprod`), then fund the
  generated wallet via the printed faucet URL. Switch later: `npm run network <name>`.

## Contract-type project structure (hello-world)
```
my-app/
├── contracts/
│   └── hello-world.compact     # the Compact contract
├── src/
│   ├── cli.ts                  # interact with deployed contract
│   ├── deploy.ts               # deploy
│   └── check-balance.ts        # wallet balance
├── docker-compose.yml          # local devnet: node, indexer, PROOF SERVER
├── package.json
└── .midnight-state.json        # deploy state (contract address, network) — gitignored
```

## Folder plan — SETTLED
The scaffold sits at the repo root with `notes/` alongside it. (`create-mn-app` creates a
named subdir and may refuse a non-empty target; the alternative considered was
`freeboard/app/` with notes top-level.) Root won; hello-world is fully replaced.

## Environment state on this machine (re-checked 2026-08-28)
- node v24.17.0 ✅   npm 11.13.0 ✅   npx present ✅
- docker **29.7.2 ✅ daemon running** (Ubuntu 26.04 LTS), **compose v5.5.0 ✅**
  — the 2026-08-27 "docker MISSING" note is stale; it is installed and working.
  927G free on /var/lib/docker.
- compact devtools 0.5.2 ✅, compiler 0.34.0 ✅ (default)
- Devnet images present locally: node 1.0.0, indexer-standalone 4.3.3,
  proof-server 8.1.0 (the ledger-8 set) + proof-server 9.0.0-rc.6 (ledger-9, pulled
  2026-08-28). Docker Hub pulls on this box are SLOW and TLS-timeout often — retry
  loops needed, budget many minutes per image.

## Git
When we init: use SSH remote `git@github.com:...` (Samuel's standing preference), not https.

## ⚠ Version skew & the intentional beta-SDK decision (2026-08-28)

The create-mn-app scaffold pins the latest STABLE SDK, which is INCOMPATIBLE with the
only installable Compact compilers. Facts established this session:

- Installed compiler: `compact` devtools 0.5.2, compiler **0.34.0** (latest, 2026-08-25,
  Compact language 0.26.0). Every installable compiler (tested 0.22.0 → 0.34.0) emits
  contracts that call `checkRuntimeVersion('0.19.0')`. Compiler 0.18.2/0.19.0 are delisted
  and won't install via `compact update`. So there is NO installable compiler that emits
  runtime 0.16.0 — the floor is 0.19.x.
- Stable SDK (what create-mn-app ships): midnight-js **4.1.1** → compact-js 2.5.1 →
  compact-runtime **0.16.0** (hard exact pin). No compact-js in 2.5.x uses 0.19.0 except
  2.5.5-rc.8 (which only ships inside the 5.0.0-beta.7 chain).
- Version gate (`compact-runtime/dist/version.js` `checkRuntimeVersion`) requires an exact
  minor match for 0.x (prerelease tags stripped): 0.19.0-compiled code needs a 0.19.x
  runtime; 0.16.0/0.18.x are rejected.
- Proved incompatibility empirically: forced runtime→0.19.0 under the 4.1.1 SDK; it passed
  the gate, synced the wallet, prepped DUST, then failed building the deploy tx with
  `InvalidData at keys.signing: Expected string, actual {tag:"schnorr",...}`. Runtime 0.19
  switched signing keys to a Schnorr-tagged format the 4.1.1 protocol/wallet layer can't read.

**DECISION (Samuel, 2026-08-28): Freeboard is intentionally on the 5.0.0-beta SDK.**
Not an oversight or a stray "latest" grab. It is the only stack that (a) is consistent with
the installable Compact compiler and (b) supports the modern Compact language features
Freeboard needs — specifically the stdlib Schnorr-over-JubJub primitives
(`jubjubSchnorrVerify`, `JubjubSchnorrSignature`, `JubjubPoint`) that carry the in-circuit
oracle-attestation check which is the anti-theater core of the design ([[02-architecture]]).
(These are first-class CompactStandardLibrary primitives in runtime 0.19.0. The
`import "schnorr"` module the tutorial uses is that tutorial's own wrapper and does not
exist — a confirmed dead end. Exact compiler-verified signatures are in [[04-roadmap-and-open-questions]].)
Pinning back to the stable 0.16.0 SDK is impossible (no compiler emits 0.16.0) and would
strand Schnorr anyway. Revisit when 5.x goes stable.

The aligned pin set:
- all @midnight-ntwrk/midnight-js-* → 5.0.0-beta.7 (adds `effect` ^3.22.1 + Effect-Schema,
  ledger-v9 1.0.0-rc.3, onchain-runtime-v4 4.0.0-rc.3)
- compact-js 2.5.5-rc.8, compact-runtime 0.19.0-rc.0
- wallet-sdk 1.2.0 → 2.0.0-beta.2 (different sub-package graph: facade 5.0.0-beta.2,
  hd 3.1.0-beta.1, shielded/unshielded/dust 4–5.x betas)

Notes for whoever does the port:
- create-mn-app v0.5.0 has NO beta channel — a fresh scaffold reproduces the identical
  broken pins. No ready-made 5.x scaffold to lift plumbing from; the port is hand-done.
- Scope is NOT just deploy.ts/cli.ts renames — it crosses wallet-sdk 1.x→2.x (rewrites
  src/wallet.ts glue) and ledger v8→v9.
- The Compact COMPILER works standalone: `compact compile` needs no npm SDK, so
  `freeboard.compact` can be written, compiled and validated independently of this plumbing
  port. Contract-first is viable — confirmed twice now, v1 and v2 (Schnorr) both compiled
  with keys emitted and zero SDK involvement.
- One thing the port MUST pick up: v2 added `constructor(pk: JubjubPoint)`, so
  `initialState` takes an argument and deploy has to generate/load an attester keypair.
- package.json is currently mid-migration (runtime bumped to 0.19.0 as a test); finalize the
  full 5.0.0-beta pin set when the port is actually done.

## Beta pin set: RESOLVED and import-verified in a scratch dir (2026-08-28)

Before touching `src/`, the whole beta set was installed in a throwaway project
(`/tmp/betaprobe`, since deleted) and every import the scripts use was checked against it.
Result: **the pin set resolves and all our imports exist.** Findings the port needs:

- One transitive pin is BROKEN as published. `wallet-sdk@2.0.0-beta.2` depends on
  `wallet-sdk-utilities@1.2.0`, but its barrel imports `Clock` from it and 1.2.0 has no
  `Clock` module. Importing `@midnight-ntwrk/wallet-sdk` dies immediately with:
  `The requested module '@midnight-ntwrk/wallet-sdk-utilities' does not provide an export named 'Clock'`.
  Fix: add an override to `wallet-sdk-utilities` **1.2.1** (which ships `Clock.js`).
  With that override the barrel imports cleanly.
- Verified present in the beta set (so these are NOT part of the port's work):
  - `wallet-sdk` barrel: `WalletFacade`, `DustWallet`, `HDWallet`, `Roles`, `ShieldedWallet`,
    `createKeystore`, `NoOpTransactionHistoryStorage`, `PublicKey`, `UnshieldedWallet`
    — i.e. every name `src/wallet.ts` imports still exists under the same names.
  - `midnight-js-protocol/ledger`: `ZswapSecretKeys`, `DustSecretKey`, `LedgerParameters`,
    `unshieldedToken`. `midnight-js-protocol/compact-js`: `CompiledContract`.
  - `deployContract`, `findDeployedContract`, `setNetworkId`/`getNetworkId`,
    `httpClientProofProvider`, `indexerPublicDataProvider`, `levelPrivateStateProvider`,
    `NodeZkConfigProvider`.
  The subpath export map is unchanged too (`./ledger`, `./compact-js`, …), so the
  1.x→2.x rewrite is smaller than feared — name-level compatibility is largely intact and
  the real risk is behavioural (the `keys.signing` Schnorr-tagged format that broke the
  4.1.1 attempt) plus ledger v8→v9 semantics.
- Resolved runtime under the beta set is `compact-runtime@0.19.0-rc.0`, which satisfies the
  0.19.x gate our 0.34.0-compiled contract requires.

## ⚠ The devnet images are the REAL remaining blocker (2026-08-28)
**Superseded the same day — see the ✅ below; the images work. Kept for the reasoning.**

The npm side is now understood; the local chain was not. Compiler 0.34.0 reports
`--ledger-version ledger-9.1.0.0-rc.3`, and our `docker-compose.yml` runs the **ledger-8**
set (node 1.0.0, indexer 4.3.3, proof-server 8.1.0). A ledger-9 contract cannot be deployed
onto a ledger-8 chain, so the port is NOT just a package.json + `src/` job — the devnet has
to move to ledger 9 as well.

- The official support matrix (docs.midnight.network/relnotes/support-matrix, "latest
  TESTED versions", read 2026-08-28) is entirely ledger-8: node 1.0.1/1.0.2, indexer
  4.3.5/4.3.3-hotfix, proof-server 8.1.0, **toolchain 0.31.1, runtime 0.16.0,
  Midnight.js 4.1.1**. There is no published ledger-9 row. So the ledger-9 devnet
  combination is UNTESTED by upstream and we are assembling it ourselves.
- Candidate ledger-9 tags found on Docker Hub: `midnight-node:2.1.0-beta.1`,
  `indexer-standalone:4.4.0-rc.2`, `proof-server:9.0.0-rc.6` (9.0.0-rc.7 exists as
  arch-suffixed tags only, no plain manifest — pull fails "not found").
  Note this contradicts the standing comment in `docker-compose.yml` warning off
  indexer 4.4.0 as "pre-alpha integration builds for the future ledger-9/node-2 line" —
  that line is now exactly what we want, but it is still unreleased.

### ✅ The ledger-9 devnet BOOTS (verified 2026-08-28)Written as `docker-compose.ledger9.yml` (kept separate; `docker-compose.yml` stays as the
known-good ledger-8 fallback). Ports offset +10000 so both stacks can coexist:
node 19944, indexer 18088, proof-server 16300.
`docker compose -f docker-compose.ledger9.yml up -d --wait` → **all three healthy**.
Confirmed live:
- node reports `system_version` 2.1.0-4a9eda5d, specVersion 2001000; produces AND finalizes
  blocks on `CFG_PRESET=dev`.
- indexer 4.4.0-rc.2 answers `{ block { height hash } }` on `/api/v4/graphql` — the SAME
  path `network.ts` already uses, and it accepted the 4.3.3 `APP__*` env keys unchanged
  (including the dummy Blockfrost id). `/api/v1` 308-redirects to `/api/v4/v1/graphql`.
- proof-server 9.0.0-rc.6 `/health` returns `{"status":"ok",...}`.
So the chain side of the port is NO LONGER the blocker. `network.ts` needs only the three
URLs (its `MIDNIGHT_INDEXER_URL` / `MIDNIGHT_NODE_URL` / `MIDNIGHT_PROOF_SERVER_URL` env
overrides already let us point at the l9 ports without editing code).


### The escape hatch, if the ledger-9 devnet proves unworkable
Downgrade the CONTRACT to toolchain 0.31.1 (language 0.23.0, runtime 0.16.0, ledger 8) and
run the whole tested stable stack. **Cost: we lose Schnorr entirely.** Verified by grepping
each installed compiler binary — only 0.34.0 contains `JubjubSchnorrSignature`; 0.22/0.24/
0.26/0.28 do not, and `compact-runtime@0.16.0` has no `jubjubSchnorr*` exports at all (only
`JubjubPoint`/`jubjubPointX`/`jubjubPointY`). The 0.31.0 release notes mention JubJub only as
a JS point-equality bugfix. So 0.31.1 would mean reverting v2 to v1 — trading the
anti-theater core for a deployable demo. Not recommended; noted so the tradeoff is explicit
rather than discovered late.
(Also: installing 0.31.1 to test this failed twice here — `compact update 0.31` downloads
~33MB then dies in `unzip` with "not enough memory for bomb detection" on this 7GB box.
Direct CDN download 403s. Retry with more free RAM if we ever need it.)


---

## ✅ RESOLVED: the full stack works (2026-08-29)

Deploy + call + read all succeed on the local ledger-9 devnet. The escape hatch above was
NOT needed — Schnorr is intact. Getting here required fixing two things that the "devnet
boots" note above did not catch, because booting is not the same as accepting transactions.

### Trap 1: "ledger 9" is not one thing — pin the PATCH version
`docker-compose.ledger9.yml` originally ran node **2.1.0-beta.1**, which pins midnight-ledger
**9.1.0.0-rc.4**. But compiler 0.34.0 targets **rc.3** (`compact --ledger-version`) and the
beta SDK pins **rc.3** (`@midnightntwrk/ledger-v9` 1.0.0-rc.3). rc.3 → rc.4 changed state
encoding v17 → v18 and revised cost-model factors, and node 2.1 moved
`transaction_version` 3 → 4.

Symptom: everything succeeds — wallet syncs, balance present, DUST ready, proof built — and
then submission fails with:
```
1010: Invalid Transaction: Custom error: 170
```
Traced through the node source rather than guessed: `pallets/midnight/src/lib.rs` maps ledger
validation errors to `InvalidTransaction::Custom(code)`, and
`ledger/src/versions/common/types.rs` gives `170 = MalformedError::InvalidDustSpendProof`.
So the error names DUST, and the cause is a ledger version skew. Nothing in the message
points at versions, which is what makes it expensive.

Fix: node **2.0.0-rc.4**, which pins ledger 9.1.0.0-rc.3 — matching compiler and SDK. The
compose file now carries this reasoning inline so nobody "upgrades" the node back.
Rule: keep the ledger patch version identical across compiler, SDK and node.

### Trap 2: indexer 4.4.0-rc.x compresses; `cross-fetch` cannot read it
Next failure after the version fix:
```
IndexerQueryError: Invalid response body while trying to fetch
http://127.0.0.1:18088/api/v4/graphql: Premature close
```
which reads like a network fault and is not one. Indexer 4.4.0 wraps its GraphQL API in a
tower-http `CompressionLayer` (`indexer-api/src/infra/api.rs`) and serves compressed,
chunked bodies. `node-fetch` 2.x — which `cross-fetch` 4.x uses under Node, and which the
SDK imports directly — throws `ERR_STREAM_PREMATURE_CLOSE` on them.

Isolated by testing each layer:
- Node's built-in `fetch` (undici) reads the same response fine.
- `cross-fetch` fails for `gzip`, `br`, `zstd` AND the default (no header).
- `cross-fetch` succeeds with `Accept-Encoding: identity` or node-fetch's `compress: false`.
- The ledger-8 indexer 4.3.3 does not compress, so this never appeared before.

The SDK exposes no way to inject a fetch implementation, so the fix is an npm `overrides`
entry pointing `cross-fetch` at `patches/cross-fetch/`, a ~40-line shim that forces identity
encoding and delegates to the real package (aliased as `cross-fetch-real`). Removal criteria
are in the shim's header comment. Cost: indexer responses travel uncompressed — irrelevant
on a local devnet, reconsider for a remote indexer.

### The working pin set (all verified together)
| Component | Version |
|---|---|
| Compact compiler | 0.34.0 (language 0.26.0, runtime 0.19.0, ledger 9.1.0.0-rc.3) |
| midnight-js-* | 5.0.0-beta.7 |
| compact-runtime | 0.19.0-rc.0 |
| wallet-sdk | 2.0.0-beta.2 (+ `wallet-sdk-utilities` 1.2.1 override) |
| node | **2.0.0-rc.4** |
| indexer-standalone | 4.4.0-rc.2 (+ cross-fetch shim) |
| proof-server | 9.0.0-rc.6 |

Two `overrides` are load-bearing and both work around published-dependency bugs, not
preferences: `wallet-sdk-utilities` 1.2.1 (the 1.2.0 the wallet SDK asks for has no `Clock`
module, so the barrel import throws) and `cross-fetch` (trap 2).
