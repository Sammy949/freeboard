# Roadmap & open questions

## STATUS (2026-08-29): WORKING END TO END on a local ledger-9 devnet ✅
Deployed, called, and verified on-chain. Contract address (local devnet)
`5a94d572301ae68a9ecf9ff65a826167dadd4cec5010a44c865d8a7de4d1dc10`.

Three real runs, all confirmed by reading the ledger back through the indexer:
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
   attested position, so `cli.ts` stages the position in a slot the witness
   supplier reads, then clears it. The stored private state stays `{}`.
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
5. **NEXT: public testnet + the demo skin.** Deploy to `preview`, then the web
   dashboard + water landing page, with Lace. Open question 3 (HF parity with
   Anchor) is worth settling before the UI hardcodes a formula.

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
- Deadline Wave 1: 2026-09-16.
- The contract is the product; CLI comes with it; web is the demo skin.
