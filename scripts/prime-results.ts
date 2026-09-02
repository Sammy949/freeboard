// Prime the results cache — `npm run prime`.
//
// Proves the two cacheable preset scenarios once, records what the chain said,
// and writes .midnight-results.json. Run this after every deploy: a fresh devnet
// is a fresh chain, so the previous cache no longer describes it (see
// results-cache.ts for why that binding is enforced rather than assumed).
//
// The tampered scenario is NOT primed. The circuit rejects it, so nothing lands
// on the ledger and there is no record to cache — it stays a live action.

import { connectFreeboard, localHealthFactor, type FreeboardClient } from '../src/freeboard-client';
import { fetchGenesisHash } from '../src/chain-identity';
import { saveResults, type ResultsCache, type ScenarioRecord } from '../src/results-cache';
import { CACHEABLE_SCENARIOS, type Scenario } from '../src/scenarios';

const out = (s: string): void => process.stdout.write(s);

/**
 * The genesis hash the wallet already established, or one fresh RPC call.
 *
 * `walletCtx.genesisHash` is null only when the wallet was built without
 * restoring a cache, in which case nobody has asked the chain yet.
 */
async function chainId(client: FreeboardClient): Promise<string> {
  return client.walletCtx.genesisHash ?? (await fetchGenesisHash(client.networkConfig.node));
}

async function prove(client: FreeboardClient, s: Scenario): Promise<ScenarioRecord> {
  out(`  ${s.label} ... `);
  const staged = client.stage(s.input);
  const result = await client.submitCheck(staged);
  await client.persist();

  if (result.outcome !== 'accepted') {
    out('✖\n');
    throw new Error(`${s.id}: ${result.outcome} — ${result.message}`);
  }
  // The circuit's verdict is the authority. It is only absent when the SDK does
  // not surface a return value, and a record with no verdict is not a record.
  if (result.verdict === null) {
    out('✖\n');
    throw new Error(`${s.id}: accepted in ${result.txId} but the circuit's verdict did not come back`);
  }

  out(`${result.verdict === 'safe' ? '✅ SAFE' : '⚠️  AT_RISK'}  block ${result.blockHeight}\n`);

  return {
    id: s.id,
    label: s.label,
    summary: s.summary,
    minHealthFactorBps: staged.minHealthFactorBps.toString(),
    signed: {
      collateral: staged.signed.collateral.toString(),
      debt: staged.signed.debt.toString(),
      liquidationThresholdBps: staged.signed.liquidationThresholdBps.toString(),
      asOf: staged.signed.asOf.toString(),
    },
    healthFactor: localHealthFactor(staged.signed),
    verdict: result.verdict,
    txId: result.txId,
    blockHeight: String(result.blockHeight),
    provedAt: Math.floor(Date.now() / 1000),
  };
}

async function main(): Promise<void> {
  out('\n  Priming the results cache. The wallet sync takes minutes on a cold store.\n\n');

  const client = await connectFreeboard();
  try {
    const genesisHash = await chainId(client);
    out(`  network ${client.network}  contract ${client.deployment.address}\n`);
    out(`  chain   ${genesisHash}\n\n`);

    // Proved in order, and every one has to land: a cache missing a scenario
    // sends the dashboard to a live proof mid-demo, which is the thing this
    // exists to avoid. So nothing is written until all of them are in.
    const scenarios: ScenarioRecord[] = [];
    for (const s of CACHEABLE_SCENARIOS) scenarios.push(await prove(client, s));

    const cache: ResultsCache = {
      version: 1,
      network: client.network,
      genesisHash,
      contractAddress: client.deployment.address,
      scenarios,
    };
    saveResults(cache);

    const last = scenarios[scenarios.length - 1];
    out(`\n  ✅ ${scenarios.length} scenarios cached.\n`);
    // Said explicitly because it is the one thing about this design that surprises
    // people: the chain remembers the last check, not all of them.
    out(`     The ledger now reflects "${last.id}", the last one proved. Each\n`);
    out('     scenario reads from its own record, not from the ledger.\n\n');
  } finally {
    await client.persist();
    await client.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n  ❌ prime failed: ${message}\n\n`);
  process.exit(1);
});
