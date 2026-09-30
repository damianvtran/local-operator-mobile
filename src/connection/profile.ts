/**
 * The connection profile: which computer the app is talking to, and how.
 *
 * NOT IMPLEMENTED. The connection stream owns this file.
 *
 * A "route" (a Radient tunnel or a custom URL) is a connection profile, and the
 * UI and the relay client do not know which one is in use beyond a header policy
 * (docs/architecture.md, principle 6: one route at a time). A custom route carries
 * a URL plus the relay password; the Radient route carries the identity's tunnel
 * session. Both resolve to the same configured client through client-factory.ts.
 */
export {};
