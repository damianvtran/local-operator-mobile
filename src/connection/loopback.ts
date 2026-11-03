/**
 * The loopback callback: the piece of Radient sign-in that the platform decides.
 *
 * `ADR 0002` §1 chooses Option A — reuse the existing `lop` OAuth client, whose
 * only registered redirects are `http://localhost/callback`,
 * `http://127.0.0.1/callback` and `http://[::1]/callback` on a port the client
 * supplies. Custom schemes are not accepted by either the control plane
 * (`oauth_redirect.go`) or the console (`native-oauth.ts`), so there is no
 * scheme-registration shortcut: a listener on loopback is the design.
 *
 * iOS binds a real, device-local HTTP listener through the local Expo module.
 * ASWebAuthenticationSession's custom-scheme initializer cannot intercept HTTP;
 * its newer host/path callback API supports HTTPS, not this registered redirect.
 * Android still needs a native listener and remains explicitly unavailable.
 */

import { type CryptoDeps, randomState } from "./pkce";

/** What the listener hands back. `state` is checked by the caller against the one
 *  it generated — a listener that returned a code without a matching state would
 *  silently accept a code injected by another app on the device. */
export interface CallbackResult {
	code: string;
	state: string;
}

/** A bound loopback listener. */
export interface CallbackListener {
	/** Must be a `http://127.0.0.1:<port>/callback`-shaped literal host with an
	 *  explicit port: `validOAuthRedirect` requires both. */
	readonly redirectUri: string;
	/** Resolves with the first well-formed callback, rejects on timeout or abort. */
	waitForCode(): Promise<CallbackResult>;
	/** Idempotent, and called on every exit path — including cancel and timeout. A
	 *  listener that outlives the flow is an open port on the user's device. */
	close(): Promise<void>;
}

/** The system-browser session, which on iOS is also the callback transport. */
export interface AuthBrowserSession {
	/** Bind an ephemeral loopback port before constructing the authorize URL. */
	prepareRedirect?(): Promise<string>;
	/** Opens `authorizeUrl` and resolves with the URL the platform handed back, or
	 *  `null` when the platform cannot hand one back. */
	open(authorizeUrl: string, redirectUri: string): Promise<string | null>;
	/** False on an Android Custom Tab, which resolves on close and returns no URL.
	 *  Read by the sign-in flow to decide whether a listener is mandatory rather
	 *  than optional. */
	readonly returnsCallback: boolean;
	/** Best-effort dismissal. Never awaited as if it were reliable: Android cannot
	 *  do it from JavaScript at all. */
	dismiss(): Promise<void>;
}

export class LoopbackUnavailableError extends Error {
	override readonly name = "LoopbackUnavailableError";
}

/** The callback path every registered redirect uses. */
export const CALLBACK_PATH = "/callback";

/**
 * The one-line page the listener serves at `/callback`.
 *
 * It has to render something: on the Android fallback path the browser really
 * does navigate here, and a blank tab looks broken. This is also the copy that
 * tells the user to switch back, which Android cannot do for them.
 */
export const CALLBACK_PAGE_HTML = [
	"<!doctype html>",
	'<html lang="en"><head><meta charset="utf-8">',
	'<meta name="viewport" content="width=device-width, initial-scale=1">',
	"<title>Signed in</title>",
	"<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:48px 24px;text-align:center}</style>",
	"</head><body><h1>Signed in</h1>",
	"<p>You can return to the app now.</p>",
	"</body></html>",
	"",
].join("\n");

/**
 * The dependency this project needs for Android sign-in, named once so the code
 * and the pull request cannot disagree about what is missing.
 *
 * A tiny React Native HTTP server module (any of the maintained
 * `react-native-http-bridge`-class packages, or the loopback half of
 * `expo-auth-session`) is enough: this module needs `listen` on 127.0.0.1 with an
 * ephemeral port, one route, and a clean close.
 */
export const DEVICE_LOOPBACK_MODULE_REQUEST =
	"a native 127.0.0.1 HTTP server module (e.g. react-native-http-bridge) or the loopback half of expo-auth-session";

/** Extracts `code`/`state` from a callback URL and verifies the state. Shared by
 *  both platforms' capture paths, because the check must not depend on which one
 *  delivered the code. */
export function parseCallbackUrl(
	url: string,
	expectedState: string,
	expectedRedirectUri?: string,
): CallbackResult {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new LoopbackUnavailableError("the callback URL could not be parsed");
	}
	// Scheme-only callback matching is not an origin check. Validate even when a
	// platform claims success, and pin the ephemeral port used for this attempt.
	if (
		parsed.protocol !== "http:" ||
		parsed.hostname !== "127.0.0.1" ||
		!parsed.port ||
		parsed.pathname !== CALLBACK_PATH ||
		parsed.hash ||
		parsed.username ||
		parsed.password ||
		(expectedRedirectUri &&
			`${parsed.origin}${parsed.pathname}` !== expectedRedirectUri) ||
		parsed.searchParams.getAll("state").length !== 1 ||
		parsed.searchParams.get("state") !== expectedState
	) {
		throw new LoopbackUnavailableError(
			"the callback origin, path or state did not match; the code was discarded",
		);
	}
	const code = parsed.searchParams.get("code");
	const state = parsed.searchParams.get("state");
	const error = parsed.searchParams.get("error");
	if (error) {
		/* The console reports a refusal (a cancelled consent, a bad client) in the
		 * query string rather than as an HTTP status. */
		throw new LoopbackUnavailableError(
			`the authorization server refused: ${error}`,
		);
	}
	if (!code)
		throw new LoopbackUnavailableError(
			"the callback carried no authorization code",
		);
	if (state !== expectedState) {
		/* A mismatched state means this code was not produced by our authorization
		 * request. Drop it rather than signing in to somebody else's session. */
		throw new LoopbackUnavailableError(
			"the callback state did not match; the code was discarded",
		);
	}
	return { code, state };
}

/** The `expo-web-browser` session, imported lazily so Node never resolves it. */
export async function createSystemBrowserSession(): Promise<AuthBrowserSession> {
	// Keep native loading lazy: Node/web do not have an iOS Expo module. A real
	// listener, not callbackURLScheme="http", is required for registered redirects.
	const { Platform } = await import("react-native");
	if (Platform.OS === "ios") {
		const { requireNativeModule } = await import("expo");
		const native = requireNativeModule("RadientLoopback");
		return {
			returnsCallback: true,
			prepareRedirect: () => native.prepare(),
			open: (url, redirect) => native.open(url, redirect),
			dismiss: () => native.dismiss(),
		};
	}
	/* Lazy import for the same reason as the keystore: Node never loads the native
	 * module. The shape is declared for the subset used and each member is checked
	 * for presence before it is called. */
	const module = (await import("expo-web-browser")) as unknown as {
		openAuthSessionAsync: (
			url: string,
			redirectUrl: string,
			options?: Record<string, unknown>,
		) => Promise<{ type: string; url?: string }>;
		dismissBrowser?: () => Promise<void>;
		dismissAuthSession?: () => Promise<void>;
	};
	return {
		/* `preferUniversalLinks` stays unset: an https callback is ADR 0002's Option C
		 * (a hardening path that needs a Radient-side registration), not v1. */
		returnsCallback: true,
		async open(authorizeUrl, redirectUri) {
			const result = await module.openAuthSessionAsync(
				authorizeUrl,
				redirectUri,
			);
			return result.type === "success" && result.url ? result.url : null;
		},
		async dismiss() {
			const dismiss = module.dismissAuthSession ?? module.dismissBrowser;
			await dismiss?.();
		},
	};
}

/**
 * Builds a `http://127.0.0.1:<port>/callback` redirect for a bound port.
 *
 * The host is the literal `127.0.0.1`, not `localhost`: the console's whitelist
 * is a loopback regex requiring a port, and `validOAuthRedirect` matches a literal
 * loopback host, so a name that resolves differently on a device with a modified
 * resolver is not worth the risk.
 */
export function loopbackRedirectUri(
	port: number,
	path: string = CALLBACK_PATH,
): string {
	return `http://127.0.0.1:${port}${path}`;
}

/**
 * The device listener.
 *
 * Not implemented, and it says so in one place: see
 * `DEVICE_LOOPBACK_MODULE_REQUEST`. The iOS happy path does not need it (the
 * browser session returns the URL itself); Android does, and a hanging sign-in
 * would be a worse failure than this error.
 */
export async function createDeviceListener(): Promise<CallbackListener> {
	throw new LoopbackUnavailableError(
		`no loopback listener is available on this build: it needs ${DEVICE_LOOPBACK_MODULE_REQUEST}`,
	);
}

/** The pair of collaborators a sign-in needs, so the flow never constructs a
 *  browser or a listener itself and a test can supply both. */
export interface SignInTransport {
	listener?: CallbackListener;
	browser: AuthBrowserSession;
}

/** Random state for one sign-in attempt, from the injected crypto. */
export async function newState(deps: CryptoDeps = {}): Promise<string> {
	return await randomState(deps);
}
