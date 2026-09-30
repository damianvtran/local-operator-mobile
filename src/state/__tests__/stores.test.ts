// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The three stores, as state machines.
 *
 * These tests are about the RULES, not the plumbing: that only `startRoute` may
 * create a route, that a repaint arrives and leaves no stale row behind, that the
 * first frame of a new connection wins even when its version looks older, that a
 * dropped stream keeps its data, and that an ended or degraded session is readable
 * from the receipts local-operator PR #1784 added.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { SessionProjection, SessionSummary } from "../../contracts";
import { parsePayload } from "../../contracts";
import type { ErrorSurface } from "../../relay";
import {
	createConnectionStore,
	createListStore,
	createProjectionStore,
	hasDegradedListing,
	isSessionEnded,
	isSessionViewStale,
	isUsable,
	readEntry,
	searchLoadedSessions,
	sessionTitle,
} from "../index";

const FIXTURE_ROOT = fileURLToPath(
	new URL("../../../fixtures/relay", import.meta.url),
);

function listFrame(): {
	sessions: SessionSummary[];
	degraded: string[];
	capabilities: Record<string, unknown>;
} {
	const fixture = JSON.parse(
		readFileSync(join(FIXTURE_ROOT, "sse/sse-list-frame.json"), "utf8"),
	) as { data: unknown };
	return parsePayload("sessionListFrame", fixture.data);
}

function projection(): SessionProjection {
	const fixture = JSON.parse(
		readFileSync(
			join(FIXTURE_ROOT, "sse/sse-projection-live-idle.json"),
			"utf8",
		),
	) as { data: unknown };
	return parsePayload("sessionProjection", fixture.data);
}

function failure(overrides: {
	surface?: ErrorSurface | null;
	detail?: string | null;
	retryAfterMs?: number | null;
}) {
	return {
		surface: "computer-offline" as const,
		detail: "Tunnel temporarily unavailable",
		...overrides,
	};
}

describe("the connection store is the only place a route starts or ends", () => {
	it("starts a Radient route in discovery and a custom route in minting", () => {
		const store = createConnectionStore();
		store.getState().startRoute({
			mode: "radient",
			hostname: `${"a".repeat(32)}-lop.radienthq.com`,
			tunnelId: "t1",
		});
		expect(store.getState().phase).toBe("discovering");

		store.getState().endRoute();
		store.getState().startRoute({
			mode: "custom",
			baseUrl: "https://relay.example",
			allowInsecure: false,
		});
		expect(store.getState().phase).toBe("minting");
	});

	it("exposes no action other than start/end that changes the route", () => {
		const store = createConnectionStore();
		const route = {
			mode: "custom",
			baseUrl: "https://relay.example",
			allowInsecure: false,
		} as const;
		store.getState().startRoute(route);
		const revision = store.getState().revision;

		/* Every other action, in turn: none of them may touch the route. */
		store.getState().setComputers([]);
		store.getState().selectComputer({
			tunnelId: "t1",
			name: "laptop",
			deviceId: "d1",
			hostname: "h",
			status: "ready",
			rawStatus: "active",
			supportsLocalOperator: true,
			billing: { eligible: null, message: null },
			updatedAt: 0,
		});
		store.getState().markLive({ accountLabel: "damian" });
		store.getState().markReminting();
		store.getState().markDegraded({ detail: "quiet" });
		store.getState().noteFailure(failure({ surface: "retry" }));

		expect(store.getState().route).toEqual(route);
		expect(store.getState().revision).toBe(revision);
	});

	it("ignores a computer pick with no route, so a stale picker cannot mint", () => {
		const store = createConnectionStore();
		store.getState().selectComputer({
			tunnelId: "t1",
			name: "laptop",
			deviceId: "d1",
			hostname: "h",
			status: "ready",
			rawStatus: "active",
			supportsLocalOperator: true,
			billing: { eligible: null, message: null },
			updatedAt: 0,
		});
		expect(store.getState().phase).toBe("signed-out");
		expect(store.getState().tunnelId).toBeNull();
	});

	it("sends a sign-in failure back to signed-out and keeps the route", () => {
		const store = createConnectionStore();
		store.getState().startRoute({
			mode: "radient",
			hostname: `${"b".repeat(32)}-lop.radienthq.com`,
			tunnelId: "t1",
		});
		store.getState().markLive({ accountLabel: "damian" });
		store
			.getState()
			.noteFailure(
				failure({ surface: "sign-in", detail: "tunnel session expired" }),
			);
		/* The user is re-authenticating the SAME computer, not choosing a new one. */
		expect(store.getState().phase).toBe("signed-out");
		expect(store.getState().route).not.toBeNull();
		expect(store.getState().accountLabel).toBeNull();
	});

	it("keeps the failed state's own sentence and backoff for the screen to show", () => {
		const store = createConnectionStore();
		store.getState().startRoute({
			mode: "custom",
			baseUrl: "https://relay.example",
			allowInsecure: false,
		});
		store.getState().noteFailure(
			failure({
				surface: "console",
				detail: "This tunnel was revoked.",
				retryAfterMs: 120_000,
			}),
		);
		expect(store.getState().phase).toBe("refused");
		expect(store.getState().detail).toBe("This tunnel was revoked.");
		expect(store.getState().retryAfterMs).toBe(120_000);
	});

	it("never blanks the route on a degraded read", () => {
		const store = createConnectionStore();
		store.getState().startRoute({
			mode: "custom",
			baseUrl: "https://relay.example",
			allowInsecure: false,
		});
		store.getState().markLive();
		store
			.getState()
			.markDegraded({ detail: "the relay has stopped answering" });
		expect(store.getState().phase).toBe("degraded");
		expect(isUsable(store.getState())).toBe(true);
	});

	it("clears everything on endRoute but keeps counting revisions", () => {
		const store = createConnectionStore();
		store.getState().startRoute({
			mode: "custom",
			baseUrl: "https://relay.example",
			allowInsecure: false,
		});
		store.getState().markLive({ accountLabel: "damian" });
		const revision = store.getState().revision;
		store.getState().endRoute();
		const state = store.getState();
		expect(state.route).toBeNull();
		expect(state.phase).toBe("signed-out");
		expect(state.accountLabel).toBeNull();
		expect(state.computers).toEqual([]);
		expect(state.revision).toBe(revision + 1);
		expect(isUsable(state)).toBe(false);
	});
});

describe("the list store replaces wholesale and keeps stale-but-labelled", () => {
	it("replaces the list rather than merging it", () => {
		const store = createListStore();
		const frame = listFrame();
		store.getState().applyFrame(frame);
		const firstCount = store.getState().sessions.length;

		store.getState().applyFrame({ ...frame, sessions: [] });
		expect(store.getState().sessions).toEqual([]);
		expect(firstCount).toBeGreaterThan(0);
		expect(store.getState().frameCount).toBe(2);
	});

	it("keeps the capabilities a later frame did not carry", () => {
		const store = createListStore();
		const frame = listFrame();
		store
			.getState()
			.applyFrame({ ...frame, capabilities: { features: { auth: 1 } } });
		/* A frame without capabilities must not blink the mic capability off. */
		store.getState().applyFrame({ ...frame, capabilities: undefined });
		expect(store.getState().capabilities.features).toEqual({ auth: 1 });
	});

	it("labels rather than clears when the stream drops", () => {
		const store = createListStore();
		store.getState().applyFrame(listFrame());
		store.getState().markStale();
		expect(store.getState().stale).toBe(true);
		expect(store.getState().sessions.length).toBeGreaterThan(0);
	});

	it("does not claim staleness for a list that has never been painted", () => {
		const store = createListStore();
		store.getState().markStale();
		expect(store.getState().stale).toBe(true);
		store.getState().applyFrame(listFrame());
		store.getState().markStale();
		expect(store.getState().stale).toBe(true);
		expect(hasDegradedListing(store.getState())).toBe(false);
	});

	it("reports a degraded listing instead of an empty one", () => {
		const store = createListStore();
		store
			.getState()
			.applyFrame({ sessions: [], degraded: ["sessions"], capabilities: {} });
		expect(hasDegradedListing(store.getState())).toBe(true);
		expect(store.getState().sessions).toEqual([]);
	});

	it("searches only what is loaded, without re-sorting", () => {
		const sessions = listFrame().sessions;
		const found = searchLoadedSessions(sessions, "MOCK");
		expect(found.length).toBe(sessions.length);
		expect(searchLoadedSessions(sessions, "no-such-row")).toEqual([]);
		expect(sessionTitle({ conversation_name: "   " })).toBe("untitled");
	});
});

describe("the projection store fences per connection and keeps the last snapshot", () => {
	it("accepts the first frame of a connection however its version compares", () => {
		const store = createProjectionStore();
		const first = projection();
		store.getState().applyFrame("s1", { ...first, version: 40 });
		store.getState().beginStream("s1");
		/* A reconnection: the daemon's epoch may restart, so the seed frame wins. */
		const decision = store
			.getState()
			.applyFrame("s1", { ...first, version: 3 });
		expect(decision).toBe("accepted-snapshot");
		expect(readEntry(store.getState(), "s1").version).toBe(3);
		expect(readEntry(store.getState(), "s1").awaitingSnapshot).toBe(false);
	});

	it("drops an older frame inside one connection and counts it", () => {
		const store = createProjectionStore();
		const frame = projection();
		store.getState().beginStream("s1");
		store.getState().applyFrame("s1", { ...frame, version: 10 });
		expect(store.getState().applyFrame("s1", { ...frame, version: 9 })).toBe(
			"dropped-older",
		);
		const entry = readEntry(store.getState(), "s1");
		expect(entry.projection?.version).toBe(10);
		expect(entry.droppedFrames).toBe(1);
	});

	it("keeps the transcript when the stream ends", () => {
		const store = createProjectionStore();
		store.getState().beginStream("s1");
		store.getState().applyFrame("s1", projection());
		store.getState().endStream("s1");
		const entry = readEntry(store.getState(), "s1");
		expect(entry.connected).toBe(false);
		expect(entry.projection).not.toBeNull();
		expect(isSessionViewStale({ entry })).toBe(true);
	});

	it("forgets one session without touching another", () => {
		const store = createProjectionStore();
		store.getState().beginStream("s1");
		store.getState().applyFrame("s1", projection());
		store.getState().beginStream("s2");
		store.getState().applyFrame("s2", projection());
		store.getState().drop("s1");
		expect(store.getState().entries.s1).toBeUndefined();
		expect(store.getState().entries.s2).toBeDefined();
	});

	it("clears the fences on reset, so a route switch cannot inherit a version", () => {
		const store = createProjectionStore();
		store.getState().beginStream("s1");
		store.getState().applyFrame("s1", { ...projection(), version: 99 });
		store.getState().reset();
		store.getState().beginStream("s1");
		/* A fresh route: the first frame is authoritative again, even a low one. */
		expect(
			store.getState().applyFrame("s1", { ...projection(), version: 1 }),
		).toBe("accepted-snapshot");
	});

	it("reads the receipts: degraded is stale, ended is terminal", () => {
		const store = createProjectionStore();
		store.getState().beginStream("s1");
		store.getState().applyFrame("s1", { ...projection(), degraded: true });
		const entry = readEntry(store.getState(), "s1");
		expect(entry.connected).toBe(true);
		expect(isSessionViewStale({ entry })).toBe(true);
		/* An ended session is not "reconnecting": it has its own affordance. */
		expect(isSessionEnded({ entry })).toBe(false);

		store.getState().applyFrame("s1", {
			...projection(),
			degraded: false,
			ended: true,
			version: 99_999,
		});
		const endedEntry = readEntry(store.getState(), "s1");
		expect(isSessionEnded({ entry: endedEntry })).toBe(true);
		/* Ended is terminal, not a reconnect: it must not also read as stale. */
		expect(isSessionViewStale({ entry: endedEntry })).toBe(false);

		/* The listing row's receipt is the other half of the same fact. */
		expect(isSessionEnded({ entry, listingRow: { ended: true } })).toBe(true);
	});

	it("treats a durable-only row (no receipt) as a live session, never as ended", () => {
		const entry = readEntry({ entries: {} }, "never-seen");
		expect(isSessionEnded({ entry, listingRow: {} })).toBe(false);
		expect(
			isSessionViewStale({
				entry,
				listingRow: { subagents_running: null, leaving: "", updating: "" },
			}),
		).toBe(true);
	});
});
