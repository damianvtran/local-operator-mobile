// biome-ignore-all lint/performance/noReExportAll: this is a public API barrel for the layer; naming every export twice would be a maintenance cost with no reader benefit.
/**
 * The zustand stores. No React in here: a store is created by the app's provider
 * layer, so the same store can be driven from a test, from the web target and from
 * a Node smoke run.
 *
 * Three concerns, one rule each (`docs/architecture.md` §State management):
 *
 * | Store | Holds | Rule |
 * | --- | --- | --- |
 * | `connection-store` | active route, Radient identity label, connection health | the only place that can start or end a route |
 * | `list-store` | `SessionSummary[]` from `/api/sessions/events` | replaced wholesale on each push |
 * | `projection-store` | per-session projections | a frame is accepted only if it is the first of a connection or newer than what is held |
 *
 * `ui-store` (theme, text scale, sheets, toasts) is deliberately not here: it holds
 * presentation state, belongs to the UI layer, and nothing in the protocol or the
 * connection layer may depend on it.
 */

export * from "./connection-store";
export * from "./list-store";
export * from "./projection-store";
