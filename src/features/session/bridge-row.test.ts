import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	bridgeAccessibleName,
	bridgeBody,
	bridgeCardHeadline,
	bridgeChipFits,
	bridgeChipLayout,
	bridgeChipShowsCode,
	bridgeCopyOf,
	bridgeGlyphFor,
	bridgeMark,
	bridgeOutcomeView,
	bridgeRowOf,
	bridgeRowSummary,
	bridgeToneOf,
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
		expect(bridgeRowOf(row({}))?.targetLabel ?? null).toBeNull();
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
			code: null,
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
			word: "not posted to a conversation",
			code: "",
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
			word: "refusé",
			code: " · not_a_member",
			tone: "danger",
		});
	});

	it("keeps an unknown outcome token wordless even when copy arrives", () => {
		const odd = withCopy({ outcome: "teleported" }, { outcome: "teleported" });
		expect(bridgeOutcomeView(bridgeRowOf(odd), bridgeCopyOf(odd))).toBeNull();
	});
});

describe("bridge row: the row line vs the card title", () => {
	/* Design round 1, D1: the row keeps the daemon's one-line summary (verb,
	 *  target, PREVIEW) and the card prints the rendered headline. Printing one
	 *  string twice lost the preview and repeated the row. */
	it("the row keeps the summary; the card takes the headline", () => {
		const entry = row(payload(), {
			summary: "Posted in #release · Nightly sweep is green.",
		});
		const copy = {
			outcome: "",
			headline: "Posted in #release",
			outcomeSentence: "",
		};
		expect(
			bridgeRowSummary(entry, bridgeCopyOf(entry), bridgeRowOf(entry)),
		).toBe("Posted in #release · Nightly sweep is green.");
		expect(bridgeCardHeadline(copy)).toBe("Posted in #release");
	});

	it("strips the outcome tail the chip already says (D10)", () => {
		/* `words` is the relay's chip text; the TOKEN is its first segment. */
		/* `outcome` is the TOKEN, `words` the relay's chip text (which carries
		 *  the code for a refusal). */
		const of = (summary: string, outcome: string, words = outcome) => {
			const entry = row(
				{ ...payload({ outcome }), bridge_copy: { outcome: words } },
				{ summary },
			);
			return bridgeRowSummary(entry, bridgeCopyOf(entry), bridgeRowOf(entry));
		};
		// the full two-segment tail, matched by TEXT not by the last separator
		expect(
			of(
				"Couldn't post in #leadership · Heads-up · refused · not_a_member",
				"refused",
				"refused · not_a_member",
			),
		).toBe("Couldn't post in #leadership · Heads-up");
		// the single-segment tail
		expect(
			of(
				"Sent to Priya · Can you look? · not posted to a conversation",
				"inbox_only",
				"not posted to a conversation",
			),
		).toBe("Sent to Priya · Can you look?");
		// a tail the projection's cap cut anywhere: inside the word…
		expect(
			of(
				"Sent to Priya · Can you look? · not posted…",
				"inbox_only",
				"not posted to a conversation",
			),
		).toBe("Sent to Priya · Can you look?");
		// …inside the code of a refusal…
		expect(
			of(
				"Couldn't post in #leadership · refused · not_a…",
				"refused",
				"refused · not_a_member",
			),
		).toBe("Couldn't post in #leadership");
		// …and cut to a bare separator (QA round 3's case)
		expect(
			of(
				"Sent to Priya · awaiting…",
				"awaiting_acceptance",
				"awaiting acceptance",
			),
		).toBe("Sent to Priya");
	});

	it("leaves a summary with no tail alone, and never invents one", () => {
		const entry = row(
			{ ...payload(), bridge_copy: { outcome: "" } },
			{ summary: "Looked up the team directory (2 members)" },
		);
		expect(
			bridgeRowSummary(entry, bridgeCopyOf(entry), bridgeRowOf(entry)),
		).toBe("Looked up the team directory (2 members)");
		/* Round 1 said "no chip → nothing to strip". Round 2's N1 showed the tail
		 *  is still there without copy — spelled in the machine tokens — and that
		 *  leaving it cuts the row line into `… · refused · not_a_member` behind a
		 *  projection ellipsis. It is stripped by TOKEN now. */
		const noCopy = row(
			{ ...payload({ outcome: "refused" }) },
			{ summary: "Posted · refused" },
		);
		expect(bridgeRowSummary(noCopy, null, bridgeRowOf(noCopy))).toBe("Posted");
	});

	it("scrubs every opaque id class on the row line", () => {
		const out = bridgeRowSummary(
			row(
				{},
				{
					summary:
						"Posted to bcv_01JC9X7Q2M8T · cut list attached · acc_remote_9",
				},
			),
			null,
			null,
		);
		expect(out).not.toMatch(ID);
		expect(out).toBe("Posted to · cut list attached");
	});

	it("falls back to the tool name rather than a blank line", () => {
		const entry = row({}, { summary: "" });
		expect(bridgeRowSummary(entry, null, null)).toBe("bridge");
	});
});

describe("bridge row: N1 — no dangling separator in the row line", () => {
	const call = (
		payloadOver: Record<string, unknown>,
		summary: string,
		copy: Record<string, unknown> | null = null,
	) => {
		const entry = row(
			{
				...payload(payloadOver),
				...(copy === null ? {} : { bridge_copy: copy }),
			},
			{ summary },
		);
		return bridgeRowSummary(entry, bridgeCopyOf(entry), bridgeRowOf(entry));
	};

	it("strips a TOKEN-shaped tail when the relay sent no words", () => {
		/* The copy-less refusal: the projection's own cap cuts the un-stripped
		 *  tail into `… · Heads-up ·…` — a separator left pointing at nothing. */
		const outcome = { outcome: "refused", code: "not_a_member" };
		expect(
			call(
				outcome,
				"Couldn't post in #leadership · Heads-up · refused · not_a_member",
			),
		).toBe("Couldn't post in #leadership · Heads-up");
		expect(call(outcome, "Couldn't post in #leadership · refused")).toBe(
			"Couldn't post in #leadership",
		);
	});

	it("leaves a sentence that merely mentions the outcome alone", () => {
		expect(
			call(
				{ outcome: "refused", code: "not_a_member" },
				"Couldn't post in #leadership: refused by policy",
			),
		).toBe("Couldn't post in #leadership: refused by policy");
	});

	it("tidies the separator an id left behind", () => {
		expect(
			call({ outcome: null }, "Posted in bcv_01JC9X7Q2M8T · cut list attached"),
		).toBe("Posted in · cut list attached");
		expect(call({ outcome: null }, "Posted in bcv_01JC9X7Q2M8T")).toBe(
			"Posted in",
		);
	});
});

describe("bridge row: ink for all five outcomes", () => {
	/* R2: the tone table is the rule that keeps a refusal, an inbox and a
	 *  pending write from sharing one ink; it is pinned for every arm. */
	const toneOf = (outcome: string) => {
		const entry = row({
			...payload({ outcome }),
			bridge_copy: { outcome: `${outcome} word` },
		});
		return bridgeOutcomeView(bridgeRowOf(entry), bridgeCopyOf(entry))?.tone;
	};

	it("maps each outcome to its own ink", () => {
		expect(toneOf("inbox_only")).toBe("warning");
		expect(toneOf("refused")).toBe("danger");
		expect(toneOf("failed")).toBe("danger");
		// R3/D2: pending is the AMBER warning tier, not a muted grey
		expect(toneOf("unconfirmed")).toBe("pending");
		expect(toneOf("awaiting_acceptance")).toBe("pending");
	});

	it("splits the relay's ` · code` into word and code", () => {
		const entry = row({
			...payload({ outcome: "refused", code: "not_a_member" }),
			bridge_copy: { outcome: "refused · not_a_member" },
		});
		expect(bridgeOutcomeView(bridgeRowOf(entry), bridgeCopyOf(entry))).toEqual({
			text: "refused · not_a_member",
			word: "refused",
			code: " · not_a_member",
			tone: "danger",
		});
	});
});

describe("bridge row: the leading glyph", () => {
	/* R2 (round 1): this decision used to live inside the component, where no
	 *  Node test could reach it — and it is where "never a success tick for an
	 *  unconfirmed write" lives (D2). R7 (round 2): it is keyed on the TOKEN, so
	 *  every arm below is asserted WITH and WITHOUT the relay's words. */
	const glyphOf = (outcome: string | null, words = true) => {
		const entry = row({
			...payload({ outcome }),
			...(words ? { bridge_copy: { outcome: "word" } } : {}),
		});
		return bridgeGlyphFor(bridgeRowOf(entry));
	};
	const AMBER = { glyph: "!", inkClass: "text-warning", pulsing: false };
	const RED = { glyph: "✗", inkClass: "text-danger", pulsing: false };

	it("never shows the green tick for a write nobody confirmed", () => {
		expect(glyphOf(null)).toBeNull();
		expect(glyphOf("unconfirmed")).toEqual(AMBER);
		expect(glyphOf("awaiting_acceptance")).toEqual(AMBER);
		expect(glyphOf("inbox_only")).toEqual(AMBER);
	});

	it("keeps the danger mark for a refusal and a hard failure", () => {
		expect(glyphOf("refused")).toEqual(RED);
		expect(glyphOf("failed")).toEqual(RED);
	});

	it("keeps the mark when the relay sent NO words (R7)", () => {
		/* The defect: copy was the data channel, so a copy-less peer inbox wore
		 * the settled tick and a copy-less refusal announced "bridge done". */
		expect(glyphOf("inbox_only", false)).toEqual(AMBER);
		expect(glyphOf("awaiting_acceptance", false)).toEqual(AMBER);
		expect(glyphOf("unconfirmed", false)).toEqual(AMBER);
		expect(glyphOf("refused", false)).toEqual(RED);
		expect(glyphOf("failed", false)).toEqual(RED);
	});

	it("measures the ink from the token for every outcome, words or none", () => {
		for (const outcome of [
			"inbox_only",
			"refused",
			"failed",
			"unconfirmed",
			"awaiting_acceptance",
		]) {
			const withWords = bridgeToneOf(bridgeRowOf(row(payload({ outcome }))));
			const without = bridgeToneOf(
				bridgeRowOf(row({ ...payload({ outcome }) })),
			);
			expect(without).toBe(withWords);
			/* The table's three tones: a refusal is danger, the two unconfirmed
			 * outcomes are the muted `pending` pair, the peer inbox is `warning` —
			 * and every one of them paints AMBER or RED through `bridgeGlyphFor`,
			 * never the settled ink (R3/D2). */
			expect(withWords).toBe(
				outcome === "refused" || outcome === "failed"
					? "danger"
					: outcome === "inbox_only"
						? "warning"
						: "pending",
			);
		}
		expect(bridgeToneOf(null)).toBeNull();
		expect(
			bridgeToneOf(bridgeRowOf(row(payload({ outcome: null })))),
		).toBeNull();
	});
});

describe("bridge row: the mark", () => {
	/* The identity column's mark is keyed on the token too (R7): a copy-less
	 *  peer inbox must keep `MessageSquareOff`. */
	it("marks the peer inbox and the pending acceptance by outcome only", () => {
		expect(
			bridgeMark(bridgeRowOf(row(payload({ outcome: "inbox_only" })))),
		).toBe("message-off");
		expect(
			bridgeMark(bridgeRowOf(row(payload({ outcome: "awaiting_acceptance" })))),
		).toBe("hourglass");
		expect(
			bridgeMark(bridgeRowOf(row(payload({ outcome: "refused" })))),
		).toBeNull();
		expect(bridgeMark(null)).toBeNull();
	});
});

describe("bridge row: the chip's layout", () => {
	/* Q1 (round 2): the chip's WORD clipped mid-phrase (`not posted to a con…`).
	 *  The app never re-words the relay's sentence, so a phrase that does not fit
	 *  is not shown at all: a marked outcome collapses to its mark, an unmarked
	 *  one takes its own line. */
	it("sheds the code, then the word, as the row narrows", () => {
		expect(bridgeChipShowsCode(390)).toBe(true);
		expect(bridgeChipShowsCode(384)).toBe(true);
		expect(bridgeChipShowsCode(383)).toBe(false);
		expect(bridgeChipShowsCode(272)).toBe(false);
	});

	it("keeps a short word inline at every phone width", () => {
		for (const width of [390, 342, 320, 272]) {
			expect(bridgeChipLayout(width, "refused", false)).toBe("words");
		}
	});

	it("collapses a MARKED outcome to its mark where the phrase cannot fit", () => {
		/* The inbox row: 24 characters, a mark to fall back on. */
		expect(bridgeChipLayout(342, "not posted to a conversation", true)).toBe(
			"mark",
		);
		expect(bridgeChipLayout(272, "not posted to a conversation", true)).toBe(
			"mark",
		);
	});

	it("gives an UNMARKED long phrase its own line instead of clipping it", () => {
		/* `delivery unconfirmed` has no mark: clipping it would be the Q1 defect
		 * and dropping it would hide the caveat, so it moves to its own line. */
		expect(bridgeChipLayout(272, "delivery unconfirmed", false)).toBe(
			"own-line",
		);
	});

	it("counts the 150 % scale as narrower, never wider", () => {
		expect(bridgeChipFits(390, "delivery unconfirmed", 1.5)).toBe(false);
		/* No mark to fall back on, so it takes its own line at any width rather
		 * than clipping — the one layout Q1 leaves honest. */
		expect(bridgeChipLayout(390, "delivery unconfirmed", false, 1.5)).toBe(
			"own-line",
		);
	});
});

describe("bridge row: the accessible name", () => {
	/* R1: a row whose words the relay withheld must still announce the state,
	 *  and the identity noun keeps "which tool" answerable (the visible name is
	 *  an icon). */
	it("leads with the identity and the state, then the relay's words", () => {
		const entry = row(
			{
				...payload({ outcome: "refused", code: "not_a_member" }),
				bridge_copy: { outcome: "refused · not_a_member" },
			},
			{
				tool_state: "failed",
				summary: "Couldn't post in #leadership · refused · not_a_member",
			},
		);
		expect(
			bridgeAccessibleName(entry, bridgeRowOf(entry), bridgeCopyOf(entry)),
		).toBe(
			"bridge failed, refused · not_a_member, Couldn't post in #leadership",
		);
	});

	it("keeps the state when there is no bridge_copy", () => {
		const entry = row(
			{ ...payload({ outcome: "refused", code: "not_a_member" }) },
			{ tool_state: "failed", summary: "Post to #leadership" },
		);
		expect(bridgeAccessibleName(entry, bridgeRowOf(entry), null)).toBe(
			/* The token's own words stand in for the withheld sentence, and the
			 * state is the outcome's — never "done" for a refusal (R7). */
			"bridge failed, refused, Post to #leadership",
		);
	});

	it("keeps a generic bridge row speakable", () => {
		const entry = row({}, { summary: "Read the directory" });
		expect(bridgeAccessibleName(entry, null, null)).toBe(
			"bridge done, Read the directory",
		);
	});
});
