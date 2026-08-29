// Local shim for `cross-fetch`, injected via the "cross-fetch" override in
// package.json. Wraps the real cross-fetch and forces UNCOMPRESSED responses.
//
// WHY THIS EXISTS
// indexer-standalone 4.4.0-rc.x wraps its GraphQL API in a tower-http
// CompressionLayer and serves compressed, chunked responses. node-fetch 2.x —
// which cross-fetch 4.x uses under Node — fails to read those bodies and throws
// `ERR_STREAM_PREMATURE_CLOSE`, surfacing through the SDK as:
//
//   IndexerQueryError: Invalid response body while trying to fetch
//   http://127.0.0.1:18088/api/v4/graphql: Premature close
//
// which reads like a network fault and is not one. Verified 2026-08-28:
//   - node's built-in fetch (undici) reads the same response fine
//   - cross-fetch fails for gzip, br, zstd and the default (no header)
//   - cross-fetch succeeds with `Accept-Encoding: identity` or `compress: false`
//   - the ledger-8 indexer 4.3.3 does not compress, so it never hit this
// The Midnight SDK imports cross-fetch directly and exposes no way to supply a
// fetch implementation, so an override is the only injection point.
//
// COST: indexer responses travel uncompressed. Irrelevant on a local devnet;
// reconsider before pointing at a remote indexer over a slow link.
//
// REMOVE THIS when either side is fixed: cross-fetch moving to undici, or the
// indexer emitting bodies node-fetch can decode. Test by deleting the override
// and running `npm run deploy` — a "Premature close" means it is still needed.

const realFetch = require('cross-fetch-real');

function fetch(url, options) {
  const opts = { ...(options || {}) };
  opts.headers = { ...(opts.headers || {}), 'Accept-Encoding': 'identity' };
  // node-fetch-specific: skip adding Accept-Encoding and skip the decoder.
  // Harmless on implementations that ignore it.
  opts.compress = false;
  return realFetch(url, opts);
}

fetch.ponyfill = true;

module.exports = exports = fetch;
exports.fetch = fetch;
exports.Headers = realFetch.Headers;
exports.Request = realFetch.Request;
exports.Response = realFetch.Response;
exports.default = fetch;
