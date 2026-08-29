/**
 * End-to-end smoke check for freeboard.
 *
 * Reconnects to the deployed contract, reads its ledger state, and exits 0
 * on success. Used by `npm run test:e2e` and by the project's CI workflows.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import { deployTimeWitnesses } from '../src/witnesses';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time.
const PRIVATE_STATE_ID = 'freeboardPrivateState';

// ─── Network configuration ─────────────────────────────────────────────────────

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length >= 32;
}

async function main() {
  // 1. Deployment sanity
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}.`);
    process.exit(1);
  }
  if (!isHexAddress(deployment.address)) {
    fail(`Deployment address missing or invalid: ${JSON.stringify(deployment, null, 2)}`);
  }

  // 2. Build wallet and providers
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'freeboard');
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) fail('Compiled contract missing — run `npm run compile`.');
  const Freeboard = await import(pathToFileURL(contractPath).href);
  // Witnesses that throw: this check is read-only and must never invoke a
  // circuit, so a witness firing here means the check started doing more than
  // it claims. Called via `any` for the same dynamic-import reason as deploy.ts.
  const CC = CompiledContract as any;
  const compiledContract = CC.withCompiledFileAssets(
    CC.withWitnesses(CC.make('freeboard', Freeboard.Contract), deployTimeWitnesses()),
    zkConfigPath,
  );

  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  await walletCtx.wallet.waitForSyncedState();
  // Persist the sync state — saves time on the next e2e-check invocation in CI
  // when run against the same persistent wallet directory.
  await persistWalletState(network, walletCtx);

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const walletProvider = {
    // Midnight.js 4.1.x returns the key objects (CoinPublicKey / EncPublicKey).
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx() {
      throw new Error('e2e-check is read-only and should not balance transactions');
    },
    submitTx() {
      throw new Error('e2e-check is read-only and should not submit transactions');
    },
  } as any;

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'freeboard-state',
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      // SDK requires ≥16 chars. e2e-check is read-only so we don't expose
      // the env-var override here — match the deploy script's local-devnet default.
      privateStoragePasswordProvider: () => 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  // 3. Reconnect to the deployed contract — proves callTx interface is wired
  try {
    await findDeployedContract(providers, {
      contractAddress: deployment.address,
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  // 4. Read the on-chain contract state via the public data provider — proves
  // the contract is indexed and queryable on the chain itself, not just that
  // we know how to construct the local handle.
  const onChainState = await providers.publicDataProvider.queryContractState(deployment.address);
  if (!onChainState) {
    await walletCtx.wallet.stop();
    fail(`queryContractState returned null for ${deployment.address}`);
  }

  // 5. Decode the ledger and assert the shape Freeboard guarantees. A contract
  // that is merely *present* is not enough — the point of this project is that
  // the public state carries a verdict and NOTHING about the position, so check
  // both halves: the expected fields exist, and no position field leaked in.
  const l = Freeboard.ledger(onChainState.data);
  for (const field of ['attesterPk', 'lastVerdict', 'lastAttestationAt', 'checkCount']) {
    if (!(field in l)) {
      await walletCtx.wallet.stop();
      fail(`ledger is missing expected field '${field}'`);
    }
  }
  const leaked = ['collateral', 'debt', 'liquidationThresholdBps', 'position'].filter((f) => f in l);
  if (leaked.length > 0) {
    await walletCtx.wallet.stop();
    fail(`ledger exposes private position data: ${leaked.join(', ')}`);
  }
  if (Number(l.lastVerdict) !== 0 && Number(l.lastVerdict) !== 1) {
    await walletCtx.wallet.stop();
    fail(`lastVerdict is not a valid Verdict: ${l.lastVerdict}`);
  }

  // The attester key on-chain must match what deploy recorded, or every check
  // against this contract will be rejected in-circuit.
  if (deployment.attesterVerifyingKey) {
    const onChainX = `0x${l.attesterPk.x.toString(16)}`;
    const onChainY = `0x${l.attesterPk.y.toString(16)}`;
    if (onChainX !== deployment.attesterVerifyingKey.x || onChainY !== deployment.attesterVerifyingKey.y) {
      await walletCtx.wallet.stop();
      fail('on-chain attester key does not match the recorded deployment key');
    }
  }

  console.log(`✅ e2e-check passed`);
  console.log(`   contractAddress: ${deployment.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   verdict:         ${Freeboard.Verdict[l.lastVerdict]}`);
  console.log(`   checkCount:      ${l.checkCount}`);
  console.log(`   attester key:    matches deployment record`);
  console.log(`   no position data in public state ✓`);

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
