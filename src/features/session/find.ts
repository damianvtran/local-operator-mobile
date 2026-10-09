/**
 * In-conversation find, as pure arithmetic over the frames this phone HOLDS.
 *
 * ## What this is, and what it deliberately is not
 *
 * The desktop transcript's find (⌘F, `sessions.find`) searches a
 * backend-derived index of the whole conversation's message docs
 * (`local_operator/session/transcript_find.py`). The mobile relay carries no
 * such route — its contract's only search is the session LIST
 * (`/api/sessions/search`), and the aggregate-route grep in the PR is the
 * proof — so a native "find in this conversation" can only be the same
 * FEATURE with a smaller subject: the messages loaded on this device.
 *
 * That is a real limit, not a detail to bury: the projection is a tail WINDOW
 * (`mobile/projection.py::_cap_tail`, ≤80 rows) plus the one history page the
 * screen fetches, so a match in an older message that was never loaded cannot
 * be found here until that message is. The surface says so in words
 * (`findScopeLines`) instead of pretending the conversation is whole. A
 * match beyond what a frame carries is a STATED miss — the same direction the
 * desktop's `DOC_TEXT_CAP` takes ("a match beyond the cap is a stated miss,
 * not a silent one").
 *
 * ## The semantics, ported from the desktop's pipeline (design §D3)
 *
 * The same tiers and ranking as `transcript_find.py`, so the two surfaces
 * agree about what a match IS:
 *
 *   1. `exact` — a casefolded literal substring of a message's text;
 *   2. `soft` — the bounded typo tolerance (prefix, order-independent
 *      token-AND, edit distance ≤2 on 4+ character tokens), run only when
 *      fewer than `PRECISE_HITS_ENOUGH` messages matched exactly, so a precise
 *      answer is never crowded by near-misses;
 *   3. ranking — exact tier before soft, genuine messages before the injected
 *      ones (parent / subagent / peer deliveries), oldest first inside that,
 *      so stepping walks the conversation forward.
 *
 * What the search READS is message text only — the same set the desktop index
 * builds docs from, mapped onto the wire's kinds: `user`/`steer` and
 * `assistant` are the genuine messages; `parent_message`/`subagent_message`/
 * `peer_message` are injected inputs; and the folded notice family the relay
 * paints (`notice`, `compaction`, `ask_response`, `ask_timeout` — wake
 * deliveries, gate/job receipts, compaction markers, ask receipts and
 * timeouts) is searchable too, because the desktop index makes a doc for every
 * injected row and each of these is a row this app PAINTS — find's own rule
 * for a landing is that its row be one a reader can see. All injected kinds
 * rank after the genuine messages. Tool output and reasoning rows are never
 * searchable: tool rows are machine output, and reasoning rows never join the
 * durable transcript either surface indexes.
 *
 * ## The divergences from the desktop, stated
 *
 * 1. LABELS. The desktop files injected docs under the wire's two-role
 *    vocabulary (`user | agent`), so its result rows label a peer delivery
 *    "You". This app already paints those rows with their own labels (Parent /
 *    Subagent / Peer — and Notice / Compaction / Ask for the folded
 *    families), so the find rows use the transcript's vocabulary — same
 *    inclusion set, same demotion, a label that is not a lie.
 * 2. FOLDED TEXT. The rows the relay folds (wake deliveries, ask receipts,
 *    compaction markers and refusals) are searched as the folded line the
 *    surface paints, not as the raw journal payload the desktop's index still
 *    reads — a word that exists only in what the fold drops (model markup,
 *    envelope scaffolding) is not findable here, and a wake catch-up is not
 *    carried at all (the fold drops it whole — there is no folded line), so
 *    its prose is not findable either. Where a payload detail does survive
 *    the fold into the paint — an ask timeout's `details.text` is carried and
 *    rendered verbatim in the row's disclosure — the search still compares
 *    the row's lead line only: text carried only in `details` (disclosures)
 *    is not compared.
 * 3. THE HUB ENVELOPE. The desktop indexes a hub/peer delivery's
 *    `details.text`, the model-facing envelope; the envelope deliberately
 *    never crosses the wire (it would paint raw markup — the fold reads
 *    `details.body` instead), so this search reads the body the sender
 *    authored. A term that occurs only in the envelope — its tags, the label
 *    and job ids — is not findable here. Same row, same demotion; the one
 *    part of the desktop's text the phone cannot hold.
 */

import type { TranscriptEntry } from "@/contracts";
import type { CondensePlan } from "@/features/session/turn-condensing";

/* ----------------------------------------------------------------- constants */

/** Most characters of query the field takes — the desktop route's own bound
 *  (`q` 1..256, `desktop_sessions.py`), mirrored so both surfaces refuse the
 *  same input for the same reason: every character is compared against every
 *  doc, and a find query is only ever a reader's typing. ENFORCED by the find
 *  field's `maxLength` (so a paste is cut the way typing is); the search
 *  itself stays a pure function over whatever it is handed. */
export const FIND_QUERY_MAX = 256;

/** Most hits the answer carries — the desktop route's default `limit` (1..200
 *  with default 100). A navigation surface, not an export; `truncated` says
 *  when the list was cut. */
export const FIND_LIMIT = 100;

/** Exact hits below this count earn the soft pass (the desktop's
 *  `PRECISE_HITS_ENOUGH`, shared with the store search). */
export const PRECISE_HITS_ENOUGH = 3;

/** Characters of context kept on each side of the first match in a snippet. */
export const SNIPPET_CONTEXT = 60;

/** Most match ranges a hit may carry; a long message can contain the query
 *  hundreds of times and each range is painted. */
export const SNIPPET_MAX_RANGES = 5;

/** Minimum token length for edit-distance matching (desktop `_SOFT_MIN_TOKEN`):
 *  below four characters a bounded typo match is "confident nonsense". */
export const SOFT_MIN_TOKEN = 4;

/** Maximum edit distance for a soft token match (desktop `_SOFT_MAX_DISTANCE`). */
export const SOFT_MAX_DISTANCE = 2;

/* --------------------------------------------------------------------- trim */

/**
 * The query's trim, with Python's `str.strip()` semantics — the desktop's own
 * cut (`query.strip().casefold()` in `transcript_find.py`). The two disagree
 * in BOTH directions and the disagreement is observable: Python strips the
 * file separators (\x1c–\x1f) that JS `trim()` leaves on, and JS strips
 * U+FEFF, which Python leaves — either way the same query lands in a
 * different tier across the surfaces (QA Q63-4: `retry\x1c` read soft here
 * and exact there).
 *
 * The set below is Python `str.isspace()`'s, written out rather than
 * approximated: whitespace plus \x1c-\x1f, \x85, \xa0 and the Unicode space
 * separators — deliberately WITHOUT U+FEFF. A Set walked by index rather
 * than a regex, because the characters ARE the set and a pattern spelling
 * them out is one escaping mistake away from a silent divergence; every
 * entry is a single BMP code unit, so index access is exact.
 */
const DESKTOP_SPACE = new Set([
	"\t",
	"\n",
	"\v",
	"\f",
	"\r",
	"\x1c",
	"\x1d",
	"\x1e",
	"\x1f",
	" ",
	"\x85",
	"\xa0",
	"\u1680",
	"\u2000",
	"\u2001",
	"\u2002",
	"\u2003",
	"\u2004",
	"\u2005",
	"\u2006",
	"\u2007",
	"\u2008",
	"\u2009",
	"\u200a",
	"\u2028",
	"\u2029",
	"\u202f",
	"\u205f",
	"\u3000",
]);

const desktopTrim = (text: string): string => {
	let start = 0;
	let end = text.length;
	while (start < end && DESKTOP_SPACE.has(text[start] ?? "")) start += 1;
	while (end > start && DESKTOP_SPACE.has(text[end - 1] ?? "")) end -= 1;
	return text.slice(start, end);
};

/* ---------------------------------------------------------------------- fold */

/**
 * One code point's folded piece — the fold both tiers compare through.
 *
 * JS has no `String#casefold`, so `toUpperCase().toLowerCase()` is the standard
 * approximation, and the documented expansions survive it (`ß` → `ss`, `İ` →
 * `i̇`). It misses exactly one of the scripts this app sees: U+1E9E (ẞ)
 * lowercases to ß (U+00DF), which does NOT itself expand — Python's
 * `str.casefold()` (the desktop's comparison) maps BOTH ß and ẞ to `ss`, so
 * the shortcut made a message the desktop finds invisible to `strasse` (QA
 * Q63-3: "DIE STRAẞE BLEIBT GESPERRT."). Everything else in the battery
 * (İ, ς, ﬁ, emoji, Cherokee) already agrees.
 *
 * Folding PER CODE POINT — rather than the whole string — is what makes the
 * offset map in `literalOccurrences` exact: the folded string and the map back
 * to original positions are one computation, so a highlighted range covers
 * exactly the characters the match touched. The cost is that a
 * context-sensitive fold the platform might do across characters (Greek final
 * sigma) never runs; matches stay self-consistent because both sides fold the
 * same way.
 */
export const foldPiece = (char: string): string =>
	char === "\u1E9E" ? "ss" : char.toUpperCase().toLowerCase();

export const casefold = (text: string): string => {
	let out = "";
	for (const char of text) out += foldPiece(char);
	return out;
};

interface FoldedText {
	/** The per-code-point folded text. */
	text: string;
	/** Folded-unit start of each code point, plus the total — or `null` when
	 *  every code point folded to the same unit length, which makes folded and
	 *  original offsets identical and needs no map at all. */
	foldStarts: number[] | null;
	/** Original-unit start of each code point, plus the total. */
	origStarts: number[] | null;
}

const foldText = (text: string): FoldedText => {
	const foldStarts: number[] = [0];
	const origStarts: number[] = [0];
	let folded = "";
	let origUnits = 0;
	let aligned = true;
	for (const char of text) {
		const piece = foldPiece(char);
		if (piece.length !== char.length) aligned = false;
		folded += piece;
		origUnits += char.length;
		foldStarts.push(folded.length);
		origStarts.push(origUnits);
	}
	return {
		text: folded,
		foldStarts: aligned ? null : foldStarts,
		origStarts: aligned ? null : origStarts,
	};
};

/** The last index whose value is ≤ `position` (Python's `bisect_right - 1`). */
const lastAtOrBefore = (values: number[], position: number): number => {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if ((values[mid] ?? 0) <= position) low = mid + 1;
		else high = mid;
	}
	return low - 1;
};

/**
 * Non-overlapping occurrences of `needle` in `text`, raw offsets into `text`.
 *
 * Both inputs are already casefolded (the caller folds the query once). The
 * fast path runs whenever no code point expanded; otherwise each folded match
 * is mapped back through the fold table, and a match that would land inside a
 * range already claimed (two halves of one `ß`) is skipped rather than painted
 * twice — the desktop's own guard.
 */
export const literalOccurrences = (
	text: string,
	needle: string,
	cap: number = SNIPPET_MAX_RANGES,
): Array<[number, number]> => {
	if (needle.length === 0) return [];
	const folded = foldText(text);
	const found: Array<[number, number]> = [];

	if (folded.foldStarts === null || folded.origStarts === null) {
		let at = folded.text.indexOf(needle);
		while (at >= 0 && found.length < cap) {
			found.push([at, at + needle.length]);
			at = folded.text.indexOf(needle, at + needle.length);
		}
		return found;
	}

	let at = folded.text.indexOf(needle);
	while (at >= 0 && found.length < cap) {
		const begin = lastAtOrBefore(folded.foldStarts, at);
		const end = lastAtOrBefore(folded.foldStarts, at + needle.length - 1) + 1;
		const start = folded.origStarts[begin] ?? 0;
		const stop = folded.origStarts[end] ?? text.length;
		const last = found[found.length - 1];
		if (last === undefined || start >= last[1]) found.push([start, stop]);
		at = folded.text.indexOf(needle, at + needle.length);
	}
	return found;
};

/* ---------------------------------------------------------------------- soft */

/** Lowercase alphanumeric tokens (desktop `_TOKEN_RE = [a-z0-9]+`). */
export const tokenize = (text: string): string[] =>
	text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Whether `a` and `b` are at most `maxDistance` edits apart — a bounded
 *  Levenshtein: the length gap rejects before any work, and a row whose every
 *  cell already exceeds the cap aborts (distance only grows downward). */
export const withinEditDistance = (
	a: string,
	b: string,
	maxDistance: number,
): boolean => {
	if (Math.abs(a.length - b.length) > maxDistance) return false;
	if (a === b) return true;
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i += 1) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const value = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + cost,
			);
			current.push(value);
			if (value < rowMin) rowMin = value;
		}
		if (rowMin > maxDistance) return false;
		previous = current;
	}
	return (previous[b.length] ?? 0) <= maxDistance;
};

/** Whether one query token softly matches any token of a message: equality,
 *  prefix, or the bounded typo ladder (both tokens 4+ characters). */
const tokenSoftMatches = (
	needleToken: string,
	tokens: Set<string>,
): boolean => {
	for (const token of tokens) {
		if (token === needleToken || token.startsWith(needleToken)) return true;
		if (
			needleToken.length >= SOFT_MIN_TOKEN &&
			token.length >= SOFT_MIN_TOKEN &&
			withinEditDistance(needleToken, token, SOFT_MAX_DISTANCE)
		) {
			return true;
		}
	}
	return false;
};

/** Order-independent token-AND: every query token must land somewhere. */
export const softMatches = (text: string, query: string): boolean => {
	const needleTokens = tokenize(query);
	if (needleTokens.length === 0) return false;
	const tokens = new Set(tokenize(text));
	return needleTokens.every((token) => tokenSoftMatches(token, tokens));
};

/* ------------------------------------------------------------------ the docs */

export type FindRole =
	| "user"
	| "agent"
	| "parent"
	| "subagent"
	| "peer"
	| "notice"
	| "compaction"
	| "ask";
export type FindTier = "exact" | "soft";

/**
 * The wire kinds find reads, and how each ranks.
 *
 * One row per kind rather than a set of predicates, so the inclusion decision
 * is one table a reviewer can read against the desktop's rule ("one doc per
 * user/assistant message row and per injected row; tool rows never").
 */
/**
 * The wire kinds find reads, and how each ranks.
 *
 * One row per kind rather than a set of predicates, so the inclusion decision
 * is one table a reviewer can read against the desktop's rule ("one doc per
 * user/assistant message row and per injected row; tool rows never"): the
 * genuine messages, the injected deliveries, and the folded notice family the
 * desktop also indexes (`notice`/`compaction`/`ask_response`/`ask_timeout` —
 * the wake/ask/job receipts and compaction markers). Every non-genuine kind is
 * injected, so the desktop's demotion carries over unchanged.
 */
const DOC_KINDS: Record<
	string,
	{ role: FindRole; injected: boolean } | undefined
> = {
	user: { role: "user", injected: false },
	steer: { role: "user", injected: false },
	assistant: { role: "agent", injected: false },
	parent_message: { role: "parent", injected: true },
	subagent_message: { role: "subagent", injected: true },
	peer_message: { role: "peer", injected: true },
	notice: { role: "notice", injected: true },
	compaction: { role: "compaction", injected: true },
	ask_response: { role: "ask", injected: true },
	ask_timeout: { role: "ask", injected: true },
};

export interface FindDoc {
	id: string;
	role: FindRole;
	text: string;
	/** An injected input (parent / subagent / peer delivery): searchable, ranked
	 *  after genuine messages within its tier — the desktop's demotion rule. */
	injected: boolean;
	/** Position among the loaded frames — this surface's stand-in for the
	 *  journal ordinal the desktop ranks by (the frames arrive in journal
	 *  order, so position preserves it for everything the phone holds). */
	index: number;
}

/** One document per searchable message row, in frame order. */
export const findDocs = (entries: readonly TranscriptEntry[]): FindDoc[] => {
	const docs: FindDoc[] = [];
	entries.forEach((entry, index) => {
		const kind = DOC_KINDS[entry.kind];
		if (kind === undefined) return;
		docs.push({
			id: entry.id,
			role: kind.role,
			text: entry.text,
			injected: kind.injected,
			index,
		});
	});
	return docs;
};

/* ---------------------------------------------------------------- the search */

export interface FindHit {
	/** The message's entry id — the landing target. */
	id: string;
	role: FindRole;
	/** Windowed ±60 around the first match (exact), or the message's head
	 *  (soft): a soft hit has no literal occurrence to window onto. */
	snippet: string;
	/** Snippet-relative, non-overlapping, oldest first, ≤5; empty on a soft hit
	 *  (a range whose text never equaled the query would be a second claim). */
	ranges: Array<[number, number]>;
	tier: FindTier;
}

export interface FindAnswer {
	hits: FindHit[];
	/** The ranked list was cut at `limit`. */
	truncated: boolean;
}

/** A cut window that never splits a surrogate pair (a lone half renders as a
 *  replacement glyph, and JS unit offsets can land mid-pair where Python's
 *  character offsets could not). */
const snapCut = (text: string, at: number): number => {
	if (at <= 0 || at >= text.length) return at;
	const before = text.charCodeAt(at - 1);
	return before >= 0xd800 && before <= 0xdbff ? at - 1 : at;
};

const snippetFor = (
	text: string,
	occurrences: Array<[number, number]>,
): { snippet: string; ranges: Array<[number, number]> } => {
	const first = occurrences[0];
	if (first === undefined) {
		return {
			snippet: text.slice(0, snapCut(text, SNIPPET_CONTEXT * 2)),
			ranges: [],
		};
	}
	const windowStart = snapCut(text, Math.max(0, first[0] - SNIPPET_CONTEXT));
	const windowEnd = snapCut(
		text,
		Math.min(text.length, first[1] + SNIPPET_CONTEXT),
	);
	const ranges: Array<[number, number]> = [];
	for (const [start, end] of occurrences) {
		if (start < windowStart || end > windowEnd) continue;
		ranges.push([start - windowStart, end - windowStart]);
		if (ranges.length >= SNIPPET_MAX_RANGES) break;
	}
	return { snippet: text.slice(windowStart, windowEnd), ranges };
};

/** The empty set `searchConversation` starts its soft pass from. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * Rank this conversation's loaded messages for `query`; the answer's hits and
 * whether the list was cut. Pure: no I/O, no clocks, no caches — the phone's
 * loaded set is bounded by the relay's own windows (≤80-row projection tail
 * plus the one history page), so the stateless pass is the whole cost, where
 * the desktop holds a token-cache accelerator for a 640-session store.
 */
export const searchConversation = (
	entries: readonly TranscriptEntry[],
	query: string,
	limit: number = FIND_LIMIT,
): FindAnswer => {
	const needle = casefold(desktopTrim(query));
	const docs = findDocs(entries);
	if (needle.length === 0 || limit <= 0) return { hits: [], truncated: false };

	const occurrences = new Map<string, Array<[number, number]>>();
	for (const doc of docs) {
		const found = literalOccurrences(doc.text, needle);
		if (found.length > 0) occurrences.set(doc.id, found);
	}

	let softIds: ReadonlySet<string> = EMPTY_IDS;
	if (occurrences.size < PRECISE_HITS_ENOUGH) {
		const matched = new Set<string>();
		for (const doc of docs) {
			if (softMatches(doc.text, query)) matched.add(doc.id);
		}
		softIds = matched;
	}

	const ranked: Array<{
		tier: FindTier;
		doc: FindDoc;
		spans: Array<[number, number]>;
	}> = [];
	for (const doc of docs) {
		const found = occurrences.get(doc.id);
		if (found !== undefined) ranked.push({ tier: "exact", doc, spans: found });
		else if (softIds.has(doc.id)) ranked.push({ tier: "soft", doc, spans: [] });
	}
	// (tier, injected, position) — a total order, so the result is deterministic
	// and stepping walks oldest first inside each class.
	ranked.sort((a, b) => {
		const tier = (a.tier === "exact" ? 0 : 1) - (b.tier === "exact" ? 0 : 1);
		if (tier !== 0) return tier;
		const injected = (a.doc.injected ? 1 : 0) - (b.doc.injected ? 1 : 0);
		if (injected !== 0) return injected;
		return a.doc.index - b.doc.index;
	});

	const truncated = ranked.length > limit;
	const hits = ranked.slice(0, limit).map(({ tier, doc, spans }) => {
		const { snippet, ranges } = snippetFor(doc.text, spans);
		return { id: doc.id, role: doc.role, snippet, ranges, tier };
	});
	return { hits, truncated };
};

/* ------------------------------------------------------------------- segments */

/** One rendered run of a snippet: matched text, or the text between matches. */
export interface FindSegment {
	text: string;
	matched: boolean;
}

/**
 * Split a snippet into marked and unmarked runs — the desktop's
 * `splitThreadSearchRanges`, same recovery: ranges are clamped forward as the
 * walk proceeds, empty runs are dropped, and an out-of-order range can only
 * move the cursor forward rather than paint overlapping marks.
 */
export const splitRanges = (
	snippet: string,
	ranges: ReadonlyArray<readonly [number, number]>,
): FindSegment[] => {
	const segments: FindSegment[] = [];
	let at = 0;
	for (const [rawStart, rawEnd] of ranges) {
		const start = Math.max(at, Math.min(snippet.length, rawStart));
		const end = Math.max(start, Math.min(snippet.length, rawEnd));
		if (end <= start) continue;
		if (start > at)
			segments.push({ text: snippet.slice(at, start), matched: false });
		segments.push({ text: snippet.slice(start, end), matched: true });
		at = end;
	}
	if (at < snippet.length)
		segments.push({ text: snippet.slice(at), matched: false });
	return segments;
};

/* ------------------------------------------------------------------- the copy */

/** The sheet's title: one word — the single-noun idiom of its sibling sheets
 *  (`model`, `effort`, `commands`) — for the desktop panel's same gesture.
 *  The desktop's full phrase ("Search this conversation") truncated to
 *  `Search this…` at 200 % on a 320 pt phone; a shorter title that renders
 *  whole is the fix (design D63-7). The scope the phrase carried is stated
 *  where it is a fact — the footer's "Searched N messages on this device" —
 *  not in a header that clips. */
export const FIND_TITLE = "search";
/** The field's visible label — never the placeholder alone (components.md §4). */
export const FIND_FIELD_LABEL = "Find a message";
export const FIND_FIELD_PLACEHOLDER = "Type a word or phrase";
/** What a soft hit's row says instead of a highlight (the desktop's D3 word). */
export const FIND_TIER_HINT = "related match";
/** The settled answer with no hits. */
export const FIND_EMPTY_COPY = "No messages match this search.";
/** The resting state, before the reader has typed. */
export const FIND_HINT_COPY = "Type to search the messages on this device.";

const messageWord = (count: number): string =>
	count === 1 ? "message" : "messages";

/** The count line, tier-aware the way the desktop's is: the soft tier is why a
 *  near-miss is here at all, so a bare count would hide it. */
export const findCountLabel = (hits: readonly FindHit[]): string => {
	const soft = hits.filter((hit) => hit.tier === "soft").length;
	const exact = hits.length - soft;
	if (soft === 0) return `${exact} ${exact === 1 ? "match" : "matches"}`;
	if (exact === 0) {
		return `${soft} related ${soft === 1 ? "match" : "matches"}`;
	}
	return `${exact} exact · ${soft} related`;
};

/** The cut's suffix when the list was truncated (the desktop's wording). */
export const findTruncatedLabel = (count: number): string =>
	count === 1 ? "(the first match shown)" : `(first ${count} shown)`;

/**
 * Move the active hit by `delta`, wrapping at both ends — the desktop find
 * bar's own convention (`threadSearchCursorMove`): `next` on the last hit
 * returns to the first, so an overshoot costs one more press rather than a
 * dead end. A cursor of `-1` (nothing landed on yet — a fresh query) resolves
 * to the first hit going forward and the last going back. With nothing to
 * point at the cursor stays `-1`, never `0`: "the first result" and "there is
 * no result" are different answers, and the bar's `n of m` must not get that
 * wrong.
 */
export const findCursorMove = (
	cursor: number,
	delta: 1 | -1,
	count: number,
): number => {
	if (count <= 0) return -1;
	const from = cursor < 0 || cursor >= count ? (delta > 0 ? -1 : 0) : cursor;
	return (((from + delta) % count) + count) % count;
};

/** Where the landed id sits in the CURRENT hits, or -1 when it is gone.
 *
 * The landing is resolved per render, never stored as a rank: the hits array
 * recomputes on every frame and the window slides under it, so a stored index
 * silently re-points at whatever message now occupies that rank — the bar's
 * `n of m`, the wash and the next step would all describe a message the reader
 * never landed on (reviewer MINOR-3). The id re-resolves to the same message
 * or clears. */
export const findActiveIndex = (
	hits: readonly FindHit[],
	activeId: string | null,
): number =>
	activeId === null ? -1 : hits.findIndex((hit) => hit.id === activeId);

const ROLE_LABELS: Record<FindRole, string> = {
	user: "You",
	agent: "Agent",
	parent: "Parent",
	subagent: "Subagent",
	peer: "Peer",
	notice: "Notice",
	compaction: "Compaction",
	ask: "Ask",
};

export const findRoleLabel = (role: FindRole): string => ROLE_LABELS[role];

/**
 * What the search could and could not cover, as the sentence(s) the footer
 * carries. The count is always known (it is the loaded set's own size); the
 * older-messages caveat fires unless a successful history read backs the
 * silence (`olderThanLoaded`, `runtime.ts` — proven rows beyond the window, a
 * read that failed, a read that never settled). Its wording says exactly that
 * much and no more: the search does not cover older messages, whether they
 * were seen to exist or could not be checked for — the longer "not loaded
 * here" sentence was not true for the failed read it must also describe, and
 * a shorter line is what 200 % type on a 320 pt phone needs (design D63-6).
 */
export const findScopeLines = (input: {
	messages: number;
	older: boolean;
}): string[] => {
	const lines = [
		`Searched ${input.messages} ${messageWord(input.messages)} on this device.`,
	];
	if (input.older) {
		lines.push("Older messages aren't searched.");
	}
	return lines;
};

/* -------------------------------------------------------------------- reveal */

/**
 * Where a hit lands in the transcript's plan: an item already on the list, or
 * the condensed turn whose collapse hides it (the reveal opens that turn
 * first — the desktop's expand-first walk). `null` for an id the plan does not
 * carry at all, which find never produces (hits come from the same frames) —
 * the arm exists so a frame that slid between the search and the press cannot
 * scroll to nowhere.
 */
export type RevealPlan =
	| { kind: "item"; index: number }
	| { kind: "turn"; turnKey: string }
	| null;

export const revealTarget = (plan: CondensePlan, id: string): RevealPlan => {
	const index = plan.items.findIndex(
		(item) => item.kind === "entry" && item.id === id,
	);
	if (index >= 0) return { kind: "item", index };
	for (const turn of plan.turns) {
		if (turn.hiddenIds.includes(id)) return { kind: "turn", turnKey: turn.key };
	}
	return null;
};
