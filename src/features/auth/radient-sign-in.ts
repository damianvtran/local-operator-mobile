/**
 * Radient sign-in, as the screen needs to see it: a sequence of named states,
 * each of which can be rendered, and one of which is a real dead end.
 *
 * `src/connection/radient-oauth.ts` runs the flow; this module decides what the
 * screen says while it runs. The states are the ones `docs/ux/flows.md` § 1
 * names — browser open / cancelled / callback received / callback failed — plus
 * the one the platform adds:
 *
 * iOS binds an ephemeral IPv4 loopback listener before opening the system
 * browser. ASWebAuthenticationSession does not intercept HTTP callbacks.
 * Android owns a literal-loopback listener and a real Custom Tab; other native
 * platforms remain explicitly unavailable rather than opening a dead-end browser.

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
import { debugOAuthProofOrigin } from "@/connection/oauth-proof-override";
import { t } from "@/i18n";
import { signInErrorClass } from "./sign-in-diagnostics";

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
	| { kind: "failed"; detail: string; errorClass?: string };

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
 * iOS and Android browser adapters own native listeners; web remains a dev/QA
 * target. Other native platforms have no listener and fail explicitly.

 */
export function needsDeviceListener(): boolean {
	return !["ios", "android", "web"].includes(Platform.OS);
}

/** The sentence the unavailable state shows. It names the module, because the
 *  fix is a dependency decision and a vague message would hide that. The module id
 *  is a `{module}` placeholder, never translated: it is what a developer searches
 *  for. A function, not a constant, so the sentence is read from the catalogue
 *  that is active when the failure happens rather than at import time. */
export const loopbackUnavailableDetail = (): string =>
	t("mobile.signin.panel.unavailable_detail", {
		module: DEVICE_LOOPBACK_MODULE_REQUEST,
	});

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
		signal?: AbortSignal;
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
					detail: loopbackUnavailableDetail(),
				};
				report(state);
				return { ok: false, state, retryable: false };
			}
			throw error;
		}
	}

	const browser = deps.browser ?? (await createSystemBrowserSession());
	const signIn = deps.signIn ?? signInWithRadient;

	let exchanged = false;
	const exchanging = () => {
		if (!exchanged) {
			exchanged = true;
			report({ kind: "exchanging" });
		}
	};
	try {
		const proof = debugOAuthProofOrigin();
		const tokens = await signIn({
			authorizeUrl: proof ? `${proof}/authorize` : undefined,
			tokenUrl: proof ? `${proof}/token` : undefined,
			browser,
			signal: deps.signal,
			listener,
			// Fires once the URL is built, so the screen can move to "waiting for
			// your browser" BEFORE the sheet appears rather than after it closes.
			onAuthorizeUrl: () => report({ kind: "waiting-for-browser" }),
			onCallbackReceived: exchanging,
		});
		exchanging();
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
			errorClass: signInErrorClass(error),
			detail: t("mobile.signin.failed"),
		};
		report(state);
		return { ok: false, state, retryable: true };
	}
}
