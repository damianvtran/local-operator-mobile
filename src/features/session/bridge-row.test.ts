import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	bridgeBody,
	bridgeCopyOf,
	bridgeHeadline,
	bridgeMark,
	bridgeOutcomeView,
	bridgeRowOf,
	bridgeTargetLabel,
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
		expect(bridgeOutcomeView(bridgeRowOf(row({})), null)).toBeNull();
		expect(bridgeTargetLabel(bridgeRowOf(row({})))).toBeNull();
	});

	it("reads an unknown outcome or target kind as absent, never as a verdict", () => {
		const parsed = bridgeRowOf(
			row(payload({ outcome: "teleported", target: { kind: "galaxy" } })),
		);
		expect(parsed?.outcome).toBeNull();
		expect(parsed?.targetKind).toBe("none");
		expect(bridgeOutcomeView(parsed, null)).toBeNull();
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

describe("bridge row: marks", () => {
	/* The two states the desktop row paints with an icon of its own
	 *  (local-operator-ui #1529): the two clients must not draw one bridge
	 *  result two ways. */
	it("paints MessageSquareOff for a peer inbox and Hourglass for acceptance", () => {
		expect(
			bridgeMark(bridgeRowOf(row(payload({ outcome: "inbox_only" })))),
		).toBe("message-off");
		expect(
			bridgeMark(bridgeRowOf(row(payload({ outcome: "awaiting_acceptance" })))),
		).toBe("hourglass");
	});

	it("leaves the text glyphs to the other outcomes and to a generic row", () => {
		for (const outcome of ["refused", "failed", "unconfirmed", null]) {
			expect(bridgeMark(bridgeRowOf(row(payload({ outcome }))))).toBeNull();
		}
		expect(bridgeMark(bridgeRowOf(row({})))).toBeNull();
		expect(bridgeMark(null)).toBeNull();
	});
});

describe("bridge row: the relay's words (bridge_copy)", () => {
	/* The relay renders every word from its own `wire.tool_rows.bridge.*`
	 *  catalogue (local-operator #3205) and this app prints them as sent. */
	const withCopy = (
		copy: Record<string, unknown>,
		over: Record<string, unknown> = {},
	) => row({ ...payload(over), bridge_copy: copy });

	it("reads outcome, headline and sentence, and strips ids from the headline", () => {
		expect(
			bridgeCopyOf(
				withCopy({
					outcome: "refused · not_a_member",
					headline: "Post to bcv_01HXYZ9",
					outcome_sentence: "The channel refused the post.",
				}),
			),
		).toEqual({
			outcome: "refused · not_a_member",
			headline: "Post to",
			outcomeSentence: "The channel refused the post.",
		});
	});

	it("a missing or malformed bridge_copy is absent, and the row shows no chip", () => {
		for (const details of [
			{},
			{ bridge_copy: null },
			{ bridge_copy: [] },
			{ bridge_copy: "refused" },
		]) {
			const entry = row({ ...payload({ outcome: "refused" }), ...details });
			const copy = bridgeCopyOf(entry);
			expect(copy).toBeNull();
			expect(bridgeOutcomeView(bridgeRowOf(entry), copy)).toBeNull();
		}
	});

	it("an empty outcome is no chip, and the tone comes from the token", () => {
		const landed = withCopy({ outcome: "", headline: "Posted to #release" });
		expect(
			bridgeOutcomeView(bridgeRowOf(landed), bridgeCopyOf(landed)),
		).toBeNull();

		const inbox = withCopy(
			{ outcome: "not posted to a conversation" },
			{
				outcome: "inbox_only",
			},
		);
		expect(bridgeOutcomeView(bridgeRowOf(inbox), bridgeCopyOf(inbox))).toEqual({
			text: "not posted to a conversation",
			tone: "warning",
		});

		const refused = withCopy(
			{ outcome: "refusé · not_a_member" },
			{
				outcome: "refused",
			},
		);
		expect(
			bridgeOutcomeView(bridgeRowOf(refused), bridgeCopyOf(refused)),
		).toEqual({
			text: "refusé · not_a_member",
			tone: "danger",
		});
	});

	it("keeps an unknown outcome token wordless even when copy arrives", () => {
		const odd = withCopy({ outcome: "teleported" }, { outcome: "teleported" });
		expect(bridgeOutcomeView(bridgeRowOf(odd), bridgeCopyOf(odd))).toBeNull();
	});
});

describe("bridge row: target label", () => {
	it("shows the relay's own label and invents nothing", () => {
		const of = (target: Record<string, unknown>) =>
			bridgeTargetLabel(bridgeRowOf(row(payload({ target }))));
		expect(of({ kind: "channel", label: "#release" })).toBe("#release");
		expect(of({ kind: "channel" })).toBeNull();
		expect(of({ kind: "dm" })).toBeNull();
		expect(of({ kind: "directory" })).toBeNull();
	});

	it("never shows an opaque id as the label", () => {
		expect(
			bridgeTargetLabel(
				bridgeRowOf(
					row(payload({ target: { kind: "dm", label: "bcv_01HXYZabc" } })),
				),
			),
		).toBeNull();
	});
});

describe("bridge row: headline", () => {
	it("prefers the relay's rendered headline, else its localized summary", () => {
		expect(bridgeHeadline(row({}), null)).toBe("Posted to #release");
		expect(
			bridgeHeadline(row({ summary: "Posted to #release" }), {
				outcome: "",
				headline: "Posted in #release",
				outcomeSentence: "",
			}),
		).toBe("Posted in #release");
	});

	it("strips every opaque id class a mixed-build frame may still carry", () => {
		const dirty = [
			"Posted to bcv_01HXYZ9 · nightly is green",
			"Reacted 👍 to bcmsg_77aa-bb",
			"→ acc_42 · hello",
			"Read ep_abc_def directory",
		];
		for (const summary of dirty) {
			const out = bridgeHeadline(row({}, { summary }), null);
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
		expect(bridgeHeadline(row({}, { summary: "" }), null)).toBe("bridge");
		expect(bridgeHeadline(row({}, { summary: "bcv_only" }), null)).toBe(
			"bridge",
		);
	});
});
