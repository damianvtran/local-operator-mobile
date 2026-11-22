import type { TranscriptEntry } from "@/contracts";
import { type AssistantPart, decodeInlineUi } from "./inline-ui-parts";

// Keep presentation metadata on the exact winning row, never at a bare id in
// a separate cache. Live replaces stale pages for shared rows and a late page
// cannot attach a widget to a live row that won the existing revision fence.
// A symbol also cannot be supplied as a key in a loose JSON transcript row.
export const LIVE_INLINE_UI = Symbol("live inline UI");
export type DisplayTranscriptEntry = TranscriptEntry & {
	[LIVE_INLINE_UI]?: readonly AssistantPart[];
};

// Match the relay's sidecar ceiling (session/runtime/inline_ui_egress.py).
// This cheap client check bounds decoding; it does not budget the legacy prose.
const SIDECAR_BUDGET = 48 * 1024;
const MIN_PLACEMENT_SIZE = '{"offset":0,"payload":{}}'.length;

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function decodeMessage(value: unknown): readonly AssistantPart[] | undefined {
	const envelope = record(value);
	if (envelope?.version !== 1) return undefined;
	const { text, widgets } = envelope;
	if (
		typeof text !== "string" ||
		text.length > SIDECAR_BUDGET ||
		!Array.isArray(widgets) ||
		widgets.length === 0 ||
		widgets.length * MIN_PLACEMENT_SIZE > SIDECAR_BUDGET
	)
		return undefined;

	const parts: AssistantPart[] = [];
	let cursor = 0;
	let remaining = SIDECAR_BUDGET - text.length;
	for (const widget of widgets) {
		const placement = record(widget);
		const offset = placement?.offset;
		if (
			typeof offset !== "number" ||
			!Number.isInteger(offset) ||
			offset < cursor ||
			offset > text.length
		)
			return undefined;
		// Offsets are UTF-16 code units into the envelope's exact text, not
		// Unicode code points or offsets into the legacy row's text.
		const before = text.charCodeAt(offset - 1);
		const after = text.charCodeAt(offset);
		if (
			before >= 0xd800 &&
			before <= 0xdbff &&
			after >= 0xdc00 &&
			after <= 0xdfff
		)
			return undefined;
		const payload = decodeInlineUi(placement?.payload);
		if (!payload) return undefined;
		remaining -= JSON.stringify({ offset, payload }).length;
		if (remaining < 0) return undefined;
		if (offset > cursor)
			parts.push({ kind: "markdown", text: text.slice(cursor, offset) });
		parts.push({ kind: "ui", value: payload });
		cursor = offset;
	}
	if (cursor < text.length)
		parts.push({ kind: "markdown", text: text.slice(cursor) });
	return parts;
}

export function withInlineUi(
	wire: unknown,
	rows: TranscriptEntry[],
): DisplayTranscriptEntry[] {
	const overlay = record(wire);
	if (overlay?.version !== 1) return rows;
	const messages = record(overlay.messages);
	if (!messages) return rows;

	// The map addresses rows by id alone. If the wire repeats an assistant id,
	// there is no way to tell which occurrence this optional data belongs to.
	const seen = new Set<string>();
	const ambiguous = new Set<string>();
	for (const { id, kind } of rows) {
		if (kind !== "assistant") continue;
		if (seen.has(id)) ambiguous.add(id);
		seen.add(id);
	}
	return rows.map((row) => {
		if (
			row.kind !== "assistant" ||
			ambiguous.has(row.id) ||
			!Object.hasOwn(messages, row.id)
		)
			return row;
		const parts = decodeMessage(messages[row.id]);
		return parts ? { ...row, [LIVE_INLINE_UI]: parts } : row;
	});
}
