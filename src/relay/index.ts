// biome-ignore-all lint/performance/noReExportAll: this is a public API barrel for the layer; naming every export twice would be a maintenance cost with no reader benefit.
/**
 * The relay protocol client: no UI, no navigation, no `expo-*` import anywhere
 * under this directory, so all of it runs in Node and can be exercised by unit
 * tests and by `scripts/relay-smoke.mjs` against a real relay.
 *
 * The layering, and the one rule per file:
 *
 * | Module | Owns |
 * | --- | --- |
 * | `errors.ts` | status → typed error → envelope directive, retry directive, UI surface |
 * | `http.ts` | the header and cookie contract, redirects, caching, timeouts, status mapping |
 * | `sse.ts` | framing, keep-alives, the 60 s rotation, the snapshot fence |
 * | `endpoints.ts` | one typed function per route; nothing above it builds a path |
 * | `retry-envelope.ts` | the persisted-command rules, as a pure module |
 */

export * from "./endpoints";
export * from "./errors";
export * from "./http";
export * from "./platform-fetch";
export * from "./retry-envelope";
export * from "./send-command";
export * from "./sse";
