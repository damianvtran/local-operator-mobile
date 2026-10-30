import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	bridgeBody,
	bridgeConversationLabel,
	bridgeHeadline,
	bridgeOutcomeView,
	bridgeRowOf,
	isBridgeRow,
	scrubOpaqueIds,
} from "@/features/session/bridge-row";

/** One bridge tool row; `details` is typed loosely because `bridge_row` is
 *  newer than the hand-authored wire mirror (that is the case under test). */
const row = (
	details: Record<string, unknown>,
	over: Partial<TranscriptEntry> = {},
): TranscriptEntry => ({
	id: "tc-1",
	kind: "tool",
	text: "",
	tool_call_id: "1",
	tool_name: "bridge",
	tool_state: "done",
	summary: "Posted to #release",
	intent: "",
	diff_added: 0,
	diff_removed: 0,
	elapsed_s: 1,
	error: "",
	details: details as TranscriptEntry["details"],
	images: [],
	final: true,
	text_complete: true,
	...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
	bridge_row: {
		op: "post",
		action: "post",
		target: { kind: "channel", label: "#release" },
		preview: "nightly is green",
		count: null,
		emoji: null,
		outcome: null,
		code: null,
		...over,
	},
});

const ID = /\b(?:bcv|bcmsg|acc|ep)_/;

describe("bridge row: the gate", () => {
	it("is the bridge tool only — a lookalike payload on another tool is ignored", () => {
		expect(isBridgeRow(row({}))).toBe(true);
		expect(isBridgeRow(row({}, { tool_name: "Bridge" }))).toBe(true);
		const send = row(payload({ outcome: "inbox_only" }), { tool_name: "send" });
		expect(bridgeRowOf(send)).toBeNull();
		expect(
			bridgeBody({ ...send, details: { args: { body: "x" } } }),
		).toBeNull();
	});
});

describe("bridge row: parse", () => {
	it("narrows a full payload", () => {
		expect(bridgeRowOf(row(payload({ count: 3, emoji: "👍" })))).toEqual({
			op: "post",
			action: "post",
			targetKind: "channel",
			targetLabel: "#release",
			preview: "nightly is green",
			count: 3,
			emoji: "👍",
			outcome: null,
			code: null,
		});
	});

	it("reads a missing, null, array or scalar bridge_row as absent (generic row)", () => {
		expect(bridgeRowOf(row({}))).toBeNull();
		expect(bridgeRowOf(row({ bridge_row: null }))).toBeNull();
		expect(bridgeRowOf(row({ bridge_row: [] }))).toBeNull();
		expect(bridgeRowOf(row({ bridge_row: "inbox_only" }))).toBeNull();
		// and the generic row says nothing it cannot vouch for
		expect(bridgeOutcomeView(bridgeRowOf(row({})))).toBeNull();
		expect(bridgeConversationLabel(bridgeRowOf(row({})))).toBeNull();
	});

	it("reads an unknown outcome or target kind as absent, never as a verdict", () => {
		const parsed = bridgeRowOf(
			row(payload({ outcome: "teleported", target: { kind: "galaxy" } })),
		);
		expect(parsed?.outcome).toBeNull();
		expect(parsed?.targetKind).toBe("none");
		expect(bridgeOutcomeView(parsed)).toBeNull();
	});

	it("tolerates wrongly typed fields field by field", () => {
		const parsed = bridgeRowOf(
			row(payload({ target: "x", count: "3", code: 7, preview: "   " })),
		);
		expect(parsed).toMatchObject({
			targetKind: "none",
			targetLabel: null,
			count: null,
			code: null,
			preview: null,
		});
	});
});

describe("bridge row: outcomes", () => {
	it("peer inbox is an amber warning, never success", () => {
		const view = bridgeOutcomeView(
			bridgeRowOf(row(payload({ outcome: "inbox_only" }))),
		);
		expect(view).toEqual({
			text: "not posted to a conversation",
			tone: "warning",
		});
	});

	it("a refusal carries its machine code verbatim, in danger ink", () => {
		expect(
			bridgeOutcomeView(
				bridgeRowOf(row(payload({ outcome: "refused", code: "not_a_member" }))),
			),
		).toEqual({ text: "refused · not_a_member", tone: "danger" });
		expect(
			bridgeOutcomeView(
				bridgeRowOf(row(payload({ outcome: "failed", code: "timeout" }))),
			),
		).toEqual({ text: "failed · timeout", tone: "danger" });
	});

	it("a refusal with no code keeps its placeholder slot filled", () => {
		expect(
			bridgeOutcomeView(bridgeRowOf(row(payload({ outcome: "refused" }))))
				?.text,
		).toBe("refused · —");
	});

	it("the pending pair is muted words", () => {
		expect(
			bridgeOutcomeView(bridgeRowOf(row(payload({ outcome: "unconfirmed" })))),
		).toEqual({ text: "post unconfirmed", tone: "muted" });
		expect(
			bridgeOutcomeView(
				bridgeRowOf(row(payload({ outcome: "awaiting_acceptance" }))),
			),
		).toEqual({ text: "awaiting acceptance", tone: "muted" });
	});
});

describe("bridge row: labels", () => {
	it("names the conversation by its label, else by its kind's word", () => {
		const of = (target: Record<string, unknown>) =>
			bridgeConversationLabel(bridgeRowOf(row(payload({ target }))));
		expect(of({ kind: "channel", label: "#release" })).toBe("#release");
		expect(of({ kind: "channel" })).toBe("a conversation");
		expect(of({ kind: "message" })).toBe("a conversation");
		expect(of({ kind: "dm" })).toBe("a DM");
		expect(of({ kind: "person" })).toBe("a teammate");
		expect(of({ kind: "directory" })).toBeNull();
		expect(of({ kind: "none" })).toBeNull();
	});

	it("never shows an opaque id as the conversation label", () => {
		expect(
			bridgeConversationLabel(
				bridgeRowOf(
					row(payload({ target: { kind: "dm", label: "bcv_01HXYZabc" } })),
				),
			),
		).toBe("a DM");
	});

	it("reads the body from args.body, then args.text, else nothing", () => {
		expect(bridgeBody(row({ args: { body: "**hi**", to: "x" } }))).toBe(
			"**hi**",
		);
		expect(bridgeBody(row({ args: { text: "hello" } }))).toBe("hello");
		expect(bridgeBody(row({ args: "body: hi" }))).toBeNull();
		expect(bridgeBody(row({}))).toBeNull();
	});
});

describe("bridge row: headline", () => {
	it("keeps a clean localized summary as-is", () => {
		expect(bridgeHeadline(row({}))).toBe("Posted to #release");
	});

	it("strips every opaque id class a mixed-build frame may still carry", () => {
		const dirty = [
			"Posted to bcv_01HXYZ9 · nightly is green",
			"Reacted 👍 to bcmsg_77aa-bb",
			"→ acc_42 · hello",
			"Read ep_abc_def directory",
		];
		for (const summary of dirty) {
			const out = bridgeHeadline(row({}, { summary }));
			expect(out).not.toMatch(ID);
			expect(out.length).toBeGreaterThan(0);
		}
		expect(
			bridgeHeadline(
				row({}, { summary: "Posted to bcv_01HXYZ9 · nightly is green" }),
			),
		).toBe("Posted to · nightly is green");
		expect(scrubOpaqueIds("→ acc_42 · hello")).toBe("hello");
	});

	it("leaves words that merely contain an id prefix alone", () => {
		expect(scrubOpaqueIds("keep_going step_ep_x")).toBe("keep_going step_ep_x");
	});

	it("falls back to the tool name rather than a blank line", () => {
		expect(bridgeHeadline(row({}, { summary: "" }))).toBe("bridge");
		expect(bridgeHeadline(row({}, { summary: "bcv_only" }))).toBe("bridge");
	});
});
