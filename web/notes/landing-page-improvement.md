# Landing page improvement notes

## Goal

Make the landing page feel like a credible product page for a trust-heavy CLI tool, not a generic SaaS landing page. It should explain the mechanism clearly, build confidence, and make the user want to run the CLI.

## Core product story

The page should say three things in plain language:

- Your private position data stays on your machine.
- Freeboard checks solvency locally.
- Only a small public proof reaches the chain.

This is the product. Everything else is support.

## What the page should do well

### 1. Earn trust immediately
The top of the page should make the user feel:

- this is serious
- this is verifiable
- this is not a black box
- this is technical but understandable

The current visual language is already close to this. Keep the terminal-first tone and the calm, technical aesthetic.

### 2. Explain the proof model quickly
The most important concept is not the CLI itself; it is the proof model.

The page should explain:

- input stays local
- the check is computed privately
- a verifier validates the threshold
- a public attestation is generated
- the chain sees only the result, not the underlying position

This should be represented as a short, clean sequence rather than a wall of copy.

### 3. Make running the tool obvious
The user should be able to see the CLI path with almost no friction.

The page should present:

- install command
- quick start path
- check command
- result output
- explanation of what the proof means

The command and output are real product assets. They should be treated as core content, not decoration.

## Hero pattern to aim for

### Recommended structure

- logo + nav
- headline
- short explanatory subhead
- two main actions:
  - Install
  - Quick start
- terminal output below the fold or directly under the hero

This keeps the page grounded in the tool itself instead of a generic startup layout.

## CTA choices

Prefer:

- Install
- Quick start

Avoid making the second CTA a generic "View source" by default unless the page is already more docs-heavy.

"Quick start" communicates intent and matches the product better than raw repo browsing for a first-time visitor.

## Navbar direction

Keep the nav minimal and precise.

Suggested structure:

- FREEBOARD
- Product
- Security
- Docs
- Install

The goal is not to overwhelm the page with links. It is to feel like a real product site with a small, intentional top bar.

## Style guardrails

Keep the existing strengths:

- terminal-first aesthetic
- restrained developer-utility look
- crisp spacing
- dark/sky/white tonal progression
- product-like trust cues rather than startup decoration

Avoid:

- generic SaaS pricing blocks
- fake customer logos
- floating badge cards
- too many bright gradient accents
- stock startup CTA pairs
- a heavy “feature grid” with icon tiles that could be on any product

## Recommended section flow

1. Hero
2. Proof model / how it works
3. Why this matters / security explanation
4. Quick start / CLI steps
5. Repo / source / docs access
6. Footer

This order makes sense because it follows the product story instead of a generic landing-page template.

## Font direction

A strong candidate for the brand voice is the Instrument Sans + Instrument Serif pairing.

This is a good fit for Freeboard because it feels:

- editorial but precise
- technical but human
- calm and trustworthy without becoming generic

The pairing is especially suitable for a product that sits between protocol tooling and product storytelling. Instrument Sans can carry body copy, UI labels, and navigation with clarity, while Instrument Serif can carry the signature wordmark or a more expressive display line without drifting into a stock startup serif.

This is close to the direction already implied by the current page: a display serif for emphasis, plus a clean practical sans for interface text. The key is to keep it disciplined and not overuse the serif in every heading.

The idea is not to add a fashionable font gimmick; it is to choose a pair that signals trust, clarity, and technical seriousness.

## Success criteria

The page should feel like a product that someone can actually trust enough to run.

A good landing page for this product should make the user feel:

- this is a real tool
- it is designed for private verification
- the mechanism is understandable
- the command path is safe and obvious
- I can run this without guessing

## Final direction

The page should be technical, calm, and clear. It should read like the web front door to a verifier tool, not a template-heavy SaaS homepage. The terminal, the command flow, and the trust story are the true brand. Everything else should support that.
