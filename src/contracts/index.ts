// biome-ignore-all lint/performance/noReExportAll: this is a public API barrel for the layer; naming every export twice would be a maintenance cost with no reader benefit.
/**
 * The relay wire contract.
 *
 * `types.gen.ts` is the hand-authored mirror of the relay's dataclasses,
 * `schemas.ts` is the runtime validation of every payload, and `parse.ts` is the
 * only door between them and the rest of the app. `src/relay/` is the only
 * module allowed to call into this layer; `src/features/` and `app/` read the
 * inferred payload types and never a raw frame.
 */

export * from "./parse";
export * from "./project-status";
export * from "./schemas";
export type * from "./types.gen";
