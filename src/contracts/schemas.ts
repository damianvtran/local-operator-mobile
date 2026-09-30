/**
 * Zod schemas for every relay payload — the app's boundary against a server it
 * does not control.
 *
 * NOT IMPLEMENTED. The protocol stream owns this file; the shape is fixed here so
 * the tree matches docs/architecture.md § "Module layout".
 *
 * What belongs here, from the architecture doc § "Type sharing": every frame the
 * relay can send is parsed through a schema before it reaches a store. Unknown
 * fields are PRESERVED rather than stripped, so a newer relay can add a field and
 * an older app keeps working, and a MISSING field falls back to the documented
 * default instead of rendering `undefined`. That is what makes the relay's
 * additive-only evolution rule safe on the client.
 *
 * The fixtures that these schemas must accept are captured from a real relay and
 * committed under `fixtures/relay/**` (see docs/relay/contract.md). A schema and a
 * sample that disagree is a bug in one of them, and CI re-captures the fixtures to
 * keep the two from drifting apart silently.
 */
export {};
