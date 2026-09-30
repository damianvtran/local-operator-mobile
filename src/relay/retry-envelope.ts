/**
 * UUID-scoped command delivery.
 *
 * NOT IMPLEMENTED. The protocol stream owns this file.
 *
 * The rule it exists for (docs/architecture.md, principle 3): a command whose
 * delivery is UNKNOWN is persisted with its UUID and replayed with the SAME UUID,
 * never silently retried as a new instruction. The relay deduplicates by that
 * UUID, so a retry that invents a new one turns "did my message send?" into a
 * duplicate prompt to the agent.
 */
export {};
