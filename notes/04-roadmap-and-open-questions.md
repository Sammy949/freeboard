# Roadmap & open questions

## STATUS (2026-09-01): WORKING END TO END on a local ledger-9 devnet ✅
Deployed, called, and verified on-chain, most recently on a fresh devnet on
2026-09-01. The contract address is NOT stable across devnet restarts: the compose
files declare no volumes, so each restart is a new chain and a new deploy. Do not
quote an address from these notes as a live one — read the current one from
`.midnight-state.json` under `deployments.undeployed-l9`.

Three real runs on 2026-08-29, all confirmed by reading the ledger back through
the indexer, and the SAFE and TAMPERED cases re-confirmed live on 2026-09-01:
- **SAFE**: collateral 1,000,000 / debt 400,000 / threshold 8500bps vs min HF
  15000bps → HF 2.125 → `lastVerdict = safe`.
- **AT_RISK**: debt raised to 900,000 → HF 0.944 → `lastVerdict = at_risk`.
- **TAMPERED**: collateral inflated ×1000 AFTER signing → **rejected in-circuit**,
  no verdict written, `checkCount` unchanged. This is the anti-theater claim
  actually demonstrated rather than asserted.

`npm run test:e2e` now asserts the privacy property directly: the ledger carries
`{attesterPk, lastVerdict, lastAttestationAt, checkCount}` and does NOT carry
`collateral` / `debt` / `liquidationThresholdBps` / `position`. It also checks the
on-chain attester key still matches the deployment record.

**⚠ The attester is a MOCK ORACLE and this bounds what the demo proves.** Its
signing key sits on the same machine as the prover, so the prover can sign any
numbers. The in-circuit check proves the MECHANISM, not that a position is real.
Swapping in an independent attester requires no contract or wire-format change —
which is the reason for building the check in-circuit now. Never describe a
Freeboard verdict as proof of a real position until that swap happens.

### What the port actually required (beyond renames)
1. **Witnesses must exist at construction even for deployment.** The generated
   `Contract` class validates that `getPosition`/`getAttestation` are functions
   before the constructor runs, so `withVacantWitnesses` fails with
   `does not contain a function-valued field named getPosition`. `src/witnesses.ts`
   supplies them; the deploy-time versions THROW if called, because a zeroed
   placeholder position would hide a bug behind a successful-looking deploy.
2. **Witnesses are per-call, not durable state.** Each `checkSolvency` is about one
   attested position, so the caller stages the position in a slot the witness
   supplier reads, then clears it. The stored private state stays `{}`. That slot
   now lives module-private inside `src/freeboard-client.ts`, not in `cli.ts`.
3. **The combinators need `any` under a dynamic import.** `withWitnesses`'s
   parameter is a conditional type over the contract's type, which collapses to
   `never` when that type is `any`. Runtime behaviour is unaffected.
4. `constructor(pk)` means `deployContract` takes `args: [attester.verifyingKey]`.
5. **The CLI needed a non-interactive mode.** Piping answers into the menu does not
   work: stdin hits EOF during the multi-minute wallet sync, long before the first
   prompt (`Error: readline was closed`). Hence `--check` / `--read` / `--tamper`
   flags — without them the CLI cannot be tested or scripted at all.

### Two version traps, both cost real time (details in [[03-midnight-toolchain]])
- **"Ledger 9" is not one thing.** node 2.1.0-beta.1 pins ledger 9.1.0.0-rc.**4**;
  the compiler and SDK pin rc.**3**. Everything up to submission succeeds and then
  the chain rejects with `Custom error: 170` = `MalformedError::InvalidDustSpendProof`
  — an error that names dust, not versions. Fix: node **2.0.0-rc.4**, which pins rc.3.
- **indexer 4.4.0-rc.x compresses its GraphQL responses and `cross-fetch` cannot
  read them.** Surfaces as `IndexerQueryError: … Premature close`, which reads like
  a network fault. Node's built-in fetch handles the same response fine. Fixed with
  a shim in `patches/cross-fetch/` forcing `Accept-Encoding: identity`.

## Build order (contract-first)
1. ~~**Install toolchain**~~ ✅ compiler 0.34.0. Docker ✅ 29.7.2.
2. ~~**Scaffold**~~ ✅ (hello-world, now fully replaced).
3. ~~**Write `freeboard.compact` v1**~~ ✅ ~~**v2 Schnorr attestation**~~ ✅
4. ~~**Exercise via CLI on local devnet**~~ ✅ deploy + 3 verified checks + e2e.
5. ~~**CLI polish + shared client extraction**~~ ✅ (2026-08-30, see below).
6. **NEXT: the dashboard, then public testnet.** Single-page demo over
   `src/freeboard-client.ts`, then deploy to `preview` with Lace. Open question 3
   (HF parity with Anchor) is worth settling before the UI hardcodes a formula.

**v1 mechanic (done):** private position witnesses, one public input
`minHealthFactorBps: Uint<32>`, division-free solvency check
`collateral * liqThresholdBps >= minHealthFactorBps * debt` (the 10000s cancel
since both are bps), `debt == 0` → SAFE. Discloses ONLY `Verdict { at_risk, safe }`
(ordered so the default ledger value 0 = at_risk, the conservative default).

**v2 mechanic (done — the anti-theater core):** the position now arrives as a
signed attestation and the signature is verified IN-CIRCUIT before the HF math.
- `struct Position { collateral: Uint<64>, debt: Uint<64>, liquidationThresholdBps: Uint<16>, asOf: Uint<64> }`
  as ONE witness `getPosition()`, plus `getAttestation(): JubjubSchnorrSignature`.
- `constructor(pk: JubjubPoint)` fixes `attesterPk` at DEPLOY time. Deliberately no
  register/rotate circuit: an unauthenticated one would let a prover install their
  own key and self-attest, which is exactly the theater v2 exists to remove.
  Rotation = redeploy until there is a real authority model (open question 1).
- Signed message is `Vector<4, Field>` = `[collateral, debt, liquidationThresholdBps, asOf]`,
  built by a helper circuit `attestationMessage` so the field order is stated once.
  That order IS the wire contract with the off-circuit signer.
- `assert(jubjubSchnorrVerify<4>(msg, sig, attesterPk), ...)` runs first; an
  unattested position yields no verdict at all.
- New ledger field `lastAttestationAt: Uint<64>` mirrors the signed `asOf` so a
  verifier can judge freshness. `asOf` being inside the signed payload is what
  makes it non-forgeable; an in-circuit freshness FLOOR (a `minAttestationAt`
  public arg) is v2.1, deliberately left out for now (see below).

### Compiler-confirmed Schnorr API (probe circuits, 0.34.0)
The 0.34.0 release notes confirm `JubjubPoint` is now a stdlib-managed internal
type (no longer an exportable nominal alias). Probed signatures, all verified by
compiling:
- `jubjubSchnorrVerify<size>(msg: Vector<size, Field>, sig: JubjubSchnorrSignature, pk: JubjubPoint): Boolean`
  — **arg order is (msg, sig, pk)**, NOT the runtime JS order `(rtType, msg, pk, sig)`.
  The generic is a `size`, not a type: a struct message is rejected, you must flatten
  to `Vector<n, Field>` yourself with `as Field` casts.
- `JubjubSchnorrSignature { announcement: JubjubPoint, response: Field }`.
- `JubjubPoint` works as a ledger field type and as a constructor parameter.
- Compact rejects trailing commas in array literals and call arg lists (unlike
  struct declarations, which require them).
Emitted zkir contains `ec_add` / `ec_mul` / `ec_mul_generator`, i.e. the curve
work is really in the circuit, not stubbed.

Off-circuit round-trip sanity-checked against the runtime (`jubjubSchnorrSign` with
`new CompactTypeVector(4, CompactTypeField)` — note `CompactTypeField` is a value,
not a constructor): valid sig verifies, tampered `debt` fails, wrong pk fails.

### Generated TS interface (v2)
```ts
enum Verdict { at_risk = 0, safe = 1 }

Witnesses<PS> = {
  getPosition(ctx): [PS, { collateral: bigint, debt: bigint,
                           liquidationThresholdBps: bigint, asOf: bigint }];
  getAttestation(ctx): [PS, { announcement: JubjubPoint, response: bigint }];
}

Contract.initialState(ctx, pk_0: JubjubPoint)          // attester key at deploy
checkSolvency(ctx, minHealthFactorBps_0: bigint) -> CircuitResults<PS, Verdict>

Ledger = {
  attesterPk: JubjubPoint;
  lastVerdict: Verdict;
  lastAttestationAt: bigint;
  checkCount: bigint;
}
```
Note for the plumbing port: `initialState` now takes an argument, so deploy has to
generate/load an attester keypair (`sampleJubjubSchnorrSk` → `jubjubSchnorrVerifyingKey`)
and pass the pubkey in. The witness impls must return the SAME numbers the attester
signed, in the same order, or every call fails the assert.


## Wave 1 finishing pass (2026-08-30)

### CLI polish — done
`src/cli.ts` now dresses its output with `chalk` / `ora` / `boxen`. Presentation
only: same five menu options, same order, same flags, same prompts.
- The verdict block is the ONLY thing in a border. `boxen` means "this is the
  answer"; the banner stays hand-drawn so the box keeps that meaning. The
  "what is NOT here" line lives inside the box — the absence is the result, not
  a footnote to it.
- `ora` covers the prove-and-submit wait, with three terminal states: `succeed`,
  `fail`, and `stopAndPersist({symbol: '🛑'})` for the in-circuit rejection.
  The rejection is styled as a definite OUTCOME, not an error, because that
  rejection is the demo working.
- The wallet-sync ticker is deliberately NOT ora. Sync races the SDK's own RPC
  logging on stdout and ora repaints every frame, so the two interleave into a
  smear; a plain `\r` ticker degrades gracefully under interleaved output.

Two rendering bugs found by piping with `FORCE_COLOR=3` through `cat -A` and
reading the escape codes — neither was visible in plain output:
- A `\n` INSIDE `chalk.cyan(...)` emits a coloured blank line (`^[[36m^[[39m`).
  Keep newlines outside the chalk call.
- ora's `prefixText` already supplies the indent, so a `symbol` must not add its
  own or the persisted line sits two columns right of `✔`/`✖`.

**Deliberately deferred, not oversights:** `inquirer.js` and `gradient-string`
(explicitly out of scope this pass), the multi-page site, and the docs page.

### Shared client — done
`src/freeboard-client.ts` now owns every contract interaction, because the web
dashboard runs the same flow and two copies would drift into two different demos.
It prints NOTHING: returns data or throws, and takes optional lifecycle hooks so
the CLI keeps its spinner without the module knowing what a spinner is.
- `connectFreeboard()` → attester key + wallet + providers + `findDeployedContract`,
  held for a whole session (the sync is minutes, not milliseconds).
- The per-call witness slot is module-PRIVATE. The only way to reach it is
  `submitCheck`, which fills it immediately before proving and clears it in a
  `finally` — a stale position can never serve a later call.
- `submitCheck` returns a discriminated union, and `rejected-in-circuit` is a
  first-class outcome alongside `accepted` / `failed`. Modelling the tamper
  rejection as a thrown error would push every caller into treating the best
  moment of the demo as a failure.
- `stageCheck()` is a free function so signing and tampering can be exercised
  with the chain down — verified: healthy HF 2.125 → safe, at-risk HF 0.944 →
  not safe, tampered signature invalid locally while still verifying against the
  ORIGINAL numbers (which is what makes it an in-circuit rejection rather than a
  malformed signature), `debt == 0` → safe.
- An explicit `network` is routed back through `resolveNetwork` as a flag rather
  than indexing `NETWORK_CONFIGS`, so `MIDNIGHT_*_URL` overrides survive. Both
  paths checked.

**Live run: VERIFIED 2026-09-01.** The sequence holds against real proofs on a
fresh ledger-9 devnet, not staged data.
- `--check` healthy (collateral 1,000,000 / debt 400,000 / threshold 8500bps vs
  min HF 15000bps): `ora` spinner → `succeed` → `✔ Accepted. Verdict: ✅ SAFE`,
  with tx hash and block number. HF 2.1250 vs threshold 1.5000, as expected.
- `--check --tamper --read`: spinner → `stopAndPersist({symbol:'🛑'})` →
  `🛑 REJECTED IN-CIRCUIT: position is not signed by the registered attester.`
  → the `boxen` ledger block. Borders render intact, and the 🛑 line sits at the
  same indent as the `✔` line, so the `prefixText` fix holds under a real run.
- The box read `Checks performed: 1` after the rejected call: the healthy check
  counted, the tampered one wrote nothing. The anti-theater property demonstrated
  live rather than asserted.

Note the box only appears with `--read`; `--check` alone ends at the spinner's
terminal line. That is by design (`printLedger` is menu option 2), but it means a
scripted demo wants `--check --read` to show the whole arc.

### Dashboard — next
Single page, Wave 1 scope: header + tagline, the waterline visual (verdict /
`asOf` / check count above the line, an obscured — not empty — region below it for
collateral/debt/threshold), three preset scenarios hitting the real backend
through a Node-side API route over `freeboard-client.ts`, and an understated
monospace technical footer. Proving cannot move into the browser: the wallet seed,
the attester signing key and the proof-server call all live server-side.

**Scaffold status (checked 2026-09-02):** `web/` exists and the shadcn preset has
been run — Next 16.3.3, React 19.2.8, Tailwind 4, Base UI, Phosphor icons, ~40
`components/ui/*` primitives. But `app/page.tsx` is still stock Next boilerplate
and there is no `route.ts` anywhere, so no product work has started. Note
`web/AGENTS.md`: this Next version has breaking changes versus what a model is
likely to know, so read `node_modules/next/dist/docs/` before writing Next code
rather than working from memory. (Verified that way already: the config key is
`serverExternalPackages`, not the pre-15 `serverComponentsExternalPackages`.)

**SETTLED 2026-09-02 — how the web app reaches the SDK: a separate local
service (`src/server.ts`, `npm run serve`), not an in-process Next import.**
Three options were weighed; the other two were npm workspaces and duplicating the
SDK into `web/`. What decided it:
- `freeboard-client.ts` is hard server-only — `node:fs/path/url`,
  `NodeZkConfigProvider` reading prover keys off disk, a LevelDB private-state
  store that takes an EXCLUSIVE lock, the attester key, all relative to the repo
  root as cwd — and the dependency tree carries a WASM binary
  (`@midnight-ntwrk/zkir-v2`). Keeping that out of Turbopack's module graph costs
  nothing and avoids `serverExternalPackages`, `transpilePackages`, and an
  ESM-vs-`require` argument over six packages.
- `connectFreeboard()` is expensive and its own docstring says a web server should
  hold one per process. Next re-evaluates route handlers on edit, so a wallet held
  in a route module is discarded on every save — a re-sync per keystroke while
  building UI. A separate process survives UI work.
- The signing key and wallet seed cannot reach a client bundle by construction
  rather than by care.
- The demo is local-only regardless, because the proof server is a container on
  this machine. Two processes makes that honest instead of implying deployability.
- Version skew across two SDK copies is the exact class of bug that already cost
  this project two debugging cycles, which is what ruled out duplication.

The Next side still gets a thin route handler as the public surface, so the
browser only ever talks to Next and the architecture line above still holds.

**SETTLED 2026-09-02 — prove once, cache, keep exactly one live action.** A preset
click does not prove. `npm run prime` proves the two cacheable scenarios ahead of
time and writes `.midnight-results.json`; the page serves those records. Three
constraints shaped it, and the first would have broken the obvious version:

1. **The ledger holds ONE verdict, not one per scenario.** `lastVerdict` is a
   single slot, so proving healthy and then undercollateralised leaves the chain
   reading `at_risk`; re-reading it for the healthy preset would answer with the
   other scenario's verdict. So each cached record is the authority for its own
   scenario, and `GET /verdict` is a SEPARATE current-chain-state view that
   corroborates whichever check landed last. The UI must not conflate them. The
   records carry `asOf`, which is what lets the page say which one the ledger
   currently reflects.
2. **The tampered scenario has no ledger representation at all**, so it cannot be
   cached even in principle: the circuit rejects it, no verdict is written, and
   `checkCount` does not move (verified live 2026-09-01 — the box read
   `Checks performed: 1` after the rejected call). It is therefore the live
   action, which is also the right one to keep live: the in-circuit rejection is
   the anti-theater claim, and it should happen in front of you.
3. **A cache outlives the chain it describes.** Neither compose file declares
   volumes, so every restart is a new chain and a new deployment, and a record
   naming a txId from a dead chain is worse than no record because it still looks
   verified. Same failure as the wallet cache, so it gets the same guard: the
   genesis hash and contract address are stored with the records and REQUIRED
   positionally to read them back. `GET /scenarios` populates `cached` only when
   the binding holds; otherwise it reports `records: N` with a non-`current`
   status, which is the "re-run `npm run prime`" signal rather than an empty page.

New surface: `src/scenarios.ts` (the three presets, one source of truth, `liveOnly`
on the tampered one), `src/results-cache.ts` (on-disk format, pure fs, no SDK, cwd
injectable), `scripts/prime-results.ts` (`npm run prime`, writes nothing unless
both scenarios land — a half-primed cache sends the demo to a live proof
mid-click), and `GET /scenarios`, which answers WITHOUT connecting for the same
reason `/health` does: a cached record that waits on a wallet sync has bought
nothing.

**Verified 2026-09-02:** `npm run test:cache` is 27 assertions (was 13), covering
every binding-failure path plus the scenario-set invariants; `npx tsc --noEmit`
clean; `/scenarios` exercised against the running service in 35ms with the devnet
down, and again with synthetic records on disk to confirm `cached` stays null under
`chain-unknown`. **NOT verified: a real `npm run prime`** — the devnet is down (no
docker daemon on this box), so no proof has been cached yet. Run it after the next
`npm run deploy`.

shadcn preset to scaffold with (already run, recorded for reproducibility):
```
npx shadcn@latest init --preset b7ClQ5x34 --template next
bunx --bun shadcn@latest init --preset b7ClQ5x34 --template next
```

## Devnet operations (2026-09-01) — three traps, none of them "Docker is broken"

The devnet was blamed for crashing WSL. Only the first item was a memory problem,
and Docker itself was never the cause: the daemon's own peak was 166MB. Two
separate failures were hiding behind one symptom.

1. **The VM ran out of memory; a large swap turned that into a hang.** The kernel
   log shows a global OOM inside the VM whose victim was `node` at 5.8GB RSS (the
   wallet SDK plus WASM prover), not a container. The VM had far more swap than
   memory, on a virtual disk, so it paged for minutes instead of failing fast.
   Fixed by capping the VM's memory, keeping swap small, enabling gradual memory
   reclaim, and setting `vm.swappiness=10` in the guest. Every ledger-9 service
   now carries a `mem_limit` with `memswap_limit` equal to it, so a container leak
   is contained instead of triggering a global OOM that kills the prover
   mid-proof. Measured peaks are in the compose header; nothing came within 6× of
   its cap.

2. **A stale wallet sync cache hangs the deploy forever, silently.** FIXED — see open
   question 9. Cost 16 minutes on a run that takes 45 seconds, and it looks exactly like a
   broken devnet. `loadWalletState` used to validate only that the file parses and that
   `version === 1`; it could not tell that the serialized state belonged to a chain that no
   longer exists. The wallet printed
   `Restored 3/3 child wallets … sync will resume from saved point`, then waited for a
   checkpoint the new genesis had never heard of: zero CPU, three idle websockets to the
   indexer, no error, no timeout, no progress. Because neither compose file declares volumes,
   EVERY devnet restart produced this state. The cache is now bound to the chain's genesis
   hash and discards itself on mismatch. **If a run ever hangs at `Still syncing...` again,
   check CPU first: zero means it is waiting, not working.**

3. **Starting Docker resurrects containers you thought were stopped.** FIXED — see open
   question 10, restart policies removed from both files. With `restart: on-failure` and
   containers left behind by a crash, `systemctl start docker` brought BOTH stacks' indexers
   up on its own; no wrong command needed. That is how two full stacks came to be running on
   2026-08-29. Both reported `healthy` while their own nodes were down, because that
   healthcheck only `cat`s a file — so `healthy` on an indexer does not mean it is indexing
   anything.

Also renamed: `proof-server:start` → `devnet8:start`. It ran `docker compose up
-d` against the default file, so it started the whole ledger-8 stack while
reading like it started one service. Added `devnet:ps` and `devnet:stop-all`.

## Open questions to settle next session
1. **Oracle / attestation source — now the BIGGEST open item.** Everything else works; this
   is the difference between a demo and a product. `src/attester.ts` is a mock: it holds the
   signing key locally, so the prover can attest to anything. Who holds it for real? Anchor
   may already have the position-reading piece — reuse it as the attester. The interface is
   settled and stable: stdlib `jubjubSchnorrSign` over
   `[collateral, debt, liquidationThresholdBps, asOf]` as `Vector<4, Field>`, and `asOf` is
   fixed as UNIX SECONDS (decided in the attester, 2026-08-29). Swapping the signer needs no
   contract change. Until then, say "mock oracle" out loud in any demo.
2. **Freshness floor (v2.1).** `asOf` is signed and mirrored to the ledger but NOT yet
   enforced in-circuit. Adding a public `minAttestationAt: Uint<64>` arg + `assert(asOf >= it)`
   is ~2 lines; held back until question 1 fixes the `asOf` convention, since a floor
   compared against the wrong unit is worse than none.
3. **Exact HF formula parity with Anchor.** Confirm Anchor's health-factor definition
   (per-asset liquidation thresholds? single aggregate?) so Freeboard matches the domain
   Samuel already owns. Pull it from the Anchor codebase.
4. **Binary verdict vs band for Wave 1.** Default = binary (least leakage). Band only if we
   also control query frequency (trajectory-leak risk).
5. **Threshold ownership UX.** Verifier sets threshold — how is it agreed/encoded in a real
   flow? (public input; maybe a "request" object the verifier hands the prover.)
6. ~~**Compact version pin.**~~ Settled: compiler 0.34.0 / language 0.26.0 / runtime 0.19.0,
   ledger 9.1.0.0-rc.3 held identical across compiler, SDK and node.
7. ~~**Scaffold vs existing folder layout.**~~ Settled: scaffold at repo root, `notes/`
   alongside, hello-world fully replaced.
8. **Cross-chain reality check.** Aave positions live on EVM; Midnight is separate. Wave 1
   sidesteps this via the signed attestation (the oracle bridges it). Note it explicitly so
   we don't accidentally claim on-chain-state proof we don't have.
9. ~~**Make the wallet cache self-invalidating.**~~ Settled 2026-09-01, genesis-hash binding.
   `src/chain-identity.ts` reads `chain_getBlockHash[0]` over JSON-RPC; `saveWalletState`
   stamps it into `chain.json` beside the child states, and `loadWalletState` takes the current
   hash as a REQUIRED positional parameter, so there is no way to read the cache without
   saying which chain you are on. A mismatch, or a cache with no chain record at all (every
   cache written before this change), is discarded with a message naming both hashes, and
   `clearWalletState()` finally has its caller. If the node will not identify itself the
   behaviour is fail-closed in both directions: no restore, and no write either, since an
   unstamped cache would only be rejected later. Covered by `npm run test:cache`.
10. ~~**Decide whether `restart: on-failure` is worth its cost.**~~ Settled 2026-09-01, removed
    from both files. Verified it was not load-bearing: with the policy gone, `up -d --wait`
    plus `depends_on: service_healthy` still brings all three services to healthy. Verified the
    hazard is gone too: `docker kill` on the indexer (exit 137, precisely what `on-failure`
    triggers on) leaves it `Exited` instead of resurrecting it.


## Landing page (later — respect the anti-slop law in ~/.claude/CLAUDE.md)
Water/nautical signature: waterline, load line / Plimsoll mark, freeboard margin, draft.
The metaphor must do real work (verdict = above/below the line), not be decoration. One
signature artifact, atmosphere not a flat fill, licensed/distinctive type, authored motion.
Re-read the design law start-to-finish before building it.

## Reminders
- The whole path works locally: compile → deploy → checkSolvency → read verdict, plus a
  demonstrated in-circuit rejection. Next milestone is `preview` testnet, then the web skin.
- The devnet is pinned to pre-release images upstream publishes no matrix for. If it breaks
  after any image bump, suspect the ledger patch version first ([[03-midnight-toolchain]]).
- `.midnight-attester.json` is a SIGNING KEY (mode 0600, gitignored). Losing it means
  redeploying, since the contract has no rotation circuit.
- **`npm run prime` after every `npm run deploy`.** A fresh devnet is a fresh chain, so the
  cached scenario records stop describing it; `GET /scenarios` will report a non-`current`
  status and serve no records until it is re-run.
- Deadline Wave 1: 2026-09-16.
- The contract is the product; CLI comes with it; web is the demo skin.
