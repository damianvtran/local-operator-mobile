import { describe, expect, it } from "vitest";

import { backToParentLabel } from "@/features/session/back-label";
import { renderFor } from "@/i18n";

/**
 * M2 phase 1: literals that used to sit inside `?:`, `??` and function returns
 * were keyed WITHOUT changing a character of the English the user sees. Each
 * expectation below is the exact string the old inline expression produced, so
 * a catalogue edit that drifts from the shipped English fails here, and the
 * interpolations ({host}, {baseUrl}, a plural count) keep rendering identically.
 */
const en = (key: Parameters<typeof renderFor>[0], params = {}) =>
	renderFor(key, params, "en");

describe("keyed expression literals render the English they replaced", () => {
	it("Settings: account card, status words and diagnostics", () => {
		expect(en("mobile.settings.account.not_signed_in")).toBe(
			"Not signed in with Radient",
		);
		expect(en("mobile.settings.account.route_radient")).toBe(
			"Through your Radient tunnel",
		);
		expect(
			en("mobile.settings.account.route_direct", {
				baseUrl: "https://relay.example.test",
			}),
		).toBe("Connected directly to https://relay.example.test");
		expect(en("mobile.settings.status.no_connection")).toBe(
			"No connection yet",
		);
		expect(en("mobile.settings.status.not_connected")).toBe("Not connected");
		expect(en("mobile.settings.status.offline")).toBe("Offline");
		expect(en("mobile.settings.status.not_answering")).toBe("Not answering");
		expect(en("mobile.settings.status.connected")).toBe("Connected");
		expect(
			["idle", "connecting", "live", "degraded", "offline"].map((word) =>
				en(`mobile.settings.diagnostics.stream_${word}` as never),
			),
		).toEqual(["idle", "connecting", "live", "degraded", "offline"]);
		expect(en("mobile.settings.text_size.following", { percent: 100 })).toBe(
			"This phone's own text size is 100%. Following it.",
		);
		expect(en("mobile.settings.text_size.overridden", { percent: 150 })).toBe(
			"This phone's own text size is 150%. Overridden above.",
		);
	});

	it("wait panel: host line, relay report with plural", () => {
		expect(
			en("mobile.computers.wait.host_answering", { host: "mac.local" }),
		).toBe(
			"Waiting for your computer at mac.local to answer. A provisioned route is not the same as a machine that is up.",
		);
		expect(en("mobile.computers.wait.answering")).toBe(
			"Waiting for your computer to answer.",
		);
		expect(en("mobile.computers.wait.relay_version", { version: 3 })).toBe(
			"Its relay reports protocol version 3.",
		);
		expect(en("mobile.computers.wait.relay_sessions", { sessions: 1 })).toBe(
			"Its relay reports 1 running session.",
		);
		expect(en("mobile.computers.wait.relay_sessions", { sessions: 2 })).toBe(
			"Its relay reports 2 running sessions.",
		);
		expect(
			en("mobile.computers.wait.relay_version_sessions", {
				version: 3,
				sessions: 2,
			}),
		).toBe("Its relay reports protocol version 3 and 2 running sessions.");
		expect(en("mobile.computers.added.fallback_name")).toBe("your computer");
		expect(
			en("mobile.computers.added.connected_to", { name: "New Mini" }),
		).toBe("Connected to New Mini.");
		expect(
			en("mobile.computers.added.connected_to", {
				name: en("mobile.computers.added.fallback_name"),
			}),
		).toBe("Connected to your computer.");
	});

	it("session screens: context fact, scroll cues, fallbacks", () => {
		expect(en("mobile.session.tray.context", { percent: 21 })).toBe(
			"21% context",
		);
		expect(en("mobile.session.tray.context_short", { percent: 21 })).toBe(
			"21% ctx",
		);
		expect(en("mobile.session.tray.context_estimate", { percent: 21 })).toBe(
			"21% context (est.)",
		);
		expect(
			en("mobile.session.tray.context_short_estimate", { percent: 21 }),
		).toBe("21% ctx (est.)");
		expect(en("mobile.session.region.end")).toBe("end · scroll ↑");
		expect(en("mobile.session.region.below_labels", { labels: "a · b" })).toBe(
			"a · b below · scroll ↓",
		);
		expect(en("mobile.session.region.more_below")).toBe(
			"more below · scroll ↓",
		);
		expect(en("mobile.session.video.title_fallback")).toBe("Video");
		expect(en("mobile.session.fallback_name")).toBe("session");
		/* The region cue joins the keyed labels with the same ' · ' the inline
		 * Record produced: "activity below", "activity · agents below". */
		const label = (k: "working" | "subagents" | "todos" | "strip") =>
			en(`mobile.session.region.label_${k}` as never);
		expect([
			label("working"),
			label("subagents"),
			label("todos"),
			label("strip"),
		]).toEqual(["activity", "agents", "tasks", "status"]);
		expect(
			en("mobile.session.region.below_labels", { labels: label("working") }),
		).toBe("activity below · scroll ↓");
		expect(
			en("mobile.session.region.below_labels", {
				labels: [label("working"), label("subagents")].join(" · "),
			}),
		).toBe("activity · agents below · scroll ↓");
		/* Back-to label (video + agent routes): a named parent and the fallback noun. */
		expect(en("mobile.session.back_to", { name: "Deploy fix" })).toBe(
			"Back to Deploy fix",
		);
		expect(
			en("mobile.session.back_to", {
				name: en("mobile.session.fallback_name"),
			}),
		).toBe("Back to session");
		/* The route label: a named parent keeps "Back to <name>"; unnamed (absent,
		 * null or empty) takes the whole-phrase key, still "Back to session". */
		const render = ((k: never, p?: never) =>
			renderFor(k, p ?? {}, "en")) as never;
		expect(backToParentLabel("Deploy fix", render)).toBe("Back to Deploy fix");
		expect(en("mobile.session.back_to_session")).toBe("Back to session");
		for (const unnamed of [undefined, null, ""]) {
			expect(backToParentLabel(unnamed, render)).toBe("Back to session");
		}
	});
});
