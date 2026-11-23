/**
 * The ask-id chip's rules: which tokens in prose ARE ask ids, what state word a
 * chip carries, and which of THIS session's asks an id resolves to.
 *
 * WHY A MODULE OF ITS OWN. The renderer (`components/markdown.tsx`) draws what
 * this module decides, and the repository's rule is that anything worth
 * asserting lives outside a component (`vitest.config.ts`: tests run in Node, so
 * logic is plain modules and the component renders what they say). Every rule
 * here is a pure reading of strings and rows — no React, no React Native.
 *
 * THE MATCH IS AN EXACT TOKEN, not a substring. An agent cites an ask id it was
 * handed (`a-745e`) inside prose, usually in backticks; the same six characters
 * appear inside hashes, commit shas, paths and file names, and a chip drawn
 * there would be a control that opens nothing. So a match must stand alone: the
 * character before and after it may not be a word character, `-`, `_`, a path
 * separator (`/`, `\`) or a leading `.` — and a trailing `.` only ends the id
 * when no name continues after it. `a-745e6` is a longer hex run, `xa-745e` is
 * the tail of a different token, `a-12ab.json` is a file, and none is an ask id.
 *
 * IDS ARE UNIQUE PER SESSION ONLY (`secrets.token_hex(2)` in the runtime's ask
 * store), so the chip NEVER looks across conversations: an id that is not among
 * THIS session's asks is drawn as plain mono and says so when tapped, because
 * opening another conversation's ask would be a jump to the wrong question.
 */

import type { PendingAsk } from "@/contracts";
import type { NoParamKey } from "@/i18n";

/** An ask id as an agent writes it: `a-` and four lower-case hex digits. */
const ASK_ID = /a-[0-9a-f]{4}/g;

/** What may not touch an id and still leave it an id (see the module note).
 *
 *  PATH SEPARATORS AND A LEADING DOT ARE EDGES TOO (review round 1, m3): the
 *  module note promises paths are guarded, but `https://x/a-745e`,
 *  `logs/a-12ab.txt` and `x.a-12ab` are names, not citations, and a chip drawn
 *  there opens nothing. A TRAILING dot is not an edge — "withdrawn in a-745e."
 *  ends a sentence — so it only blocks when a name continues after it
 *  (`a-12ab.json`), which `TOKEN_ENDS_WITH_DOT_NAME` reads. */
const TOKEN_EDGE_BEFORE = /[\w\-/\\.]/;
const TOKEN_EDGE_AFTER = /[\w\-/\\]/;
const TOKEN_ENDS_WITH_DOT_NAME = /^[.][\w-]/;

/** One run of prose, or one ask id inside it. */
export type AskChipSegment =
	| { kind: "text"; text: string }
	| { kind: "ask"; id: string };

/**
 * Split prose into plain runs and ask-id tokens.
 *
 * The fast path is the common one: most spans carry no id, and scanning them
 * for one every frame a streamed answer renders is work with no result.
 */
export const askIdSegments = (text: string): AskChipSegment[] => {
	if (!text.includes("a-")) return text === "" ? [] : [{ kind: "text", text }];
	const segments: AskChipSegment[] = [];
	let cursor = 0;
	for (const match of text.matchAll(ASK_ID)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (TOKEN_EDGE_BEFORE.test(text[start - 1] ?? "")) continue;
		if (TOKEN_EDGE_AFTER.test(text[end] ?? "")) continue;
		if (TOKEN_ENDS_WITH_DOT_NAME.test(text.slice(end))) continue;
		if (start > cursor)
			segments.push({ kind: "text", text: text.slice(cursor, start) });
		segments.push({ kind: "ask", id: match[0] });
		cursor = end;
	}
	if (cursor === 0) return [{ kind: "text", text }];
	if (cursor < text.length)
		segments.push({ kind: "text", text: text.slice(cursor) });
	return segments;
};

/** Whether a whole string is exactly one ask id (an id alone in a code span). */
export const isAskId = (text: string): boolean => {
	const segments = askIdSegments(text);
	return segments.length === 1 && segments[0]?.kind === "ask";
};

/**
 * The short word a chip carries, per state — the SAME eight states the state
 * lines name (`asks.ts`), in the one word a chip has room for. A state a newer
 * runtime invents falls through to its own word rather than being reported as a
 * known one (`askStateLine`'s rule, kept here too).
 */
const CHIP_WORD: ReadonlyMap<string, NoParamKey> = new Map<string, NoParamKey>([
	["open", "mobile.asks.chip.open"],
	["answered", "mobile.asks.chip.answered"],
	["declined", "mobile.asks.chip.declined"],
	["timed_out", "mobile.asks.chip.timed_out"],
	["late", "mobile.asks.chip.late"],
	["dismissed", "mobile.asks.chip.dismissed"],
	["withdrawn", "mobile.asks.chip.withdrawn"],
	["expired", "mobile.asks.chip.expired"],
] as const);

/** The catalogue key for a state's chip word, or the state's own spelling for
 *  one this build does not know. `null` only for an empty status. */
export const askChipWord = (
	status: string,
):
	| { kind: "key"; key: NoParamKey }
	| { kind: "literal"; text: string }
	| null => {
	/* A Map, not a plain record: a wire status of `constructor` or `toString` must
	 *  not reach the catalogue as an inherited member (review round 1, Q3) — the
	 *  runtime may invent a state, so every key is untrusted input. */
	const known = CHIP_WORD.get(status);
	if (known !== undefined) return { kind: "key", key: known };
	const literal = status.replace(/_/g, " ").trim();
	return literal === "" ? null : { kind: "literal", text: literal };
};

/** Whether a chip's dot is drawn in the accent (a question still open) or muted
 *  (settled). Colour is never the only signal — the word beside it is — so this
 *  is a reading aid, not the state. */
export const askChipOpen = (status: string): boolean => status === "open";

/** What one id resolves to here: the state word's status and the question the
 *  screen reader names. */
export type AskChipFact = { status: string; question: string };

/** The transcript receipt a settled ask leaves (`ask_response` / `ask_timeout`).
 *  Narrow on purpose: the chip needs the id, the status and the head question,
 *  and taking the whole entry would tie this module to the wire's shape. */
export interface AskChipReceipt {
	kind: string;
	details: {
		ask_id?: string | undefined;
		status?: string | undefined;
		questions?: readonly { question?: string | undefined }[] | undefined;
	};
}

const headQuestion = (
	questions: readonly { question?: string | undefined }[] | undefined,
): string =>
	String(questions?.[0]?.question ?? "")
		.replace(/\s+/g, " ")
		.trim();

export interface AskChipSources {
	/** The live frame's rows for this conversation (`projection.asks`). They
	 *  carry no `session_id`, so they ARE this session's by construction. */
	frame?: readonly PendingAsk[] | null;
	/** The settled receipts the transcript already drew. This is the only source
	 *  that still knows a settled ask's state after it left the frame. */
	transcript?: readonly AskChipReceipt[] | null;
	/** The asks sheet's last successful read (`GET /api/asks`, every
	 *  conversation). It is the only source that can name a WITHDRAWN ask — the
	 *  one settled state the transcript has no row for. Rows of other
	 *  conversations are dropped: ids repeat across sessions. Its `open` rows are
	 *  only trusted when `frame` is not an array (see `askChipFacts`). */
	settled?: readonly PendingAsk[] | null;
}

/**
 * The ids THIS session can answer for, in precedence order: the live frame
 * first (the freshest reading of an open ask), then a transcript receipt, then
 * the sheet's aggregate.
 *
 * A FRAME ROW WINS OVER A RECEIPT because the frame is live: an ask answered on
 * another device settles there first, and a stale `open` chip is what the reader
 * would press expecting a question.
 */
export const askChipFacts = (
	{ frame, transcript, settled }: AskChipSources,
	sessionId: string,
): Map<string, AskChipFact> => {
	const facts = new Map<string, AskChipFact>();
	/* `null` is "this runtime publishes no frame" (see the sources note); an array
	 *  — even an empty one — is a live reading that knows what it does not hold. */
	const live = Array.isArray(frame) ? frame : null;
	if (live !== null) {
		for (const row of live) {
			const id = String(row?.ask_id ?? "");
			if (id === "") continue;
			facts.set(id, {
				status: String(row.status || "open"),
				question: headQuestion(row.questions),
			});
		}
	}
	if (Array.isArray(transcript)) {
		for (const entry of transcript) {
			const id = String(entry?.details?.ask_id ?? "");
			if (id === "" || facts.has(id)) continue;
			const status = String(
				entry.details.status ||
					(entry.kind === "ask_timeout" ? "timed_out" : "answered"),
			);
			facts.set(id, {
				status,
				question: headQuestion(entry.details.questions),
			});
		}
	}
	if (Array.isArray(settled)) {
		for (const row of settled) {
			const id = String(row?.ask_id ?? "");
			if (id === "" || facts.has(id)) continue;
			/* Another conversation's row: an id is unique per session only, so
			 *  this is a different ask that happens to spell the same. */
			if (String(row.session_id ?? "") !== sessionId) continue;
			const status = String(row.status || "open");
			/* `open` IS NOT THIS SOURCE'S TO SAY while the frame speaks (M1): the
			 *  sheet reads only while it is visible and keeps its last read after it
			 *  closes, so an ask the agent has since withdrawn still reads `open`
			 *  there — the frame has dropped it and there is no receipt, which is
			 *  exactly the headline "the old one, a-745e, is withdrawn". A stale
			 *  `open` chip is what the reader would press expecting a question. Every
			 *  OTHER state still says something the frame cannot: a settled ask leaves
			 *  the frame, and `withdrawn` leaves no receipt at all. */
			if (status === "open" && live !== null) continue;
			facts.set(id, { status, question: headQuestion(row.questions) });
		}
	}
	return facts;
};

/**
 * One string that changes exactly when an id's state does, so the chip host can
 * keep its identity stable across the frames that leave it unchanged.
 *
 * The QUESTION is in the signature because it is not derived from the status
 * (review round 1, N3): an ask re-put with a reworded question keeps its state
 * word, and the chip's spoken label would otherwise keep the old question.
 */
export const askChipSignature = (facts: Map<string, AskChipFact>): string =>
	[...facts]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([id, fact]) => `${id}:${fact.status}:${fact.question}`)
		.join(",");
