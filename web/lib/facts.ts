/**
 * Every real value the page states. One file, so nothing is invented inline.
 *
 * The page is static: no fetch, no service, no runtime data. That is not a
 * limitation being worked around, it is the correct shape — the local service
 * binds loopback and holds a signing key, so it can never be deployed, and a page
 * that fetched it would show an offline state everywhere except one machine.
 *
 * WHAT IS DELIBERATELY ABSENT: collateral, debt, liquidation threshold, health
 * factor. An earlier version of this site passed a whole scenario record into a
 * client component, which serialized `collateral: "1000000"` into the page source
 * underneath a graphic claiming it was withheld. View-source refuted the central
 * claim in about four seconds. None of those numbers appear here, in any form.
 */

/** The published npm package. */
export const INSTALL_COMMAND = "npx freeboard-cli";

export const REPO_URL = "https://github.com/Sammy949/freeboard";

/**
 * The contract, as last deployed.
 *
 * A local ledger-9 devnet declares no volumes, so the chain a deploy lands on dies
 * with its containers. This address was real on the chain of 2026-09-07 and that
 * chain no longer exists. The page says so plainly rather than implying a live
 * deployment — see the caveat copy in page.tsx.
 */
export const DEPLOYMENT = {
  network: "undeployed-l9",
  address: "1c3d6d1cdf3ba7822c512fbd79ae7e99010744e1b62744573fe48ee1c6a3f000",
  deployedAt: "2026-09-07",
} as const;

/**
 * The privacy boundary, field by field, lifted from contracts/freeboard.compact
 * rather than described from memory. These are the actual witness and ledger
 * declarations, with their actual types.
 *
 * The one honest complication is `asOf`. It is a private witness that the
 * circuit deliberately DISCLOSES to `lastAttestationAt`, so a verifier can judge
 * whether the verdict is stale. A diagram that hid that would be a nicer picture
 * and a false one, so the page names it as the field that crosses.
 */
export const PRIVATE_FIELDS = [
  { name: "collateral", type: "Uint<64>", note: "your position size" },
  { name: "debt", type: "Uint<64>", note: "what you owe against it" },
  { name: "liquidationThresholdBps", type: "Uint<16>", note: "basis points" },
  { name: "jubjubSchnorrVerify", type: "circuit", note: "the attester's signature, checked first" },
  { name: "collateral × threshold ≥ minHF × debt", type: "circuit", note: "the health factor, division-free" },
] as const;

export const PUBLIC_FIELDS = [
  { name: "lastVerdict", type: "Verdict", note: "safe or at_risk, one bit" },
  { name: "lastAttestationAt", type: "Uint<64>", note: "the attester's own stamp" },
  { name: "checkCount", type: "Counter", note: "how many checks have run" },
  { name: "attesterPk", type: "JubjubPoint", note: "fixed at deployment" },
] as const;

/** What the CLI actually does, in the order someone meets it. */
export const CAPABILITIES = [
  {
    command: "freeboard --check",
    title: "Prove a position",
    body: "The attester signs your collateral and debt. The circuit verifies that signature before it computes anything, works out the health factor privately, and writes a single verdict to the chain.",
  },
  {
    command: "freeboard --read",
    title: "Read the verdict",
    body: "The verifier's view. A verdict, the attestation timestamp, and a count of checks performed. No collateral, no debt, no threshold, because the contract has nowhere to put them.",
  },
  {
    command: "freeboard --check --tamper",
    title: "Watch it refuse a forgery",
    body: "Inflate a position after the attester signed it. The in-circuit signature check fires before any arithmetic runs, so nothing reaches the ledger. It costs 0.4 seconds rather than the 45 an accepted proof takes.",
  },
] as const;
