/**
 * The own-tunnel connection test: one real request chain, one verdict.
 *
 * The verdict `classify` decides lives in `tunnel-verdict.ts`; this half is the
 * network work that feeds it, and it is the half that CANNOT be unit-tested in
 * Node (it needs `@/connection`). It is therefore proven outside-in, against the
 * mock relay, in the capture harness.
 *
 * **Verified against the mock relay**, in the harness: success, wrong password
 * (401), cross-origin refusal (403), computer offline (503), a TLS failure and an
 * unreachable host — see the PR for the frames and the commands.
 */

import {
	type CustomRoute,
	canSendRelayPassword,
	createRelayClient,
	signInToCustomRoute,
	validateCustomBaseUrl,
} from "@/connection";
import {
	classify,
	TUNNEL_TEST_TIMEOUT_MS,
	type TunnelTestResult,
} from "@/features/auth/tunnel-verdict";
import { RelayError } from "@/relay";

export type { TunnelTestResult } from "@/features/auth/tunnel-verdict";

/** Rejects when the work outlives the budget, so a hung socket is a verdict
 *  rather than a spinner. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error("tunnel test timeout")), ms);
	});
	try {
		return await Promise.race([work, limit]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Tests a tunnel the reader typed, and nothing else: no storage, no state, no
 * navigation. The caller decides what a verdict means.
 *
 * The admission check is the same one the sign-in screen uses: a browser reports
 * `fetch(..., { redirect: 'manual' })` as an OPAQUE redirection (status 0), so
 * "the relay answered 303" cannot be read there, and the honest question is
 * whether the LIST route answers.
 */
export async function runTunnelTest(input: {
	url: string;
	password: string;
	allowInsecure: boolean;
	timeoutMs?: number;
}): Promise<TunnelTestResult> {
	const validated = validateCustomBaseUrl(input.url, {
		allowInsecure: input.allowInsecure,
	});
	if (!validated.ok) {
		return {
			verdict: { kind: "invalid", reason: validated.reason },
			route: null,
			password: input.password,
		};
	}
	const route = validated.route;
	const timeoutMs = input.timeoutMs ?? TUNNEL_TEST_TIMEOUT_MS;
	try {
		const client = createRelayClient({ route, timeoutMs });
		/* A route that needs no password is tested by reading the list directly: the
		 *  login form would be a redirect to a page this app never renders. */
		if (canSendRelayPassword(route) && input.password.length > 0) {
			await withTimeout(
				signInToCustomRoute(route, input.password).then((result) => {
					/* An unreadable status is not a failure — the list read below is the
					 *  verdict either way, exactly as the sign-in screen does it. */
					if (
						!result.signedIn &&
						result.detail &&
						!result.detail.includes("HTTP 0")
					) {
						throw new RelayError("relay-unauthorized", result.detail, {
							detail: result.detail,
						});
					}
				}),
				timeoutMs,
			);
		}
		const frame = await withTimeout(client.sessions(), timeoutMs);
		return {
			verdict: { kind: "ok", sessions: frame.sessions.length },
			route,
			password: input.password,
		};
	} catch (error) {
		return { verdict: classify(error), route, password: input.password };
	}
}
