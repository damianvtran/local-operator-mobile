import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capabilitiesSchema } from "@/contracts";
import type { ComposerChip } from "@/features/session/chip-labels";
import {
	headerSubtitle,
	remoteHealthDetail,
} from "@/features/session/health-copy";
import type { PendingView } from "@/features/session/pending";
import {
	remoteChip,
	remotePendingView,
	sessionControlPolicy,
} from "@/features/session/remote-controls";
import { remoteConversationOf } from "@/features/sessions/session-navigation";

/**
 * PR #271 review round 1: R1-1 / U2 (remote rows offered controls the v1
 * relay does not forward) and U1 / D1 (the header never named the owner and the
 * status sheet said "your computer"). The pure rules are asserted directly; the
 * screen's wiring is asserted over its SOURCE, the convention of
 * `tags-wiring.test.ts`, because the route reaches `uniwind` through `@/ui`,
 * which the Node test environment cannot import.
 */
const V1 = capabilitiesSchema.parse({
	remote_sessions: {
		available: true,
		version: 1,
		supported_command_ops: ["prompt", "steer"],
	},
});
const OWNER = "Studio computer";
/* An endpoint call carrying the owner label would make display text authority. */
const OWNER_TO_TRANSPORT = /endpoints\.[a-z_]+\([^)]*ownerLabel/i;

describe("sessionControlPolicy", () => {
	it("withholds every op the v1 relay does not forward for a remote conversation", () => {
		const policy = sessionControlPolicy(V1, true);
		expect(policy.allows("prompt")).toBe(true);
		expect(policy.allows("steer")).toBe(true);
		for (const op of [
			"abort",
			"approval_answer",
			"ask_answer",
			"ask_respond",
			"slash",
			"set_model",
			"set_effort",
			"resume",
		] as const)
			expect(policy.allows(op), op).toBe(false);
	});

	it("is driven by the capability: a relay advertising abort lights Stop back up", () => {
		const later = capabilitiesSchema.parse({
			remote_sessions: { supported_command_ops: ["prompt", "steer", "abort"] },
		});
		expect(sessionControlPolicy(later, true).allows("abort")).toBe(true);
		expect(sessionControlPolicy(later, true).allows("slash")).toBe(false);
	});

	it("never restricts a local conversation, whatever the relay advertises", () => {
		const policy = sessionControlPolicy(V1, false);
		expect(policy.allows("abort")).toBe(true);
		expect(policy.allows("slash")).toBe(true);
		expect(policy.allows("resume")).toBe(true);
	});
});

const pendingFixture = (kind: "approval" | "ask"): PendingView =>
	({
		kind,
		requestId: "synthetic-request",
		terminalOnly: false,
		boundarySentence: null,
	}) as unknown as PendingView;

describe("remotePendingView", () => {
	it("keeps a remote approval/ask visible but drops its controls and names the owner", () => {
		const policy = sessionControlPolicy(V1, true);
		for (const kind of ["approval", "ask"] as const) {
			const view = remotePendingView(pendingFixture(kind), policy, OWNER);
			expect(view.terminalOnly).toBe(true);
			expect(view.boundarySentence).toContain(OWNER);
		}
	});

	it("leaves a local pending card exactly as it was", () => {
		const local = pendingFixture("approval");
		expect(
			remotePendingView(local, sessionControlPolicy(V1, false), OWNER),
		).toBe(local);
	});
});

describe("remoteChip", () => {
	const value: ComposerChip = {
		kind: "value",
		text: "Sonnet",
		accessibilityLabel: "Model, Sonnet",
	};
	it("keeps the value visible but disabled, with the owner-only reason", () => {
		const chip = remoteChip(value, false, OWNER);
		expect(chip.kind).toBe("unavailable");
		expect(chip.kind === "unavailable" && chip.text).toBe("Sonnet");
		expect(chip.kind === "unavailable" && chip.accessibilityHint).toContain(
			OWNER,
		);
	});
	it("is untouched when the op is allowed", () => {
		expect(remoteChip(value, true, OWNER)).toBe(value);
	});
});

describe("owner-aware header and status sheet (U1 / D1)", () => {
	it("names the owner beside the state for a remote conversation only", () => {
		const remote = headerSubtitle({
			health: "live",
			working: false,
			waiting: false,
			owner: OWNER,
		});
		expect(remote).toContain("Idle");
		expect(remote).toContain(OWNER);
		expect(
			headerSubtitle({ health: "live", working: false, waiting: false }),
		).toBe("Idle");
	});

	it("never says 'your computer' or offers a home-folder Resume for a remote conversation", () => {
		for (const key of [
			"relay.health.live_detail",
			"relay.health.dropped_detail",
			"relay.health.quiet_detail",
			"relay.health.reconnecting_detail",
			"relay.health.ended_detail",
		] as const) {
			const sentence = remoteHealthDetail(key, OWNER);
			expect(sentence, key).toContain(OWNER);
			expect(sentence.toLowerCase(), key).not.toContain("your computer");
			expect(sentence, key).not.toContain("Resume");
		}
	});
});

describe("remoteConversationOf (R1-6)", () => {
	it("lets the live row win over the route's remote=1", () => {
		const local = { session_id: "s" } as never;
		expect(remoteConversationOf(local, "1")).toBe(false);
		expect(remoteConversationOf(undefined, "1")).toBe(true);
		expect(remoteConversationOf(undefined, undefined)).toBe(false);
	});
});

const SESSION = readFileSync(
	fileURLToPath(
		new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
	),
	"utf8",
);

describe("the session screen reads the one control policy", () => {
	it("gates every Stop on abort", () => {
		expect(SESSION).toContain(
			'const stopAllowed = controlPolicy.allows("abort");',
		);
		expect(SESSION).toContain("controls={composerControls}");
		expect(SESSION).not.toContain("controls={composer.controls}");
		expect(SESSION).toContain(
			"onStop={stopAllowed ? composer.stop : undefined}",
		);
		expect(SESSION).toContain(
			"composerControls.stopVisible ? composer.stop : undefined",
		);
	});

	it("gates the slash palette, typed slash, asks, chips, pending answers and Resume", () => {
		expect(SESSION).toContain('const slash = controlPolicy.allows("slash")');
		expect(SESSION).toContain("slashRefusal:");
		expect(SESSION).toContain(
			"asks={asksAnswerable ? projection?.asks : undefined}",
		);
		expect(SESSION).toContain(
			"const asksOpen = asksSheet.visible && asksAnswerable;",
		);
		expect(SESSION).toContain('controlPolicy.allows("set_model")');
		expect(SESSION).toContain('controlPolicy.allows("set_effort")');
		expect(SESSION).toContain(
			"remotePendingView(view, controlPolicy, ownerLabel)",
		);
		expect(SESSION).toContain(
			'const resumeOffered = ended && controlPolicy.allows("resume");',
		);
		expect(SESSION).toContain("{resumeOffered ? <ResumeBlock");
		expect(SESSION).toContain("ended={resumeOffered}");
	});

	it("passes the owner to the header subtitle and the status sheet as display text only", () => {
		expect(SESSION).toContain("owner: ownerLabel,");
		expect(SESSION).toContain("remoteHealthDetail(");
		/* The owner never reaches a transport: no endpoint call takes it. */
		expect(SESSION).not.toMatch(OWNER_TO_TRANSPORT);
	});
});
