// `cross-fetch`, replaced by Node's own fetch.
//
// WHY, precisely. The Midnight SDK does `import fetch from 'cross-fetch'` in two
// providers and offers no way to supply an implementation. cross-fetch 4.x loads its
// OWN nested node-fetch 2.7.0 (the repo's top-level node-fetch is 3.3.2 and is not
// what it uses), and node-fetch 2.7.0 cannot read a chunked response with no
// `content-length` under a modern Node — it throws ERR_STREAM_PREMATURE_CLOSE, which
// the SDK surfaces as:
//
//   IndexerQueryError: Invalid response body while trying to fetch ...: Premature close
//
// That reads like a network fault and is not one. Measured against a local server on
// Node 24.17.0 (a two-write chunked body, no content-length):
//
//   node built-in fetch      -> reads it
//   cross-fetch 4.1.0        -> ERR_STREAM_PREMATURE_CLOSE
//   node-fetch 3.3.2         -> reads it
//   node-fetch 2.7.0         -> reads it WITH content-length, fails WITHOUT
//
// The original fix set `Accept-Encoding: identity`, on the theory that compression
// was the problem. It is not: compression is only what makes the indexer chunk its
// replies. Verified — with `identity` on the wire, a chunked no-length body STILL
// failed. So the header treated a symptom, and an indexer that chunks without
// compressing would have broken it again with no warning.
//
// Node's built-in fetch (undici) has no such limitation and is what the SDK's own
// comment says browsers get. Both call sites were checked against it directly:
//
//   indexer-public-data-provider  passes `fetch` into Apollo's HttpLink; Apollo reads
//                                 the body with .text()/.json() — confirmed working
//                                 on a chunked no-length body.
//   http-client-proof-provider    POSTs a Uint8Array with an
//                                 `AbortSignal.timeout()` and reads .arrayBuffer() —
//                                 confirmed working with that exact call shape.
//
// So this shim delegates to `globalThis.fetch` rather than wrapping node-fetch, and
// the compression workaround is gone with it. Requires Node 18+ for global fetch,
// which `engines` already demands (>=22).
//
// The export shape mirrors cross-fetch's node ponyfill exactly — default export, a
// named `fetch`, plus Headers/Request/Response — because any missing member is a
// runtime error deep inside a provider. All four are globals on Node 18+.

const fetch = (...args) => globalThis.fetch(...args);

// cross-fetch sets this and some consumers check it.
fetch.ponyfill = true;

module.exports = exports = fetch;
exports.fetch = fetch;
exports.Headers = globalThis.Headers;
exports.Request = globalThis.Request;
exports.Response = globalThis.Response;
exports.default = fetch;
