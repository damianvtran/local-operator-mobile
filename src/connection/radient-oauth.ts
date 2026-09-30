/**
 * PKCE sign-in against Radient, through the system browser.
 *
 * NOT IMPLEMENTED. The connection stream owns this file.
 *
 * Two constraints it cannot work around. Sign-in runs in the SYSTEM browser
 * session (`openAuthSessionAsync` → ASWebAuthenticationSession on iOS, Chrome
 * Custom Tabs on Android), never in a WebView, because Google and Microsoft block
 * embedded WebViews. And the callback is a loopback listener, which ADR 0002
 * records as working today for `127.0.0.1`/`localhost`/`[::1]` with any port, so no
 * Radient change is needed for v1. `expo-crypto` supplies PKCE S256.
 */
export {};
