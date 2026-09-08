// The circuit's field widths, and one validator for every entry point.
//
// contracts/freeboard.compact declares:
//   struct Position { collateral: Uint<64>, debt: Uint<64>,
//                     liquidationThresholdBps: Uint<16>, asOf: Uint<64> }
//   circuit checkSolvency(minHealthFactorBps: Uint<32>)
//
// Those bounds are enforced by the generated contract code, but only once a proof is
// under way — after the attester has signed, after the local verify, after the CLI
// has printed a health factor and "Proving and submitting". The user then sees a
// generic failure for what is really "65536 does not fit in a Uint<16>".
//
// This module exists so the bound is checked at the EDGE, in the same words, from
// every direction: CLI flags, an interactive prompt, and the HTTP handler. Those
// three had drifted — the server validated all four fields with named limits while
// the CLI accepted any run of digits.
//
// Pure arithmetic. No fs, no SDK, no chain, so it is assertable with nothing running.

/** Field widths, named for the circuit types they mirror. */
export const MAX_U16 = 2n ** 16n - 1n;
export const MAX_U32 = 2n ** 32n - 1n;
export const MAX_U64 = 2n ** 64n - 1n;

/** Thrown for a value the circuit could not accept. Message is user-facing. */
export class FieldBoundError extends Error {
  constructor(
    readonly field: string,
    readonly value: bigint,
    readonly max: bigint,
  ) {
    super(`${field} is ${value}, which exceeds the circuit's field width (max ${max}).`);
    this.name = 'FieldBoundError';
  }
}

/** The four position/threshold fields and the width each one is declared as. */
export const FIELD_BOUNDS = {
  collateral: MAX_U64,
  debt: MAX_U64,
  liquidationThresholdBps: MAX_U16,
  minHealthFactorBps: MAX_U32,
  asOf: MAX_U64,
} as const;

export type BoundedField = keyof typeof FIELD_BOUNDS;

/** Throws `FieldBoundError` unless `value` fits the field's declared width. */
export function assertInBounds(field: BoundedField, value: bigint): void {
  const max = FIELD_BOUNDS[field];
  if (value < 0n) throw new FieldBoundError(field, value, max);
  if (value > max) throw new FieldBoundError(field, value, max);
}

/**
 * Parse a decimal string into a bounded bigint.
 *
 * Rejects anything that is not a run of digits BEFORE calling BigInt, because
 * `BigInt('0x10')` is 16 and `BigInt(' 5 ')` is 5 — both would quietly accept input
 * the circuit's own grammar does not.
 */
export function parseBounded(field: BoundedField, raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${field} must be a whole non-negative number (got ${JSON.stringify(raw)}).`);
  }
  const value = BigInt(raw);
  assertInBounds(field, value);
  return value;
}

/**
 * The factor `--tamper` multiplies collateral by, and the largest collateral that
 * survives it.
 *
 * The tamper demo inflates collateral AFTER signing so the circuit's signature check
 * refuses the call. If the inflated value overflows Uint<64> instead, the call fails
 * on a field-width violation and the demo reports the wrong reason for failing — the
 * headline case, misexplained. So callers check `maxTamperableCollateral` first and
 * say which limit was hit.
 */
export const TAMPER_FACTOR = 1000n;
export const MAX_TAMPERABLE_COLLATERAL = MAX_U64 / TAMPER_FACTOR;

/** True when `--tamper` can inflate this collateral without overflowing Uint<64>. */
export function isTamperable(collateral: bigint): boolean {
  return collateral <= MAX_TAMPERABLE_COLLATERAL;
}
