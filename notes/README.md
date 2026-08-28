# Freeboard — session handoff notes

**Freeboard** — private solvency proofs for on-chain risk, built on Midnight (Compact/ZK).
Prove "am I safe?" without revealing "what do I have?". A direct port of Samuel's
existing **Anchor** fraud/risk project (Aave health-factor + liquidation math) into a
privacy primitive.

- **Hackathon:** Midnight. **Wave 1 deadline: 2026-09-16.** Today: 2026-08-27.
- **Name:** Freeboard (chosen). Nautical brand off "Anchor". Freeboard = the distance
  between the waterline and the deck = your literal margin of safety = the health-factor
  buffer. Water-themed landing page planned.
- **Status: NOTHING BUILT YET.** No scaffold, no contract. Deliberately. These notes are
  the full context to start from next session.

## The one-sentence pitch
A Compact contract takes your position (collateral, debt, threshold) as *private* input,
computes your health factor entirely in private state, and discloses only a verdict —
SAFE / AT_RISK (or a coarse band). The counterparty gets a cryptographic guarantee, not
a screenshot of your wallet.

## What this is (architecture in one line)
**The Compact contract is the product; the CLI ships with it; the web dashboard is the
demo layer.** Build the contract + CLI first, add the web skin second. It is NOT a miner
and NOT a lone script — it's a ZK smart contract + client, with a local proof server
(Docker) doing the proving.

## The crux (read this before anything else)
A naive ZK solvency proof is **theater**: it proves "given these self-reported numbers,
HF clears the threshold" — an internally-consistent pinky-swear. It does NOT prove the
numbers are your real position. The fix, which is what makes Freeboard *real*: an oracle
signs `{wallet, collateral, debt, timestamp}`, and the circuit **verifies that signature
in-circuit** before computing the verdict. See `02-architecture.md`.
Midnight's own **ZK Loan tutorial already demonstrates exactly this** (Schnorr attestation
verified inside the circuit). Freeboard = that skeleton with health-factor math swapped in.

## Files in this folder
- `01-concept-and-pitch.md` — the pitch, the name rationale, design flags, waves.
- `02-architecture.md` — contract/CLI/web split, data flow, the attestation fix, Compact gotchas.
- `03-midnight-toolchain.md` — accurate scaffold commands, prereqs, project structure, env state.
- `04-roadmap-and-open-questions.md` — build order + unresolved decisions to settle next.
