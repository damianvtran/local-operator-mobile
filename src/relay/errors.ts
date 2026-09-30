/**
 * The error taxonomy: HttpError, EdgeRefusal, RelayRefusal.
 *
 * NOT IMPLEMENTED. The protocol stream owns this file.
 *
 * The distinctions that matter, from docs/architecture.md § "Compatibility
 * signals": a `503` from the gateway carries a `{reason}` and means the computer
 * cannot be reached (a UI state, not a transport state), while an `X-Radient-Login`
 * header or a 401 means the identity has lapsed and the reader has to sign in
 * again. An UNRECOGNISED reason must render as a generic but honest row — "Something
 * new from your computer — update the app to read it" — rather than crash or vanish.
 */
export {};
