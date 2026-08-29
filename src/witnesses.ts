// The witness bridge: how a position and its attestation reach the circuit.
//
// Freeboard's witnesses are unusual in that they are NOT durable private state.
// The stored private state stays empty ({}); each `checkSolvency` call is about
// one specific attested position, supplied at call time. So instead of reading
// from a private-state store, these witnesses read from a supplier the caller
// sets immediately before the call.
//
// That is also why deploy and cli need different suppliers: deployment runs only
// the constructor, which takes no witnesses — but the generated Contract class
// still requires the witness functions to EXIST at construction time. Deploy
// therefore supplies a supplier that throws, so that a witness being called
// during deployment surfaces as a loud bug rather than silent zeros.

import type { JubjubSchnorrSignature } from '@midnight-ntwrk/compact-runtime';

import type { Position } from './attester';

/** What the circuit needs for one `checkSolvency` call. */
export interface AttestedPosition {
  position: Position;
  signature: JubjubSchnorrSignature;
}

/**
 * Supplies the attested position for the call currently being made.
 *
 * A function rather than a value so the same contract instance can be reused
 * across calls: set the position, call the circuit, repeat.
 */
export type AttestedPositionSupplier = () => AttestedPosition;

/**
 * Builds the witness object the generated `Contract` constructor expects.
 *
 * The returned values must match the contract's `Position` struct field-for-field
 * and in order; the generated code type-checks each one and will reject a bigint
 * outside its declared Uint bound.
 *
 * Each witness returns `[privateState, value]` — the private state passes through
 * untouched, since Freeboard keeps none.
 */
export function freeboardWitnesses(supply: AttestedPositionSupplier) {
  return {
    getPosition: (context: { privateState: unknown }) => {
      const { position } = supply();
      return [
        context.privateState,
        {
          collateral: position.collateral,
          debt: position.debt,
          liquidationThresholdBps: position.liquidationThresholdBps,
          asOf: position.asOf,
        },
      ] as [unknown, Position];
    },
    getAttestation: (context: { privateState: unknown }) => {
      const { signature } = supply();
      return [context.privateState, signature] as [unknown, JubjubSchnorrSignature];
    },
  };
}

/**
 * Witnesses for deployment, where no position exists yet.
 *
 * Freeboard's constructor takes only the attester's verifying key and touches no
 * witness, so these must never run. They throw instead of returning placeholder
 * values, because a zeroed position that silently "worked" would be far worse
 * than a crash: it would look like a successful deploy.
 */
export function deployTimeWitnesses() {
  return freeboardWitnesses(() => {
    throw new Error(
      'A Freeboard witness was called during deployment. The constructor takes only the ' +
        'attester verifying key and must not read a position — this indicates a bug in deploy.ts.',
    );
  });
}
