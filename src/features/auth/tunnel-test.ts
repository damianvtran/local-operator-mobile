/**
 * The own-tunnel connection test: one real request chain, one verdict.
 *
 * The verdict `classify` decides lives in `tunnel-verdict.ts`; this half is the
 * network work that feeds it.
 *
 * **What is proven here, through the `deps` seam.** `runTunnelTest` takes its
 * transport as a parameter, so a Node test drives the real branch chain — the real
 * client, the real admission read, the real classifier — with only the network
 * stubbed. That covers eight outcomes: success; a refused password (401); an
 * access-policy refusal (403); a sleeping computer or stopped daemon (503/502); a
 * 404; a request that never completes (timeout); a transport failure that arrives
 * untyped; and — because the seam hands the classifier a typed failure too — the two
 * causes a browser cannot name for us, `certificate-rejected` and `host-unresolved`.
 * (An earlier version of this comment said this half "CANNOT be unit-tested in Node";
 * the seam described below already disproved that, so the claim is narrowed.)
 *
 * **What is still unproven, and why.** A real browser cannot be made to produce a
 * rejected-certificate or DNS reason through `fetch` — Chrome withholds it — so no
 * capture in the harness reaches those two sentences end to end; they rest on the
 * classifier cases named above rather than on a frame. On native the platform does
 * report them, and nothing here has measured that: no simulator on this host, so a
 * device reading of a TLS failure and of an unresolvable host is the measurement
 * that would close it.
 *
 * This file previously claimed all six were verified in the harness. That was not true
 * of the taxonomy (QA measured five different faults all rendering "That password was
 * not accepted.", because a dead guard below rethrew every failure as
 * `relay-unauthorized`), so the claim is replaced by the above.
 */

import {
	canSendRelayPassword,
	createRelayClient,
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
export async function runTunnelTest(
	input: {
		url: string;
		password: string;
		allowInsecure: boolean;
		timeoutMs?: number;
	},
	/** The transport, injectable for tests only — production passes nothing and the
	 *  client uses `fetch`. Without this seam the branching below (which fault becomes
	 *  which verdict) can only be exercised against a live relay, and the bug it just
	 *  had was exactly a branch nothing could reach. */
	deps: { fetchImpl?: typeof globalThis.fetch } = {},
): Promise<TunnelTestResult> {
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
		const client = createRelayClient({
			route,
			timeoutMs,
			...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
		});
		/* A route that needs no password is tested by reading the list directly: the
		 *  login form would be a redirect to a page this app never renders. */
		if (canSendRelayPassword(route) && input.password.length > 0) {
			const outcome = await withTimeout(
				client.login(input.password),
				timeoutMs,
			);
			/* A refusal the relay STATES is the verdict; anything else falls through to
			 *  the list read below, which is the shape this app uses everywhere else.
			 *
			 *  What this replaces, and why it was a defect: the previous guard threw
			 *  `relay-unauthorized` for every failure whose `detail` did not contain
			 *  `"HTTP 0"` — a string nothing produces — so a whole-relay 503, a 403
			 *  access policy, a rejected certificate, an unresolvable host and a timeout
			 *  were ALL rethrown as "wrong password" and the taxonomy's own sentences
			 *  were unreachable from this screen. QA measured exactly that on five
			 *  faults. `verified` is the honest discriminator: it is true when the
			 *  outcome came from the admission read rather than from a status the
			 *  platform showed, which is the browser's opaque-redirect case — there the
			 *  list read is the verdict, never a guess about the password. */
			if (!outcome.signedIn && !outcome.verified) {
				throw new RelayError("relay-unauthorized", "password refused", {
					detail: outcome.detail ?? "That password was not accepted.",
				});
			}
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
