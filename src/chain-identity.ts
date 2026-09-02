// Chain identity: which chain am I actually talking to?
//
// The wallet sync cache is only valid for the chain it was built against, and
// the serialized blobs carry no chain marker of their own (see wallet-state.ts).
// The genesis block hash is the cheapest durable answer: it is fixed for the
// life of a chain, and a local devnet torn down and brought back up gets a new
// one — which is exactly the case that used to hang a run for 16 minutes with
// no error.
//
// Deliberately no SDK dependency: this is one JSON-RPC call against the node, so
// it stays usable from anywhere (deploy, CLI, the web API route) without having
// to construct a wallet first.

/** Thrown when the chain refuses to identify itself. Callers should fail closed. */
export class GenesisHashUnavailableError extends Error {
  constructor(url: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Could not read the genesis hash from ${url}: ${detail}`);
    this.name = 'GenesisHashUnavailableError';
  }
}

/**
 * Normalise a configured node URL for JSON-RPC over HTTP. NETWORK_CONFIGS holds
 * `ws://` for the local devnets and `https://` for the public networks; a
 * Substrate node serves JSON-RPC over both, but `fetch` needs the http form.
 * wallet.ts does this same conversion in reverse for the SDK's relay URL.
 */
export function toHttpRpcUrl(nodeUrl: string): string {
  return nodeUrl.replace(/^ws(s?):\/\//i, 'http$1://');
}

const GENESIS_HASH_RE = /^0x[0-9a-f]{64}$/i;

/**
 * Read the genesis block hash (`chain_getBlockHash` at height 0).
 *
 * The result shape is validated rather than trusted: a proxy or captive portal
 * answering 200 with HTML would otherwise become a cache key, and a bad key is
 * worse than no key — it would silently invalidate a good cache on every run,
 * or worse, match by accident.
 */
export async function fetchGenesisHash(
  nodeUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const url = toHttpRpcUrl(nodeUrl);

  let payload: unknown;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'chain_getBlockHash', params: [0] }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    payload = await res.json();
  } catch (err) {
    throw new GenesisHashUnavailableError(url, err);
  }

  const body = payload as { result?: unknown; error?: { message?: unknown } };
  if (body?.error) {
    throw new GenesisHashUnavailableError(url, `RPC error: ${String(body.error.message ?? 'unknown')}`);
  }
  if (typeof body?.result !== 'string' || !GENESIS_HASH_RE.test(body.result)) {
    throw new GenesisHashUnavailableError(url, `unexpected result: ${JSON.stringify(body?.result)?.slice(0, 80)}`);
  }

  // Lowercased so comparison against a stored value never turns on casing.
  return body.result.toLowerCase();
}
