// The demo scenarios, defined once.
//
// Three of them, and they are NOT interchangeable. Two are proved ahead of time
// and served from the results cache; the third can only ever run live. That split
// is a property of the contract rather than a UI preference — see `liveOnly`.
//
// These are demo presets, not the CLI's argument defaults (cli.ts DEFAULTS): the
// CLI describes what happens when you pass no flags, this describes the three
// things the dashboard offers to show.

import type { CheckInput } from './freeboard-client';

export type ScenarioId = 'safe' | 'at-risk' | 'tampered';

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** One line for the UI: what this asks the chain to settle. */
  summary: string;
  input: CheckInput;
  /**
   * True for the one scenario that cannot be proved-once-and-re-read.
   *
   * The circuit rejects a tampered position, so no verdict is written and
   * `checkCount` does not move — verified live on 2026-09-01, where the ledger
   * still read `Checks performed: 1` after the rejected call. There is no
   * on-chain state to read back afterwards, which is exactly why it has to run
   * in front of you. Caching it would mean showing a stored claim about an event
   * the chain has no record of, which is the theater this contract exists to
   * remove.
   */
  liveOnly: boolean;
}

/** Collateral and debt are raw token units; both bps fields are basis points. */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'safe',
    label: 'Healthy position',
    summary: 'Comfortably above the bar the verifier set.',
    // HF = 1,000,000 × 8500 / 400,000 = 2.1250 against a 1.5000 floor.
    input: { collateral: 1_000_000n, debt: 400_000n, liquidationThresholdBps: 8500n, minHealthFactorBps: 15_000n },
    liveOnly: false,
  },
  {
    id: 'at-risk',
    label: 'Undercollateralised position',
    summary: 'Same collateral, more debt: it fails the same bar.',
    // HF = 1,000,000 × 8500 / 900,000 = 0.9444 against the same 1.5000 floor.
    input: { collateral: 1_000_000n, debt: 900_000n, liquidationThresholdBps: 8500n, minHealthFactorBps: 15_000n },
    liveOnly: false,
  },
  {
    id: 'tampered',
    label: 'Forged position',
    summary: 'The healthy numbers, inflated after signing. The circuit refuses it.',
    input: {
      collateral: 1_000_000n,
      debt: 400_000n,
      liquidationThresholdBps: 8500n,
      minHealthFactorBps: 15_000n,
      tamper: true,
    },
    liveOnly: true,
  },
] as const;

/** The two that get proved ahead of time. Order is the order they are proved in. */
export const CACHEABLE_SCENARIOS: readonly Scenario[] = SCENARIOS.filter((s) => !s.liveOnly);

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
