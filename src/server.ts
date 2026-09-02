// Freeboard local service — the Midnight side of the web demo.
//
// WHY THIS IS A SEPARATE PROCESS AND NOT A NEXT ROUTE HANDLER
//
// 1. freeboard-client.ts is hard server-only: it imports node:fs/path/url, reads
//    the compiled prover keys through NodeZkConfigProvider, opens a LevelDB
//    private-state store that takes an EXCLUSIVE lock, and loads the attester
//    signing key — all relative to the repo root as cwd. Plus the dependency
//    tree carries a WASM binary. None of that wants to be inside a bundler's
//    module graph, and keeping it out means no serverExternalPackages, no
//    transpilePackages, and no argument with Turbopack.
//
// 2. connectFreeboard() is expensive by design; its own docstring says a web
//    server should keep one per process. Next re-evaluates route handlers when
//    you edit them, so a wallet held in a route module is thrown away on every
//    save — a re-sync per keystroke while building UI. Here it survives.
//
// 3. The attester signing key and the wallet seed never leave this process, so
//    they cannot reach a client bundle by construction rather than by care.
//
// SECURITY — READ THIS BEFORE CHANGING THE BIND ADDRESS.
// This service has NO AUTHENTICATION and it holds a signing key plus a funded
// devnet wallet. Anything that can reach it can sign arbitrary positions and
// spend. Binding to loopback IS the access control. Do not bind 0.0.0.0, do not
// map it out of a container, do not put it behind a tunnel. Local development
// only, against a local devnet.
//
// CONCURRENCY. Checks are serialized through a one-slot queue. The witness slot
// in freeboard-client is module-private and shared across calls, so two
// overlapping submitCheck() calls would race it and one proof would be built
// from the other's position. The CLI cannot reach that state (one check at a
// time by construction); an HTTP server reaches it on the second request.

import * as http from 'node:http';

import { fetchGenesisHash } from './chain-identity';
import {
  connectFreeboard,
  type CheckInput,
  type CheckResult,
  type FreeboardClient,
  type LedgerView,
  type StagedCheck,
} from './freeboard-client';
import { getDeployment, resolveNetwork } from './network';
import { loadResults, type ScenarioRecord } from './results-cache';
import { SCENARIOS } from './scenarios';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FREEBOARD_PORT ?? 4310);

/** Circuit field widths. Rejecting at the edge beats failing deep in a proof. */
const MAX_U64 = 2n ** 64n - 1n;
const MAX_U32 = 2n ** 32n - 1n;
const MAX_U16 = 2n ** 16n - 1n;

// ─── JSON, with bigints ────────────────────────────────────────────────────────

// Every numeric field that crosses this boundary is a bigint, and several of them
// exceed Number.MAX_SAFE_INTEGER (a Uint<64> collateral, a tNight balance). They
// go out as decimal STRINGS, not numbers, so nothing silently loses precision on
// the way to the browser.
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, jsonReplacer);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // Nothing here is cacheable: a verdict is a point-in-time read.
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

class BadRequest extends Error {}

/**
 * Parse one required unsigned integer field. Accepts a JSON number or a decimal
 * string, because a browser cannot send a bigint as JSON and 10^19 does not
 * survive as a double.
 */
function uint(body: Record<string, unknown>, key: string, max: bigint): bigint {
  const raw = body[key];
  if (raw === undefined || raw === null) throw new BadRequest(`${key} is required`);
  if (typeof raw === 'number' && !Number.isSafeInteger(raw)) {
    throw new BadRequest(`${key} is not a safe integer; send it as a decimal string`);
  }
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new BadRequest(`${key} must be a number or a decimal string`);
  }
  if (typeof raw === 'string' && !/^\d+$/.test(raw.trim())) {
    throw new BadRequest(`${key} must be a non-negative integer`);
  }

  const value = BigInt(typeof raw === 'number' ? Math.trunc(raw) : raw.trim());
  if (value < 0n) throw new BadRequest(`${key} must not be negative`);
  if (value > max) throw new BadRequest(`${key} exceeds the circuit's field width (max ${max})`);
  return value;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A check request is a handful of integers. Anything larger is not one.
    if (size > 16_384) throw new BadRequest('request body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequest('body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw err instanceof BadRequest ? err : new BadRequest('body is not valid JSON');
  }
}

// ─── The one client, and the queue that protects it ────────────────────────────

let client: FreeboardClient | null = null;
let connecting: Promise<FreeboardClient> | null = null;

/**
 * Connect once per process, and only once even if several requests arrive during
 * the sync. On failure the in-flight promise is cleared so the next request can
 * retry rather than inheriting a permanently rejected one.
 */
async function getClient(): Promise<FreeboardClient> {
  if (client) return client;
  if (!connecting) {
    connecting = connectFreeboard()
      .then((c) => {
        client = c;
        return c;
      })
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}

/** Serializes checks. See the CONCURRENCY note in the file header. */
let checkQueue: Promise<unknown> = Promise.resolve();

function queued<T>(work: () => Promise<T>): Promise<T> {
  const run = checkQueue.then(work, work);
  // Swallow on the chain itself so one failure does not poison later entries.
  checkQueue = run.then(() => undefined, () => undefined);
  return run;
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * Liveness plus enough context for the UI to explain itself before the wallet is
 * up. Deliberately does NOT force a connect: the point is to be answerable during
 * the sync, so a dashboard can say "connecting" instead of hanging on its first
 * paint.
 */
function health(): Record<string, unknown> {
  const { network } = resolveNetwork();
  return {
    ok: true,
    network,
    connected: client !== null,
    connecting: client === null && connecting !== null,
  };
}

async function verdict(): Promise<{ ledger: LedgerView | null }> {
  const c = await getClient();
  return { ledger: await c.readLedger() };
}

/**
 * The preset scenarios, each with the record of when it was last proved.
 *
 * Like /health, this deliberately does NOT connect. A cached record that waits on
 * a wallet sync has bought nothing, so everything here is one file read, one
 * deploy-record read and one JSON-RPC call.
 *
 * These records are the authority for their own scenario; /verdict is a SEPARATE
 * current-chain-state view of the single `lastVerdict` slot. results-cache.ts
 * explains why they cannot be the same thing.
 */
async function scenarios(): Promise<Record<string, unknown>> {
  const { network, config } = resolveNetwork();
  const deployment = getDeployment(network);

  // Short timeout on purpose: this endpoint paints a page. A node that is not
  // answering should degrade to `chain-unknown` promptly rather than hold the
  // request open for the RPC default.
  let genesisHash: string | null = null;
  try {
    genesisHash = await fetchGenesisHash(config.node, { timeoutMs: 2_500 });
  } catch {
    genesisHash = null;
  }

  const { cache, status } = loadResults(genesisHash, deployment?.address ?? null);
  const byId = new Map<string, ScenarioRecord>((cache?.scenarios ?? []).map((r) => [r.id, r]));

  return {
    chain: { network, genesisHash, contractAddress: deployment?.address ?? null },
    cache: {
      status,
      network: cache?.network ?? null,
      genesisHash: cache?.genesisHash ?? null,
      contractAddress: cache?.contractAddress ?? null,
      /** Records on disk, whatever their binding says. Non-zero with a non-`current`
       *  status is the "re-run npm run prime" case. */
      records: cache?.scenarios.length ?? 0,
    },
    scenarios: SCENARIOS.map((s) => ({
      id: s.id,
      label: s.label,
      summary: s.summary,
      liveOnly: s.liveOnly,
      input: s.input,
      // Populated ONLY when the binding holds, so a record from a dead chain can
      // never be rendered as though it were current. `liveOnly` scenarios never
      // carry one at all.
      cached: status === 'current' ? byId.get(s.id) ?? null : null,
    })),
  };
}

/**
 * Stage and prove one check.
 *
 * The staged view goes back alongside the result because the tamper demo is only
 * legible when the UI can show what was signed next to what was submitted — the
 * same reason StagedCheck keeps both.
 */
async function check(body: Record<string, unknown>): Promise<{
  staged: Omit<StagedCheck, 'signature'>;
  result: CheckResult;
}> {
  const input: CheckInput = {
    collateral: uint(body, 'collateral', MAX_U64),
    debt: uint(body, 'debt', MAX_U64),
    liquidationThresholdBps: uint(body, 'liquidationThresholdBps', MAX_U16),
    minHealthFactorBps: uint(body, 'minHealthFactorBps', MAX_U32),
    tamper: body.tamper === true,
  };

  const c = await getClient();
  return queued(async () => {
    const staged = c.stage(input);
    const result = await c.submitCheck(staged);
    await c.persist();
    // The signature is dropped rather than serialized: it is a JubjubPoint pair
    // that means nothing to a browser, and shipping it invites someone to treat
    // the client as the verifier. The circuit is the verifier.
    const { signature: _signature, ...rest } = staged;
    return { staged: rest, result };
  });
}

// ─── Routing ───────────────────────────────────────────────────────────────────

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method } = req;
  const path = new URL(req.url ?? '/', `http://${HOST}:${PORT}`).pathname;

  if (method === 'GET' && path === '/health') return send(res, 200, health());
  if (method === 'GET' && path === '/scenarios') return send(res, 200, await scenarios());
  if (method === 'GET' && path === '/verdict') return send(res, 200, await verdict());
  if (method === 'POST' && path === '/check') return send(res, 200, await check(await readJsonBody(req)));

  send(res, 404, {
    error: 'not found',
    routes: ['GET /health', 'GET /scenarios', 'GET /verdict', 'POST /check'],
  });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof BadRequest) return send(res, 400, { error: message });

    // A missing deployment or an uncompiled contract is a setup problem the UI can
    // act on, so it gets 503 and the message rather than an opaque 500. Both carry
    // their own remedy text ("Run: npm run compile", "npm run setup ...").
    const isSetup = /not compiled|No deploy on file/i.test(message);
    process.stderr.write(`  ✖ ${req.method ?? '?'} ${req.url} -> ${message}\n`);
    send(res, isSetup ? 503 : 500, { error: message });
  });
});

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

let shuttingDown = false;

/**
 * Release the LevelDB lock and save the wallet cache on the way out. An unclean
 * exit leaves midnight-level-db/LOCK held, and the next process cannot open it.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\n  ${signal}: closing...\n`);

  server.close();
  if (client) {
    try {
      await client.persist();
      await client.close();
      process.stdout.write('  wallet cache saved, private-state store released.\n');
    } catch (err) {
      process.stderr.write(`  ⚠ unclean shutdown: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

server.listen(PORT, HOST, () => {
  const { network } = resolveNetwork();
  process.stdout.write(
    `\n  freeboard service on http://${HOST}:${PORT}  (network: ${network})\n` +
      '  loopback only, no auth — it holds a signing key. See the header comment.\n' +
      '  GET /health   GET /scenarios   GET /verdict   POST /check\n\n' +
      '  /health and /scenarios answer without connecting. The wallet connects on\n' +
      '  the first /verdict or /check and is then held for the life of this process.\n\n',
  );
});




