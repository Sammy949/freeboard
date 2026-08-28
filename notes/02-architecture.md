# Architecture

## The three layers
1. **Compact contract (THE PRODUCT).** The ZK circuit: verify an oracle-signed position,
   compute health factor in private state, disclose only the verdict. This is the
   innovation and what Midnight judges weight.
2. **CLI (ships with the contract).** The "Contract" scaffold type generates
   `cli.ts` / `deploy.ts` / `check-balance.ts`. This is how we exercise and demo the
   circuit before any UI exists — fastest path to "it compiles and runs on a devnet".
3. **Web dashboard (demo / fundability layer).** React/Vite frontend + Lace wallet on
   public testnet + the water-themed landing. Added LATER via the "Full DApp" scaffold.
   Shows the verdict visually with numbers hidden. This is a skin over the product.

Local proving is done by a **proof server** (runs in the scaffold's docker-compose,
alongside a node + indexer). Not a miner; it generates the ZK proofs client-side.

## Data flow (Wave 1 target)
```
Oracle/attestation service                 User (prover)              Counterparty (verifier)
  signs {wallet, collateral,   --sig-->   feeds position +   --ZK proof-->  reads ledger:
  debt, timestamp} (Schnorr)              sig as PRIVATE                     only SAFE / AT_RISK
                                          witness; picks                     bound to a REAL,
  publishes provider pubkey  ----------->  nothing public                    attested position
  (registered in contract)                except the verdict
                                     Threshold (e.g. HF>=1.5) = PUBLIC input, set by verifier
```

## The attestation fix (what makes this real, not theater)
Naive version proves only that self-reported numbers are internally consistent — worthless
to a counterparty. Real version: the circuit **verifies a Schnorr signature over the
position in-circuit**, from a provider whose pubkey is registered in the contract's ledger.
Now the verdict is provably about a real, attested position while the numbers stay private.

**Midnight's ZK Loan tutorial already does exactly this** — it verifies a Schnorr-signed
attestation from a registered provider before evaluating tiers. Freeboard forks that
structure and swaps credit-score tiers for health-factor math.
Ref: https://docs.midnight.network/tutorials/zk-loan/smart-contract

**Built as of 2026-08-28 (v2), with two corrections to the plan above.** The Schnorr check
is live in `contracts/freeboard.compact` and compiles. What differs from this sketch:
1. There is no `schnorr` module to import — the tutorial's `import "schnorr"` is its own
   wrapper. Schnorr-over-JubJub is a first-class CompactStandardLibrary primitive:
   `jubjubSchnorrVerify<size>(msg, sig, pk)`. See [[04-roadmap-and-open-questions]].
2. The provider pubkey is NOT "registered in the contract" by a circuit — it is a
   `constructor(pk: JubjubPoint)` deploy parameter. A registration circuit without an
   authority model would let a prover install their own key and self-attest, which defeats
   the point of the whole check.
Also: the signed payload is `[collateral, debt, liquidationThresholdBps, asOf]` — no wallet
field yet (binding the attestation to an identity is a later question).

## Health-factor math — the Compact gotcha
Aave single-position: `HF = (collateral * liquidationThreshold) / debt`.
Compact/ZK is **integer-only** — no floats, and division is to be avoided.
- Scale ratios to basis points (×10000).
- **Cross-multiply instead of dividing.** To check `HF >= T`, i.e.
  `collateral * liqThreshold / debt >= T`, assert instead:
  `collateral * liqThreshold >= T * debt` (all pre-scaled). No division, no precision loss.
- Guard `debt == 0` explicitly (infinite HF → trivially SAFE).
- **Constrain every witness value with range asserts** — unconstrained witnesses are
  forgeable in ZK. The tutorial shows this (a quotient typed `Uint<7>`, asserted `< 116`).

## Compact language notes (from the ZK Loan tutorial)
- `pragma language_version >= 0.22 && <= 0.23;` then `import CompactStandardLibrary;`
  and `import "schnorr" prefix Schnorr_;`.
  ⚠ Both stale. Freeboard uses `pragma language_version >= 0.23;` on compiler 0.34.0
  (language 0.26.0) and there is no `schnorr` module — Schnorr is in the standard library.
- `witness` = private inputs; `ledger` = on-chain public state; `export circuit` = entry
  points; `pure circuit` = side-effect-free helpers.
- `disclose()` is a compile-time annotation marking a witness-derived value safe to leave
  the private domain. A value only becomes public when written to a ledger field or
  returned from an exported circuit. **Only the verdict should ever be disclosed.**
- ZK circuits **can't loop over variable-length data** → fixed-size batches only
  (relevant if Wave 2 iterates positions).
- Don't use `ownPublicKey()` for identity/auth — docs call it "bypassable". Use the
  witness-derived keypair pattern (`deriveUserPublicKey(secret, pin)`).
- `enum`/`struct` for types; exported types generate TS bindings, unexported stay private.
  `new type` gives nominal aliases over `Bytes<32>` so the compiler rejects key mixups.

## Verdict shape
- Wave 1 default: `enum Verdict { SAFE, AT_RISK }` — leaks least.
- Optional band later: e.g. CRITICAL / AT_RISK / HEALTHY / STRONG via multiple threshold
  comparisons — but see trajectory-leak flag in `01-concept-and-pitch.md`.
