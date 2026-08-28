# Concept, pitch & design decisions

## The problem
Anyone with a sizeable DeFi position lives with a quiet threat: their whole financial
life is public. Collateral, debt, liquidation threshold — all in the open. It gets
weaponized: whales front-run the moment their health factor slips, liquidation bots hunt
exposed positions, competitors read your balance sheet before you read theirs.

But you can't go dark either. A lender wants proof you're creditworthy. A DAO treasury
committee wants proof a counterparty isn't overleveraged before signing. An insurer wants
proof of solvency before underwriting. Today the only way to prove any of it is to show
your whole position — take it or leave it.

## The idea
Answer "am I safe?" without answering "what do I have?". Feed position in privately →
contract computes health factor in private state → only a verdict (SAFE / AT_RISK, or a
coarse band) ever becomes public.

## Why this, why now
- Direct extension of **Anchor** (Samuel's fraud/risk project on Telegraph) which already
  understands Aave health-factor and liquidation math. Porting a known domain into a
  privacy primitive — not learning a new domain and a new language at once.
- Midnight names this exact use case first on their own site: "prove solvency without
  disclosing balances."

## Why fundable
- Small enough to compile before 2026-09-16.
- Legible in one sentence.
- Keeps being true past Wave 1 (see waves below).

## The name — Freeboard
Freeboard = the distance between a ship's waterline and its deck: the margin of safety
before water comes over the side. It literally *is* the health-factor buffer above the
liquidation line. On-brand with "Anchor", uncommon, self-explaining, ownable. Enables a
genuine water/nautical landing (waterline, load line, draft) — not decoration for its own
sake, the metaphor maps 1:1 to the product.
(Alternates considered: Plimsoll — the load line / pass-fail mark, named after a real
reformer; Seaworthy — the certificate framing. Freeboard won.)

## Design flags to respect (don't let these slide)
1. **The band leaks trajectory.** A single binary verdict at a point in time leaks almost
   nothing. A *coarse band queried repeatedly* lets a watcher reconstruct drift — the
   exact front-running threat we're defending against. If we ship bands, control who
   triggers proofs and how often. Default Wave 1 = binary SAFE/AT_RISK.
2. **Threshold is the verifier's, and public.** If the *user* picks the safety threshold,
   the proof is meaningless. Threshold (e.g. "HF ≥ 1.5") is a PUBLIC input set by the
   counterparty; collateral/debt stay private. State this as a strength.
3. **One position ≠ solvency.** Safe on Aave, drowning on Compound. Wave 1 claim must be
   narrow: "solvency of a single attested position." Cross-protocol is Wave 2 — don't
   overclaim in the top-line pitch.

## Waves (roadmap north star)
- **Wave 1:** single attested position → private HF → SAFE/AT_RISK verdict on Midnight.
- **Wave 2:** portfolio-level proofs across multiple protocols/positions.
- **Wave 3:** an API other dApps plug into for solvency-gated access, without ever seeing
  the underlying numbers.
