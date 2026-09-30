/**
 * The fetch wrapper: headers, origin, error taxonomy.
 *
 * NOT IMPLEMENTED. The protocol stream owns this file.
 *
 * What it has to do, from ADR 0001 § A and docs/architecture.md: use `expo/fetch`
 * (the global `fetch` on native since SDK 57), send the tunnel `Cookie` and the
 * `Origin` the edge demands, and use `credentials: "omit"` so the client owns the
 * cookie jar rather than fighting one — iOS sets `httpShouldHandleCookies = false`
 * and Android installs `CookieJar.NO_COOKIES` for exactly that combination.
 *
 * The boundary that matters (docs/architecture.md): `src/relay/` and
 * `src/connection/` never import from `src/features/` or `app/`, and never touch
 * `expo-secure-store` except through `connection/storage.ts`. That is what keeps
 * the protocol testable in Node and the mock relay usable from both unit tests
 * and the web target.
 */
export {};
