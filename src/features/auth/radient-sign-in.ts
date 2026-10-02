/**
 * Radient sign-in, as the screen needs to see it: a sequence of named states,
 * each of which can be rendered, and one of which is a real dead end.
 *
 * `src/connection/radient-oauth.ts` runs the flow; this module decides what the
 * screen says while it runs. The states are the ones `docs/ux/flows.md` § 1
 * names — browser open / cancelled / callback received / callback failed — plus
 * the one the platform adds:
 *
 * **`unavailable` is not an error state, it is a platform fact.** Radient's
 * only registered redirects are loopback (`http://127.0.0.1:<port>/callback`),
 * so the code arrives through either the browser session's own return value
 * (iOS: `ASWebAuthenticationSession` matches the callback itself) or a listener
 * on the device. Nothing in this build's dependency set binds that listener, so
 * `createDeviceListener()` throws `LoopbackUnavailableError` naming the module —
 * deliberately, so that an Android run fails loudly at sign-in instead of
 * opening a browser sheet whose code can never come back.
 *
 * The screen must therefore render a state that *says which module is missing
 * and offers the route that works today* (a URL and the relay password). A
 * spinner here is the failure mode the whole design exists to prevent: a user
 * who watches a sheet close with nothing happening has no way to tell a slow
 * callback from a platform that cannot deliver one.
 */

import { Platform } from "react-native";

import {
	type AuthBrowserSession,
	type CallbackListener,
	createDeviceListener,
	createSystemBrowserSession,
	DEVICE_LOOPBACK_MODULE_REQUEST,
	LoopbackUnavailableError,
	type RadientTokens,
	signInWithRadient,
} from "@/connection";

export type SignInState =
	/** Nothing started. The screen's resting state. */
	| { kind: "idle" }
	/** Preparing the PKCE pair and the redirect. Sub-second, but named so the
	 *  button can be busy rather than merely pressed. */
	| { kind: "starting" }
	/** The authorize URL is known and the system browser is opening. This is the
	 *  state a reader sits in while they sign in on the web page. */
	| { kind: "waiting-for-browser" }
	/** The code came back and is being exchanged. */
	| { kind: "exchanging" }
	/** The user closed the sheet without finishing. Not an error; never scolded. */
	| { kind: "cancelled" }
	/** This platform cannot receive the callback at all. Actionable: the screen
	 *  offers the relay-password route instead. */
	| { kind: "unavailable"; detail: string }
	/** The exchange failed. `detail` is the app's own sentence, never a status. */
	| { kind: "failed"; detail: string };

export type RadientSignInResult =
	| { ok: true; tokens: RadientTokens }
	| {
			ok: false;
			state: SignInState /** True when the reader may simply retry. */;
			retryable: boolean;
	  };

/**
 * Whether this platform can receive a loopback callback at all.
 *
 * iOS resolves through `ASWebAuthenticationSession`'s own return value and needs
 * no listener; the web target is a dev/QA surface with no browser sheet. Every
 * other platform needs a listener, which is exactly what this build does not
 * ship — so the screen says so before opening anything.
 */
export function needsDeviceListener(): boolean {
	return Platform.OS !== "ios" && Platform.OS !== "web";
}

/** The sentence the unavailable state shows. It names the module, because the
 *  fix is a dependency decision and a vague message would hide that. */
export const LOOPBACK_UNAVAILABLE_DETAIL =
	"Signing in with Radient needs a loopback listener this build does not include " +
	`(${DEVICE_LOOPBACK_MODULE_REQUEST}).`;

/**
 * A dismissal, which is not a failure.
 *
 * At module scope because the rule it encodes never changes: `sign-in was
 * cancelled` is the connection layer's own sentence for the sheet closing with no
 * URL. The screen shows "Sign-in was cancelled." with a way to try again — never
 * a scold, and never a retry loop the reader did not ask for.
 */
const CANCELLED = /cancelled|canceled/i;

export async function beginRadientSignIn(
	deps: {
		onState?: (state: SignInState) => void;
		signIn?: typeof signInWithRadient;
		browser?: AuthBrowserSession;
	} = {},
): Promise<RadientSignInResult> {
	const report = deps.onState ?? (() => undefined);
	report({ kind: "starting" });

	let listener: CallbackListener | undefined;
	if (needsDeviceListener()) {
		try {
			listener = await createDeviceListener();
		} catch (error) {
			if (error instanceof LoopbackUnavailableError) {
				const state: SignInState = {
					kind: "unavailable",
					detail: LOOPBACK_UNAVAILABLE_DETAIL,
				};
				report(state);
				return { ok: false, state, retryable: false };
			}
			throw error;
		}
	}

	const browser = deps.browser ?? (await createSystemBrowserSession());
	const signIn = deps.signIn ?? signInWithRadient;

	try {
		const tokens = await signIn({
			browser,
			listener,
			// Fires once the URL is built, so the screen can move to "waiting for
			// your browser" BEFORE the sheet appears rather than after it closes.
			onAuthorizeUrl: () => report({ kind: "waiting-for-browser" }),
		});
		report({ kind: "exchanging" });
		return { ok: true, tokens };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		/* A dismissal is not a failure. `sign-in was cancelled` is the connection
		 * layer's own sentence for the sheet closing with no URL, and the screen
		 * shows "Sign-in was cancelled." with a way to try again — never a scold. */
		if (CANCELLED.test(message)) {
			const state: SignInState = { kind: "cancelled" };
			report(state);
			return { ok: false, state, retryable: true };
		}
		const state: SignInState = {
			kind: "failed",
			detail:
				"We could not finish signing in. Try again, or use an address instead.",
		};
		report(state);
		return { ok: false, state, retryable: true };
	}
}
