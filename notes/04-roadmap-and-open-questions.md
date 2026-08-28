# Roadmap & open questions

## STATUS (2026-08-28): v2 contract compiles standalone ✅ (Schnorr attestation in-circuit)
`contracts/freeboard.compact` compiles fully with the 0.34.0 compiler (language
0.26.0, runtime 0.19.0) — proving + verifier keys and zkir emitted under
`contracts/managed/freeboard/`. `npm run compile` exits 0. Still NO npm SDK
involvement: the compiler is standalone, so the 5.0.0-beta plumbing port
([[03-midnight-toolchain]]) remains deferred and does not block this.

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

## Build order (contract-first)
1. ~~**Install toolchain**~~ ✅ compiler 0.34.0 installed. Docker ✅ (29.7.2, running).
2. ~~**Scaffold**~~ ✅ done (hello-world; replaced by freeboard.compact).
3. ~~**Write `freeboard.compact` v1**~~ ✅ ~~**v2 Schnorr attestation**~~ ✅ both compile.
4. **Exercise via CLI** on local devnet — IN PROGRESS, groundwork done 2026-08-28:
   - ✅ ledger-9 devnet boots and is healthy (`docker-compose.ledger9.yml`)
   - ✅ beta SDK pin set resolves; every import our scripts use verified present
   - ⬜ remaining: rewrite `src/` (deploy/cli/e2e) off hello-world onto freeboard,
     pass the attester `JubjubPoint` into `initialState`, implement the two witnesses,
     flip package.json to the beta pins, then deploy + call for real.
   Details of both ✅ items in [[03-midnight-toolchain]].
5. **Then** the web dashboard (Full DApp / React) + water landing + Lace on `preview` testnet.

## Open questions to settle next session
1. **Oracle / attestation source.** Who holds the attester signing key, and how do we get
   real Aave data into a signed attestation? Options: a mock signer service we run (fine for
   Wave 1 demo, be honest about it), or a real feed. Anchor may already have the
   position-reading piece — reuse it as the attester. The attester side is stdlib
   `jubjubSchnorrSign` over `[collateral, debt, liquidationThresholdBps, asOf]`.
   Also decide the `asOf` convention (unix seconds vs block height) — the circuit is agnostic,
   the attester fixes it.
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
6. ~~**Compact version pin.**~~ Settled: compiler 0.34.0 / language 0.26.0 / runtime 0.19.0.
7. **Scaffold vs existing folder layout** (see `03-midnight-toolchain.md`).
8. **Cross-chain reality check.** Aave positions live on EVM; Midnight is separate. Wave 1
   sidesteps this via the signed attestation (the oracle bridges it). Note it explicitly so
   we don't accidentally claim on-chain-state proof we don't have.


## Landing page (later — respect the anti-slop law in ~/.claude/CLAUDE.md)
Water/nautical signature: waterline, load line / Plimsoll mark, freeboard margin, draft.
The metaphor must do real work (verdict = above/below the line), not be decoration. One
signature artifact, atmosphere not a flat fill, licensed/distinctive type, authored motion.
Re-read the design law start-to-finish before building it.

## Reminders
- v1 + v2 contracts are built and compile standalone; the 5.0.0-beta SDK plumbing port
  (deploy/cli) is still pending and blocks on-chain exercise. Note that deploy now has to
  pass an attester `JubjubPoint` into `initialState`.
- Deadline Wave 1: 2026-09-16.
- The contract is the product; CLI comes with it; web is the demo skin.
