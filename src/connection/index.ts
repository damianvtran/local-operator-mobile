// biome-ignore-all lint/performance/noReExportAll: this is a public API barrel for the layer; naming every export twice would be a maintenance cost with no reader benefit.
/**
 * Routes, identity and credentials.
 *
 * The one boundary this directory must not cross: **`storage.ts` is the only
 * module here that touches `expo-secure-store`.** Everything else takes
 * credentials as plain values, which is what makes the OAuth flow, the tunnel
 * session lifecycle and discovery testable in Node — and what keeps a token out of
 * a screen, a log and a screenshot.
 *
 * Nothing under `src/connection/` or `src/relay/` imports from `src/features/` or
 * `app/` (`docs/architecture.md` "Module layout").
 */

export * from "./client-factory";
export * from "./discovery";
export * from "./loopback";
export * from "./pkce";
export * from "./profile";
export * from "./radient-oauth";
export * from "./storage";
export * from "./tunnel-session";
