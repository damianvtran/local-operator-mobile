/**
 * Mint, refresh, re-mint and revoke the tunnel session.
 *
 * NOT IMPLEMENTED. The connection stream owns this file.
 *
 * Two secrets live at rest, and only this module touches them: an opaque 30-day
 * tunnel-session refresh handle and a rolling 90-day Radient OAuth refresh token.
 * Both go to the platform keystore through `storage.ts` — no screen reads a token
 * (docs/architecture.md, principle 4).
 */
export {};
