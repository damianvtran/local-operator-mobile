/**
 * The precedence ladder, as a table: every branch and every tie, in one place.
 * The web client's own table (`session-health.state.test.ts`, #3008) is the
 * same shape, so a disagreement between the two clients is a diff, not a hunt.
 */
import { describe, expect, it } from "vitest";

import {
	type HealthInput,
	healthDetailKey,
	healthIsEnded,
	healthLabel,
	sessionHealth,
} from "@/features/session/health";
import { HEALTH_COPY } from "@/features/session/health-copy";

type Row = {
	name: string;
	projection: HealthInput | null;
	connected: boolean;
	health: ReturnType<typeof sessionHealth>;
};

const ROWS: Row[] = [
	/* --- the five plain states --- */
	{
		name: "live: a running owner, fresh heartbeat, link up",
		projection: {
			ended: false,
			degraded: false,
			pid: 4242,
			heartbeat_stale: false,
		},
		connected: true,
		health: "live",
	},
	{
		name: "reconnecting: the phone's own link is down",
		projection: {
			ended: false,
			degraded: false,
			pid: 4242,
			heartbeat_stale: false,
		},
		connected: false,
		health: "reconnecting",
	},
	{
		name: "not answering: degraded (the relay cannot reach the owner)",
		projection: {
			ended: false,
			degraded: true,
			pid: 4242,
			heartbeat_stale: false,
		},
		connected: true,
		health: "not_answering",
	},
	{
		name: "not answering: heartbeat_stale (the owner has gone quiet)",
		projection: {
			ended: false,
			degraded: false,
			pid: 4242,
			heartbeat_stale: true,
		},
		connected: true,
		health: "not_answering",
	},
	{
		name: "ended: the relay watched the process die",
		projection: { ended: true, degraded: false, pid: 0, heartbeat_stale: null },
		connected: true,
		health: "ended",
	},
	{
		name: "ended: pid 0, a disk rebuild with no running owner",
		projection: {
			ended: false,
			degraded: false,
			pid: 0,
			heartbeat_stale: null,
		},
		connected: true,
		health: "ended",
	},

	/* --- the precedence ties, in ladder order --- */
	{
		name: "ended beats reconnecting: a receipt outranks a stale frame",
		projection: { ended: true, degraded: true, pid: 0, heartbeat_stale: true },
		connected: false,
		health: "ended",
	},
	{
		name: "reconnecting beats degraded: the last frame cannot be confirmed",
		projection: {
			ended: false,
			degraded: true,
			pid: 4242,
			heartbeat_stale: false,
		},
		connected: false,
		health: "reconnecting",
	},
	{
		name: "reconnecting beats heartbeat_stale",
		projection: {
			ended: false,
			degraded: false,
			pid: 4242,
			heartbeat_stale: true,
		},
		connected: false,
		health: "reconnecting",
	},
	{
		name: "reconnecting beats pid 0: a disk rebuild over a dropped link",
		projection: {
			ended: false,
			degraded: false,
			pid: 0,
			heartbeat_stale: null,
		},
		connected: false,
		health: "reconnecting",
	},
	{
		name: "degraded beats pid 0: a live entry served as a disk rebuild",
		projection: {
			ended: false,
			degraded: true,
			pid: 0,
			heartbeat_stale: false,
		},
		connected: true,
		health: "not_answering",
	},
	{
		name: "heartbeat_stale beats pid 0",
		projection: {
			ended: false,
			degraded: false,
			pid: 0,
			heartbeat_stale: true,
		},
		connected: true,
		health: "not_answering",
	},

	/* --- absence is not a signal --- */
	{
		name: "heartbeat_stale undefined (older daemon) is no yellow",
		projection: { ended: false, degraded: false, pid: 4242 },
		connected: true,
		health: "live",
	},
	{
		name: "heartbeat_stale null (not reported) is no yellow",
		projection: {
			ended: false,
			degraded: false,
			pid: 4242,
			heartbeat_stale: null,
		},
		connected: true,
		health: "live",
	},
	{
		name: "heartbeat_stale false is no yellow",
		projection: {
			ended: false,
			degraded: false,
			pid: 4242,
			heartbeat_stale: false,
		},
		connected: true,
		health: "live",
	},
	{
		name: "no projection at all is live, not ended: absence is not pid 0",
		projection: null,
		connected: true,
		health: "live",
	},
	{
		name: "no projection and no link is reconnecting",
		projection: null,
		connected: false,
		health: "reconnecting",
	},
	{
		name: "pid absent (not reported) is not pid 0",
		projection: { ended: false, degraded: false },
		connected: true,
		health: "live",
	},
	{
		name: "a streaming turn is not an input: busy is green",
		projection: {
			ended: false,
			degraded: false,
			pid: 4242,
			heartbeat_stale: false,
		},
		connected: true,
		health: "live",
	},
];

describe("sessionHealth", () => {
	it.each(ROWS)("$name", ({ projection, connected, health }) => {
		expect(sessionHealth(projection, connected)).toBe(health);
	});
});

describe("healthDetailKey", () => {
	it("says 'dropped' when degraded, even with a stale heartbeat too", () => {
		const projection = { degraded: true, heartbeat_stale: true, pid: 0 };
		expect(sessionHealth(projection, true)).toBe("not_answering");
		expect(healthDetailKey("not_answering", projection)).toBe(
			"relay.health.dropped_detail",
		);
	});

	it("says 'quiet' when only the heartbeat is stale", () => {
		const projection = { degraded: false, heartbeat_stale: true, pid: 4242 };
		expect(healthDetailKey("not_answering", projection)).toBe(
			"relay.health.quiet_detail",
		);
	});

	it("maps the other three states to their own sentence", () => {
		expect(healthDetailKey("live", null)).toBe("relay.health.live_detail");
		expect(healthDetailKey("reconnecting", null)).toBe(
			"relay.health.reconnecting_detail",
		);
		expect(healthDetailKey("ended", null)).toBe("relay.health.ended_detail");
	});
});

describe("the words", () => {
	it("every state has a label, so colour is never the only signal", () => {
		for (const health of [
			"live",
			"not_answering",
			"reconnecting",
			"ended",
		] as const) {
			expect(healthLabel(health).length).toBeGreaterThan(0);
		}
	});

	it("the labels and the composer's ended sentences are the web client's verbatim strings", () => {
		expect(healthLabel("live")).toBe("Live");
		expect(healthLabel("not_answering")).toBe("Not answering");
		expect(healthLabel("reconnecting")).toBe("Reconnecting");
		expect(healthLabel("ended")).toBe("Ended");
		expect(HEALTH_COPY["relay.health.ended_placeholder"].source).toBe(
			"Send to reopen in your home folder…",
		);
		expect(HEALTH_COPY["relay.health.ended_send_failed"].source).toContain(
			"couldn't be reopened",
		);
	});
});

describe("healthIsEnded", () => {
	it("is true only for the grey verdict, so the composer reads the dot not projection.ended", () => {
		expect(healthIsEnded("ended")).toBe(true);
		expect(healthIsEnded("live")).toBe(false);
		expect(healthIsEnded("not_answering")).toBe(false);
		expect(healthIsEnded("reconnecting")).toBe(false);
	});
});
