import { describe, expect, it } from "vitest";

import {
	type ConnectionViewInput,
	connectionView,
	KEEPALIVE_GRACE_S,
	reconnectDelay,
} from "@/features/session/connection-view";
import { RelayError } from "@/relay";
import type { ProjectionEntry } from "@/state";

/**
 * The C1–C7 table, as behaviour rather than as prose.
 *
 * The first case is the one that matters most and the one a still frame can never
 * prove: **C1 must be invisible.** The gateway ends every relayed stream at its
 * 60-second lease, so an orderly close arrives once a minute, forever — and a
 * reconnect line on that boundary is not a minor annoyance, it is how the reader
 * learns to ignore the indicator that matters. Flow 08 asserts the absence on a
 * device; this asserts the derivation that produces it.
 */

const ENTRY: ProjectionEntry = {
	projection: null,
	connected: true,
	awaitingSnapshot: false,
	version: 1,
	droppedFrames: 0,
};

describe("the reconnect backoff", () => {
	it("doubles from a second, and stops at the web client's ceiling", () => {
		// A hot retry against a relay that is down for hours is a radio and a battery
		// bill, and an unbounded one is a user staring at nothing. Both ends are the
		// rule, so both are pinned.
		expect(reconnectDelay(0, undefined)).toBe(1_000);
		expect(reconnectDelay(1, undefined)).toBe(2_000);
		expect(reconnectDelay(3, undefined)).toBe(8_000);
		expect(reconnectDelay(4, undefined)).toBe(15_000);
		expect(reconnectDelay(40, undefined)).toBe(15_000);
	});

	it("takes the gateway's own advice over the curve", () => {
		// `authorization_deferred` carries 120 s, `authorization_lease_pending` 5 s:
		// the server knows its own recovery time better than a doubling curve does.
		expect(reconnectDelay(0, 120_000)).toBe(120_000);
		expect(reconnectDelay(7, 5_000)).toBe(5_000);
	});

	it("never returns a delay a timer would ignore", () => {
		for (const attempts of [-1, 0, 1, 8, 1_000, Number.MAX_SAFE_INTEGER]) {
			const delay = reconnectDelay(attempts, undefined);
			expect(Number.isFinite(delay)).toBe(true);
			expect(delay).toBeGreaterThan(0);
		}
	});
});

const input = (
	overrides: Partial<ConnectionViewInput> = {},
): ConnectionViewInput => ({
	phase: "live",
	stream: "open",
	lastEnd: undefined,
	reconnectExpired: false,
	error: null,
	entry: ENTRY,
	stale: false,
	ageS: 0,
	online: true,
	computerLabel: "Studio desktop",
	computerLastSeenS: null,
	ended: false,
	...overrides,
});

/** A bare HTTP status in reader-facing copy. Hoisted: the lint wants regex
 *  literals compiled once. */
const BARE_STATUS = /\b(4\d\d|5\d\d)\b/;

describe("C1 — a rotation is invisible", () => {
	it("says nothing at all for a lease rotation", () => {
		expect(
			connectionView(input({ stream: "rotating", lastEnd: "eof" })).id,
		).toBeNull();
	});

	it("says nothing for the gateway's early clean stop either", () => {
		// An early EOF carries no information about WHY it ended, and treating it as a
		// fault is the bug the flows exist to catch (the fault is a clean end-of-body).
		expect(
			connectionView(input({ stream: "stalled", lastEnd: "eof" })).id,
		).toBeNull();
	});

	it("stays silent while the replacement stream is still opening", () => {
		expect(connectionView(input({ stream: "connecting" })).id).toBeNull();
	});

	it("says nothing even when the last frame is old, if the stream is rotating", () => {
		// Priority: a rotation outranks an age reading, so the minute boundary cannot
		// flicker a C3 on its way past.
		expect(
			connectionView(
				input({
					stream: "rotating",
					lastEnd: "eof",
					ageS: KEEPALIVE_GRACE_S + 30,
				}),
			).id,
		).toBeNull();
	});
});

describe("C2 — a genuine reconnect, and only then", () => {
	it("reports a transport failure", () => {
		const view = connectionView(
			input({ lastEnd: "error", stream: "connecting" }),
		);
		expect(view.id).toBe("C2");
		expect(view.text).toContain("Reconnecting");
	});

	it("reports a reconnect that produced no snapshot inside its deadline", () => {
		const view = connectionView(
			input({ stream: "connecting", reconnectExpired: true }),
		);
		expect(view.id).toBe("C2");
	});
});

describe("C3 — silence, with the last snapshot still readable", () => {
	it("speaks only past the derived grace window", () => {
		expect(
			connectionView(input({ ageS: KEEPALIVE_GRACE_S - 1 })).id,
		).toBeNull();
		const view = connectionView(input({ ageS: KEEPALIVE_GRACE_S + 5 }));
		expect(view.id).toBe("C3");
		// The sentence names how stale the reading is, because "not answering" without
		// an age is indistinguishable from a dead app.
		expect(view.text).toBe("Not answering — last update 1m ago.");
	});

	it("reports a snapshot the relay itself cannot vouch for", () => {
		expect(connectionView(input({ stale: true, ageS: 1 })).id).toBe("C3");
	});
});

describe("C4 — the phone has no route", () => {
	it("states the consequence rather than the cause", () => {
		const view = connectionView(input({ online: false }));
		expect(view.id).toBe("C4");
		expect(view.text).toBe("Offline. Messages will send when you’re back.");
	});

	it("does not paint an unknown connectivity state as offline", () => {
		// `null` is a real answer: native has no route signal installed, and claiming
		// offline on a failed request would be a claim this app cannot back up.
		expect(connectionView(input({ online: null })).id).toBeNull();
	});
});

describe("C5 — the Radient session expired", () => {
	it("names the computer and offers exactly one action", () => {
		const view = connectionView(
			input({
				error: new RelayError("radiant-login-required", "401", {
					status: 401,
					envelope: "clear-all",
				}),
			}),
		);
		expect(view.id).toBe("C5");
		expect(view.text).toBe(
			"Your Radient session expired. Sign in to reconnect to Studio desktop.",
		);
		expect(view.action?.kind).toBe("sign-in");
		expect(view.testIDs).toContain("connection-error-sign-in");
	});
});

describe("C6 — a typed refusal renders the gateway's own sentence", () => {
	it("shows the gateway's words verbatim, with the remedy for a self-clearing cause", () => {
		const view = connectionView(
			input({
				error: new RelayError("gateway-refused", "503", {
					status: 503,
					detail: "Waiting for the authorization lease to be granted.",
					reason: "authorization_lease_pending",
				}),
			}),
		);
		expect(view.id).toBe("C6");
		expect(view.text).toBe(
			"Waiting for the authorization lease to be granted.",
		);
		// `authorization_lease_pending` clears by itself within the deferral window, so
		// the surface says so rather than sending the reader away.
		expect(view.testIDs).toContain("connection-error-waiting");
		expect(view.testIDs).toContain("connection-error-clears-by-itself");
	});

	it("sends the reader to the console when the remedy lives there", () => {
		const view = connectionView(
			input({
				error: new RelayError("unknown-tunnel", "404", {
					status: 404,
					detail: "That tunnel no longer exists.",
					envelope: "clear",
				}),
			}),
		);
		expect(view.id).toBe("C6");
		expect(view.action?.kind).toBe("console");
		expect(view.testIDs).toContain("connection-error-console-link");
	});

	it("never shows a runtime's own prose, only the relay's sentence", () => {
		// A transport error's message is the fetch layer's words ("Load failed"), and
		// surfacing it was a shipped first impression of a failure (U3).
		const view = connectionView(
			input({ error: new RelayError("transport", "Load failed") }),
		);
		expect(view.text).not.toContain("Load failed");
	});

	it("never routes a typed refusal by its surface, which would move the fault", () => {
		// The gateway names this one `control_plane_unreachable`, and its own sentence
		// says the COMPUTER could not reach Radient. The surface for that reason is
		// `computer-offline`, whose copy is "‹computer› isn't answering" — a different
		// fault (the computer asleep) with a different fix. The sentence wins.
		const view = connectionView(
			input({
				error: new RelayError("gateway-refused", "503", {
					status: 503,
					detail:
						"This computer could not reach Radient to renew the relay authorization.",
					reason: "control_plane_unreachable",
				}),
				computerLastSeenS: 30,
			}),
		);
		expect(view.id).toBe("C6");
		expect(view.text).toContain("could not reach Radient");
		expect(view.text).not.toContain("isn’t answering");
		expect(view.action?.kind).toBe("retry");
	});

	it("renders a rejected certificate and an unresolved host distinctly, and offers no retry it cannot honour", () => {
		// `certificate-rejected` is `retry: "never"` — the same certificate presented
		// again gets the same answer, so a retry control here is a loop that looks
		// like progress. `host-unresolved` is `after-backoff`: a resolver timeout
		// clears by itself, so it keeps the retry. The two must not read as one
		// failure, because their remedies are different.
		const certificate = connectionView(
			input({
				error: new RelayError(
					"certificate-rejected",
					"the relay's certificate was rejected",
				),
			}),
		);
		expect(certificate.id).toBe("C6");
		expect(certificate.action?.kind).toBe("console");
		expect(certificate.testIDs).toContain(
			"connection-error-certificate-rejected",
		);
		expect(certificate.testIDs).not.toContain(
			"connection-error-retry-prominent",
		);

		const host = connectionView(
			input({
				error: new RelayError(
					"host-unresolved",
					"that address could not be found",
				),
			}),
		);
		expect(host.id).toBe("C6");
		expect(host.action?.kind).toBe("retry");
		expect(host.testIDs).toContain("connection-error-host-unresolved");
		expect(host.text).toContain("address");
	});

	it("says it is reconnecting when an OPEN stream has produced no frame at all", () => {
		// A socket that connected and says nothing is the flows table's second C2
		// trigger ("no frame after a rotation") with the socket still up. Without this
		// the reader gets an empty transcript and no state — which reads as loading
		// forever, however healthy the transport looks.
		const view = connectionView(
			input({ stream: "open", ageS: null, reconnectExpired: true }),
		);
		expect(view.id).toBe("C2");
		expect(view.text).toMatch(/reconnecting/i);
	});

	it("stays silent for an open stream inside the deadline", () => {
		// The other half of the rule: an open stream that has not yet produced a frame
		// is a normal first load, and a banner there would flash on every open.
		expect(
			connectionView(
				input({ stream: "open", ageS: null, reconnectExpired: false }),
			).id,
		).toBeNull();
	});

	it("never puts a bare status code on screen", () => {
		const view = connectionView(
			input({
				error: new RelayError("gateway-refused", "503", {
					status: 503,
					detail: "The connector is not authorized for this tunnel.",
					reason: "tunnel_not_authorized",
				}),
			}),
		);
		expect(view.text).not.toMatch(BARE_STATUS);
	});
});

describe("C7 — the computer is not answering", () => {
	it("says so with its last-seen age, and would not be fixed by signing in", () => {
		const view = connectionView(
			input({
				error: new RelayError("computer-offline", "503", {
					status: 503,
					serverError: "Tunnel temporarily unavailable",
				}),
				computerLastSeenS: 240,
			}),
		);
		expect(view.id).toBe("C7");
		expect(view.text).toBe(
			"Studio desktop isn’t answering — last seen 4m ago.",
		);
		expect(view.testIDs).toContain("connection-error-computer-offline");
		expect(view.testIDs).toContain("connection-error-machine-remedy");
		expect(view.action?.kind).toBe("retry");
	});
});

describe("an ended session is not a connection state", () => {
	it("leaves the connection surface to the resume affordance", () => {
		// `ended` is terminal and has its own affordance; painting it as "not
		// answering" would be a different lie.
		expect(connectionView(input({ ended: true, ageS: 400 })).id).toBeNull();
	});
});
