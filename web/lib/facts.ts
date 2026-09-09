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
 * The published package and its version. Verified against the registry, not
 * assumed: `npm view freeboard-cli version` returns 1.0.0, and
 * `npx -y freeboard-cli@1.0.0 --version` runs and prints it.
 *
 * This is the one number on the page that will go stale on the next publish.
 * It is here, alone, so there is exactly one place to change it.
 */
export const PACKAGE_VERSION = "1.0.0";
export const NPM_URL = "https://www.npmjs.com/package/freeboard-cli";

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
  { name: "collateral", type: "Uint<64>", note: "what you put up" },
  { name: "debt", type: "Uint<64>", note: "what you owe against it" },
  { name: "liquidationThresholdBps", type: "Uint<16>", note: "the level your lender sells at" },
  { name: "jubjubSchnorrVerify", type: "circuit", note: "checks the oracle signed this, before anything else" },
  { name: "collateral × threshold ≥ minHF × debt", type: "circuit", note: "the sum that decides safe or not" },
] as const;

export const PUBLIC_FIELDS = [
  { name: "lastVerdict", type: "Verdict", note: "safe, or at risk. One word" },
  { name: "lastAttestationAt", type: "Uint<64>", note: "when the oracle looked" },
  { name: "checkCount", type: "Counter", note: "how many checks have run" },
  { name: "attesterPk", type: "JubjubPoint", note: "which oracle is trusted, set once" },
] as const;

/** What the CLI actually does, in the order someone meets it. */
export const CAPABILITIES = [
  {
    command: "freeboard --check",
    title: "Prove your loan is safe",
    body: "An oracle signs your figures so they cannot be invented. The proof checks that signature, works out whether the loan is safe, and writes one word to the chain. Your figures never leave the machine.",
  },
  {
    command: "freeboard --read",
    title: "See what a lender sees",
    body: "The whole public record: the answer, when the oracle last looked, and how many checks have run. No amounts and no thresholds, because the contract has nowhere to put them.",
  },
  {
    command: "freeboard --check --tamper",
    title: "Watch it refuse a forgery",
    body: "Change your figures after the oracle has signed them. The signature is checked first, so the forgery is thrown out before any sums are done and nothing reaches the chain. It fails in 0.4 seconds, against the 45 a real proof takes.",
  },
] as const;
