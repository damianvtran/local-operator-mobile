/**
 * The own-tunnel verdicts: what a failure IS, and the sentence a reader gets.
 *
 * Split from `tunnel-test.ts` for this repo's own reason (`vitest.config.ts`):
 * units run in Node, so anything a test touches must not import `react-native` —
 * and the runner needs `@/connection`, which does. The taxonomy is the part worth
 * asserting, and it is free of both.
 *
 * **The sentences are the taxonomy's, not status codes.** `src/relay/errors.ts`
 * decides which KIND a failure is; this module turns that kind into something a
 * reader can act on, exactly as `refusal.ts` does for the surfaces. Nobody is told
 * "HTTP 503".
 */

import type { SentencePlatform } from "@/lib/platform";
import { RelayError } from "@/relay";

/** How long a test may take before the app calls it a timeout — exported so the
 *  sentence and the budget cannot drift apart. */
export const TUNNEL_TEST_TIMEOUT_MS = 8_000;

export type TunnelTestVerdict =
	/** The URL and password work; the relay answered with a session count. */
	| { kind: "ok"; sessions: number }
	/** The address the reader typed is not usable, before any request. */
	| { kind: "invalid"; reason: string }
	| { kind: "password" }
	/** 403: something in front of the relay refused the request. */
	| { kind: "forbidden"; detail: string | null }
	/** 503 / 502: the tunnel exists but nothing is answering behind it. */
	| { kind: "offline"; detail: string | null; remedy: string }
	/** The certificate was rejected: a self-signed provider edge, or a certificate
	 *  that does not cover this hostname. */
	| { kind: "tls"; detail: string | null }
	/** The host NAME could not be resolved — a typo, or a tunnel that no longer
	 *  publishes it. Distinct from `unreachable` on purpose: the reader fixes these
	 *  in two different places (the address vs the tunnel), and a single "could not
	 *  reach it" would send them to the wrong one. */
	| { kind: "host"; detail: string | null }
	/** The name resolved and nothing answered: refused, no route, dead tunnel. */
	| { kind: "unreachable"; detail: string | null }
	/** The address did not answer in time. */
	| { kind: "timeout" }
	/** A PRIVATE-network address did not answer: either the computer is not
	 *  reachable there, or the OS is holding the app's local-network access —
	 *  iOS's one-time permission, or Android 17's blocked-by-default grant. The
	 *  two causes are indistinguishable from the failure itself: neither platform
	 *  reports its gate's state to the app, and neither denial carries a documented
	 *  signature (TN3179 only describes the Network framework's `localNetworkDenied`
	 *  state, which a `fetch` does not surface). So the sentence names the
	 *  machine-side checks first and the permission as a POSSIBILITY after them,
	 *  never as the diagnosed cause — a denial that renders as a generic "couldn't
	 *  connect" is the defect this kind exists to prevent, and a confident
	 *  misdiagnosis would be the defect it must not introduce. Produced
	 *  only when the caller says the tested address is a private host (see
	 *  `classify`); the device procedure in ADR 0002 §7 S10 measures what a real
	 *  denial looks like, so a future revision can match a signature if one exists. */
	| { kind: "local-network" }
	/** Anything else, with the relay's own words when it gave them. */
	| { kind: "refused"; detail: string | null };

export interface TunnelTestResult {
	verdict: TunnelTestVerdict;
	/** The validated route, present whenever the address itself was usable — so a
	 *  caller can save exactly what it tested. Typed structurally rather than by
	 *  importing `@/connection`, which would drag `react-native` into this module's
	 *  import graph and out of the unit tests. */
	route: { mode: "custom"; baseUrl: string; allowInsecure: boolean } | null;
	/** The password that was tested, so a caller never re-reads it from state that
	 *  may have changed while the request was in flight. */
	password: string;
}

/**
 * The transport-level failures, as the platform spells them.
 *
 * This is message inspection because there is nothing else to inspect: a `fetch`
 * that never reaches the server rejects with a `TypeError` whose only detail is
 * the message, and the platform owns the wording. The list is deliberately SHORT —
 * a pattern that is wrong sends the reader to fix the wrong thing, so the default
 * is "we could not reach it" rather than a confident guess.
 */
const TLS_PATTERN = /certificate|ssl|tls|self.signed|unable to verify/i;
const DNS_PATTERN =
	/getaddrinfo|enotfound|nodename nor servname|name or service not known|hostname could not be found|no address associated/i;
const TIMEOUT_PATTERN = /timeout|timed out|aborted/i;

/** The kind of a thrown non-relay error, from its message alone. Ordered:
 *  certificate, then host name, then timeout, then the honest default. */
export function transportKind(
	error: unknown,
): "tls" | "host" | "unreachable" | "timeout" {
	const message =
		error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	if (TLS_PATTERN.test(message)) return "tls";
	if (DNS_PATTERN.test(message)) return "host";
	if (TIMEOUT_PATTERN.test(message)) return "timeout";
	return "unreachable";
}

/** The one-line sentence beside each verdict, in the app's voice: no status code,
 *  no apology, and a remedy where one exists. `platform` is required rather than
 *  defaulted: a wrong Settings path is worse than no Settings path, so every
 *  caller has to say which platform it is rendering for. */
export function verdictSentence(
	verdict: TunnelTestVerdict,
	platform: SentencePlatform,
): string {
	switch (verdict.kind) {
		case "ok":
			return verdict.sessions === 1
				? "Connected — you can see 1 session."
				: `Connected — you can see ${verdict.sessions} sessions.`;
		case "invalid":
			return verdict.reason;
		case "password":
			return "That password was not accepted. Check the relay password on the computer.";
		case "forbidden":
			return "That tunnel refused the app. If you put an access policy or a login page in front of it, allow the app through; the relay itself also refuses requests it did not come from, so make sure the tunnel forwards straight to 127.0.0.1:4098 rather than to a dashboard or another app.";
		case "offline":
			/* Two sentences, so two separators: the relay's own line ends without
			 *  punctuation and used to run straight into the remedy
			 *  ("Tunnel temporarily unavailable On that computer: lop mobile status"). */
			return verdict.detail
				? `${verdict.detail}. ${verdict.remedy}`
				: `The tunnel answered, but the relay behind it is not. ${verdict.remedy}`;
		case "tls":
			return "That tunnel's certificate was rejected. Use the https:// address the tunnel printed, choose a tunnel with a certificate a phone will trust, or replace a self-signed certificate on the one you run — the app will not skip the check.";
		case "host":
			return "That host name could not be found. Check the address for a typo, and that the tunnel still publishes that name.";
		case "unreachable":
			return "The address could not be reached. Check the URL is the public one your tunnel printed, and that the tunnel is still running.";
		case "timeout":
			return `That address did not answer within ${Math.round(TUNNEL_TEST_TIMEOUT_MS / 1000)} seconds. Check the tunnel is running and the computer is awake.`;
		case "local-network":
			/* The machine-side check leads; the OS gate follows as a possibility,
			 *  never as the diagnosed cause (see the kind's comment above). The retry is
			 *  load-bearing, not politeness: the first connect can be refused while
			 *  the iOS alert is still on screen (TN3179: the system "may deny the
			 *  operation immediately, before the user has responded to the alert"),
			 *  so granting changes nothing until the test runs again — and the sentence
			 *  names that control by its real label, "Test the connection", because
			 *  "test again" pointed at a button labelled otherwise. */
			if (platform === "ios") {
				/* Apple's own path, from TN3179 ("Settings > Privacy & Security >
				 *  Local Network"); the OS adds the app to that list after an
				 *  attempt. The permission stays a POSSIBILITY: whether a denial is
				 *  even distinguishable from an unreachable computer is what S10
				 *  measures, so the copy must not assert it (see the kind above). */
				return "Nothing answered at that address on this network. Check the computer is awake and running the relay. If both are true, it may be the local-network permission: allow Local Operator under Settings → Privacy & Security → Local Network, then tap Test the connection.";
			}
			if (platform === "android") {
				return "Nothing answered at that address on this network. Check the computer is awake and running the relay. If both are true, the local-network permission is the remaining gate: Android blocks an app from reaching devices on your network until it is allowed. Allow Local Operator under Settings → Apps → Local Operator → Permissions, then test again.";
			}
			/* Web keeps the machine-side sentence: a browser has no such permission to
			 *  grant. */
			return "Nothing answered at that address on this network. Check the computer is awake and running the relay, then tap Test the connection.";
		case "refused":
			return (
				verdict.detail ??
				"That address answered, but not in a way this app understands."
			);
	}
}

/** Maps a `RelayError` (or a transport failure) onto a verdict. Pure. */
export function classify(
	error: unknown,
	/** What the caller knows about the tested address: a private host changes what
	 *  a connect that never completed most likely MEANS, and the verdict says so
	 *  (`local-network`). Omitted, the classification is the failure's own. */
	options: { privateHost?: boolean } = {},
): TunnelTestVerdict {
	const verdict = verdictForError(error);
	/* `unreachable` and `timeout` only. A rejected certificate stays `tls` even on
	 *  a private host — retrying cannot fix it, and the local-network permission
	 *  cannot either, so folding it in would send the reader to the wrong fix. An
	 *  unresolvable NAME stays `host` for the same reason. */
	if (
		options.privateHost === true &&
		(verdict.kind === "unreachable" || verdict.kind === "timeout")
	) {
		return { kind: "local-network" };
	}
	return verdict;
}

/** The verdict a failure earns from itself alone; `classify` applies the route's
 *  context on top, so the route-dependent reading has exactly one home. */
function verdictForError(error: unknown): TunnelTestVerdict {
	if (error instanceof RelayError) {
		/* Every `detail` below is `displayableMessage`, never `summary`: the summary is
		 *  the ONE loggable line (`"<kind> <status> <reason>"`) and it is what two of
		 *  these verdicts RENDER — so a reader was shown "computer-offline 503 Tunnel
		 *  temporarily unavailable". The relay layer's own accessor is the copy a screen
		 *  may show, and the taxonomy already forbids a status code in reader copy. */
		const detail = error.displayableMessage;
		switch (error.kind) {
			case "certificate-rejected":
				return { kind: "tls", detail };
			case "host-unresolved":
				return { kind: "host", detail };
			case "relay-unauthorized":
			case "radiant-login-required":
				return { kind: "password" };
			case "origin-refused":
				return { kind: "forbidden", detail };
			case "computer-offline":
			case "gateway-refused":
			case "relay-down":
				return {
					kind: "offline",
					detail,
					remedy: "On that computer: lop mobile status",
				};
			case "unknown-tunnel":
				return { kind: "unreachable", detail };
			case "transport":
				/* A transport RelayError wraps a rejected fetch, and its `cause` is
				 *  where the platform's wording lives — the only thing separating a
				 *  rejected certificate from an unresolvable name from a socket that
				 *  never answered. */
				return fromTransport(error.cause ?? error, detail);
			default:
				return { kind: "refused", detail };
		}
	}
	return fromTransport(error, null);
}

/** One place turns a transport-level failure into a reader-visible outcome. */
function fromTransport(
	error: unknown,
	detail: string | null,
): TunnelTestVerdict {
	switch (transportKind(error)) {
		case "tls":
			return { kind: "tls", detail };
		case "host":
			return { kind: "host", detail };
		case "timeout":
			return { kind: "timeout" };
		default:
			return { kind: "unreachable", detail };
	}
}
