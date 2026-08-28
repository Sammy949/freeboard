// The attester: the off-circuit half of Freeboard's attestation check.
//
// ⚠ THIS IS A MOCK ORACLE, and the honesty about that is load-bearing.
//
// The contract proves that a position was signed by the key registered at
// deployment. It does NOT — and cannot — prove that the signer observed the
// position on a real lending market. In this build the signing key is generated
// and stored on the SAME machine as the prover, which means the prover can sign
// whatever numbers they like. So for Wave 1 the in-circuit check demonstrates
// the MECHANISM, not a trust guarantee.
//
// What makes it real is replacing this module with an independent attester —
// a service holding the key, reading actual positions — with no change to the
// contract or the wire format below. That substitution is the whole point of
// putting the check in-circuit now. See notes/04, open question 1.
//
// Until then: do not describe a Freeboard verdict as proof of a real position.

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CompactTypeField,
  CompactTypeVector,
  jubjubSchnorrSign,
  jubjubSchnorrVerify,
  jubjubSchnorrVerifyingKey,
  sampleJubjubSchnorrSk,
  type JubjubPoint,
  type JubjubSchnorrSignature,
} from '@midnight-ntwrk/compact-runtime';

/**
 * A lending position, in the exact shape the contract's `Position` struct
 * expects. All values pre-scaled to a common base unit; the threshold is in
 * basis points (8500 = 85%).
 *
 * `asOf` is the attester's observation stamp. The convention here is UNIX
 * SECONDS. It is fixed by the attester, not the circuit — the circuit only
 * mirrors it to the ledger — so this is the single place it is decided, and it
 * must not drift from whatever a real attester later uses.
 */
export interface Position {
  collateral: bigint;
  debt: bigint;
  liquidationThresholdBps: bigint;
  asOf: bigint;
}

/**
 * The signed message type: `Vector<4, Field>`.
 *
 * This MUST mirror `attestationMessage` in contracts/freeboard.compact exactly
 * — same fields, same order, same arity. It is the wire contract between signer
 * and circuit; any divergence surfaces as a signature that simply fails to
 * verify, with no hint as to why. Change one side, change both.
 */
const MESSAGE_TYPE = new CompactTypeVector(4, CompactTypeField);

/** Flattens a position into the field vector the attester signs. */
export function positionMessage(position: Position): bigint[] {
  return [
    position.collateral,
    position.debt,
    position.liquidationThresholdBps,
    position.asOf,
  ];
}

// ─── Key persistence ──────────────────────────────────────────────────────────
//
// The key is kept out of .midnight-state.json deliberately: that file is a
// convenience cache of network/deploy info, whereas this holds a SIGNING KEY.
// Separate file, restrictive mode, gitignored.

export const ATTESTER_STATE_FILE = '.midnight-attester.json';
export const ATTESTER_STATE_VERSION = 1 as const;

interface PersistedAttester {
  version: typeof ATTESTER_STATE_VERSION;
  /** JubJub scalar, hex. The secret. */
  signingKey: string;
  /** Derived verifying key, stored for readability/debugging only. */
  verifyingKey: { x: string; y: string };
  createdAt: string;
  note: string;
}

export interface AttesterKeypair {
  signingKey: bigint;
  verifyingKey: JubjubPoint;
  /** True when this call generated a brand-new key. */
  created: boolean;
}

export interface AttesterOptions {
  cwd?: string;
}

function statePath(opts: AttesterOptions = {}): string {
  return path.join(opts.cwd ?? process.cwd(), ATTESTER_STATE_FILE);
}

/**
 * Loads the attester keypair, generating and persisting one on first use.
 *
 * Stability matters: the verifying key is baked into the contract at deployment
 * and there is no rotation circuit, so a lost key means every subsequent
 * attestation fails against the deployed contract and it has to be redeployed.
 */
export function loadOrCreateAttesterKey(opts: AttesterOptions = {}): AttesterKeypair {
  const file = statePath(opts);

  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as PersistedAttester;
      if (parsed?.version === ATTESTER_STATE_VERSION && typeof parsed.signingKey === 'string') {
        const signingKey = BigInt(parsed.signingKey);
        return { signingKey, verifyingKey: jubjubSchnorrVerifyingKey(signingKey), created: false };
      }
      // Wrong/absent version: fall through and regenerate rather than guessing
      // at an older layout. Loud, because it invalidates a deployed contract.
      process.stderr.write(
        `  ⚠ ${ATTESTER_STATE_FILE} is not version ${ATTESTER_STATE_VERSION}; generating a new attester key. ` +
          'Any contract deployed against the old key must be redeployed.\n',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `  ⚠ Could not read ${ATTESTER_STATE_FILE} (${msg}); generating a new attester key. ` +
          'Any contract deployed against the old key must be redeployed.\n',
      );
    }
  }

  const signingKey = sampleJubjubSchnorrSk();
  const verifyingKey = jubjubSchnorrVerifyingKey(signingKey);

  const payload: PersistedAttester = {
    version: ATTESTER_STATE_VERSION,
    signingKey: `0x${signingKey.toString(16)}`,
    verifyingKey: { x: `0x${verifyingKey.x.toString(16)}`, y: `0x${verifyingKey.y.toString(16)}` },
    createdAt: new Date().toISOString(),
    note:
      'MOCK ORACLE SIGNING KEY — local development only. Holding this key means being able ' +
      'to attest to any position. Not a real attestation authority; see src/attester.ts.',
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 0600: it is a secret, even a throwaway one. Written via a temp file so a
  // crash mid-write cannot leave a half-key that reads as valid JSON.
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);

  return { signingKey, verifyingKey, created: true };
}

// ─── Signing / verifying ──────────────────────────────────────────────────────

/** Signs a position. This is what a real attester would do, with a real key. */
export function signPosition(position: Position, signingKey: bigint): JubjubSchnorrSignature {
  return jubjubSchnorrSign(MESSAGE_TYPE, positionMessage(position), signingKey);
}

/**
 * Verifies an attestation locally, off-circuit.
 *
 * Worth doing before submitting: the in-circuit `assert` is the real gate, but
 * reaching it costs a proof and a transaction. Checking here turns a wasted
 * round-trip into an instant, legible failure.
 */
export function verifyPosition(
  position: Position,
  verifyingKey: JubjubPoint,
  signature: JubjubSchnorrSignature,
): boolean {
  return jubjubSchnorrVerify(MESSAGE_TYPE, positionMessage(position), verifyingKey, signature);
}

/** Formats a verifying key for display. */
export function formatVerifyingKey(pk: JubjubPoint): string {
  return `x=0x${pk.x.toString(16)} y=0x${pk.y.toString(16)}`;
}
