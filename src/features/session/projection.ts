/**
 * The transcript's projection: wire entries in, render rows out.
 *
 * Everything the transcript decides about an entry lives here, as pure functions,
 * for the reason the rest of the app's logic is factored this way (see
 * `src/state/ui-store.ts`): the rules below were each learned from a measured
 * failure, and a rule that can only be exercised through a rendered screen is a
 * rule nobody can pin. No React, no React Native — so `vitest` runs them in Node.
 *
 * The thinnest-looking functions here are the ones with the most history:
 *
 *   - `toolDetailLines` exists because the fold emits `args` as an OBJECT as
 *     often as a string, and calling `.split()` on it threw a `TypeError` that
 *     unmounted the tree — read on the phone as "tap the row and the whole screen
 *     goes blank" (the web client's own comment).
 *   - `diffCounts` returns `null` rather than `{added: 0, removed: 0}` because the
 *     kit suppresses both counts at zero (`components.md` § 15); a caller that had
 *     to remember to test for zero would eventually render `+0 −0`.
 *   - `toolGlyph` reads `interrupted` as `warning`, not as the web client's
 *     `ink-dim`. The kit (§ 15) is the law here and the web client is only the
 *     behaviour reference: an interrupted tool is a state the reader must notice,
 *     and dim is the one role that says "ignore me".
 */

import type {
	SessionProjection,
	SubagentRow,
	TodoItem,
	TodoPhase,
	TodoStatus,
	ToolState,
	TranscriptEntry,
} from "@/contracts";
import { elapsedLabel } from "@/lib/format";
import { subagentChipId, transcriptRowId } from "@/ui/a11y";

/* ------------------------------------------------------------------ row kinds */

/**
 * The row treatments the transcript renders.
 *
 * Narrower than the wire's `EntryKind` on purpose: the wire type is open (an
 * unknown kind must not vanish), so this is the *closed* set the renderer
 * switches on, with `generic` as the terminal arm. A new wire kind therefore
 * renders as a labelled generic row until someone chooses a treatment, which is
 * the honest failure — dropping it would silently shorten the conversation.
 */
export type RowKind =
	| "user"
	| "steer"
	| "assistant"
	| "tool"
	| "notice"
	| "compaction"
	| "parent"
	| "subagent"
	| "peer"
	| "generic";

const KIND_MAP: Record<string, RowKind> = {
	user: "user",
	steer: "steer",
	assistant: "assistant",
	tool: "tool",
	notice: "notice",
	compaction: "compaction",
	parent_message: "parent",
	subagent_message: "subagent",
	peer_message: "peer",
};

export const classifyEntry = (entry: TranscriptEntry): RowKind =>
	KIND_MAP[entry.kind] ?? "generic";

/** Whether the row is one the reader wrote. Used for alignment, and for the one
 *  place the transcript puts a bubble around text. */
export const isOwnRow = (kind: RowKind): boolean => kind === "user";

/* ---------------------------------------------------------------- the tool row */

export interface ToolGlyph {
	/** A TEXT glyph, never an icon: `components.md` § 15 lists the eight
	 *  characters and the reason — they survive every system font. */
	glyph: string;
	/** The identity colour's class. */
	inkClass: string;
	/** The accent pulse, `lo-pulse` 1.2 s. Only a RUNNING call moves: a queued one
	 *  is announced but nothing is happening, so it keeps the dim glyph. */
	pulsing: boolean;
}

const GLYPHS: Record<ToolState, ToolGlyph> = {
	composing: { glyph: "⟳", inkClass: "text-ink-dim", pulsing: false },
	queued: { glyph: "⋯", inkClass: "text-ink-dim", pulsing: false },
	running: { glyph: "⟳", inkClass: "text-accent", pulsing: true },
	done: { glyph: "✓", inkClass: "text-success", pulsing: false },
	failed: { glyph: "✗", inkClass: "text-danger", pulsing: false },
	interrupted: { glyph: "–", inkClass: "text-warning", pulsing: false },
};

export const toolGlyph = (state: ToolState): ToolGlyph => GLYPHS[state];

/**
 * Tools whose expansion IS the diff.
 *
 * Their args are the whole new file, and the diff is that same content with line
 * marks, so showing both says one thing twice (`components.md` § 15). Kept as a
 * lower-cased set because the wire carries the tool's own name.
 */
const DIFF_FIRST_TOOLS: ReadonlySet<string> = new Set([
	"write",
	"edit",
	"apply_patch",
	"patch",
]);

export const isDiffFirstTool = (entry: TranscriptEntry): boolean =>
	DIFF_FIRST_TOOLS.has(entry.tool_name.toLowerCase()) &&
	entry.details.diff !== undefined;

/**
 * Normalise one `details` field to display lines.
 *
 * Three shapes arrive here and all three are legal: a string (`output`,
 * `partial`), an array of lines (the fold's `diff`), and a plain object (the
 * fold's `args`, one `key: value` per entry). The object arm is the one that has
 * crashed a shipped client, so it is handled explicitly rather than by a
 * `String(…)` fallback.
 */
export const toLines = (value: unknown): string[] => {
	if (value === null || value === undefined) return [];
	if (typeof value === "string") return value.split("\n");
	if (Array.isArray(value)) return value.map((line) => String(line));
	if (typeof value === "object") {
		// Deliberately no cast: `Object.entries` has an `object` overload, and the
		// values are re-narrowed on the next line. Asserting a `Record<string,
		// unknown>` here would be claiming to know the shape of a fold payload that
		// is already known to vary by tool.
		return Object.entries(value).map(
			([key, item]) =>
				`${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`,
		);
	}
	return [String(value)];
};

/** Which lines a tool row can expand to. Empty arrays mean "no block". */
export interface ToolDetailBlocks {
	args: string[];
	output: string[];
	diff: string[];
	/** False for the diff-first tools: their args are the diff. */
	showArgs: boolean;
}

export const toolDetailBlocks = (entry: TranscriptEntry): ToolDetailBlocks => {
	const showArgs = !isDiffFirstTool(entry);
	return {
		args: showArgs ? toLines(entry.details.args) : [],
		output: toLines(entry.details.output),
		diff: toLines(entry.details.diff),
		showArgs,
	};
};

/**
 * Whether the row has anything behind its disclosure.
 *
 * The disclosure chevron is rendered ONLY when this is true: a chevron that opens
 * an empty block is worse than no chevron, because the reader taps it and
 * concludes the app is broken rather than that the call had no output.
 */
export const hasToolDetails = (entry: TranscriptEntry): boolean => {
	const blocks = toolDetailBlocks(entry);
	return Boolean(
		entry.intent ||
			entry.error ||
			blocks.output.length > 0 ||
			blocks.diff.length > 0 ||
			blocks.args.length > 0,
	);
};

/** The diff's `+n −m`, or `null` when the kit says to suppress it. */
export const diffCounts = (
	entry: TranscriptEntry,
): { added: number; removed: number } | null => {
	if (entry.diff_added <= 0 && entry.diff_removed <= 0) return null;
	return { added: entry.diff_added, removed: entry.diff_removed };
};

/** The elapsed label, or `null` when the wire reports no measured duration.
 *  `0` is "not measured yet", not "took no time". */
export const toolElapsed = (entry: TranscriptEntry): string | null =>
	entry.elapsed_s > 0 ? elapsedLabel(entry.elapsed_s) : null;

export type DiffLineTone = "added" | "removed" | "hunk" | "plain";

/**
 * The tint for one diff line.
 *
 * The guards matter: a `+++`/`---` file header starts with the same character as
 * an added/removed line, so tinting on the first character alone paints headers
 * green and red and makes the block read as noise.
 */
export const diffLineTone = (line: string): DiffLineTone => {
	if (line.startsWith("@@")) return "hunk";
	if (line.startsWith("+++") || line.startsWith("---")) return "plain";
	if (line.startsWith("+")) return "added";
	if (line.startsWith("-")) return "removed";
	return "plain";
};

/* ------------------------------------------------------------------ the working line */

/**
 * The ONE in-progress indicator (`components.md` § 14).
 *
 * `activity` is the label the runtime folded server-side, so the phone never
 * invents a verb. An empty label means there is no working line at all — a row
 * with a spinner and no words is the "is it stuck?" state the label exists to
 * answer.
 */
export const workingLine = (
	projection: SessionProjection,
): { activity: string; startedS: number | null } | null =>
	projection.activity.length > 0
		? { activity: projection.activity, startedS: projection.activity_started_s }
		: null;

/* --------------------------------------------------------------- row identity */

/** The per-row anchor the Maestro flows address. */
export const transcriptRowTestID = (entry: TranscriptEntry): string =>
	transcriptRowId(entry.id);

/**
 * The row the streaming marker (`SURFACE.transcriptStreaming`) belongs to: the LAST
 * only while the turn is actually streaming.
 *
 * Both halves are load-bearing. Flow 04 waits for this id to appear and then
 * waits for it to disappear — a client that never settles leaves a shimmer on a
 * finished turn, and that is only visible if the flow can observe the absence.
 * So it is derived from `streaming` plus "is the tail", never from a per-row
 * `text_complete` flag: the tail is where new text lands, and the tail is what a
 * settled turn must stop marking.
 */
export const streamingRowId = (
	projection: SessionProjection,
): string | null => {
	if (!projection.streaming) return null;
	const tail = projection.transcript[projection.transcript.length - 1];
	return tail ? tail.id : null;
};

/* --------------------------------------------------------------------- todos */

export interface TodoRow {
	text: string;
	status: TodoStatus;
	reason: string;
	glyph: string;
	inkClass: string;
	/** Done and dropped rows are struck/quietened; blocked carries its reason. */
	struck: boolean;
}

/** The TUI's glyphs, so the two surfaces read the same list the same way. */
const TODO_GLYPHS: Record<TodoStatus, { glyph: string; inkClass: string }> = {
	pending: { glyph: "☐", inkClass: "text-ink" },
	done: { glyph: "☑", inkClass: "text-success" },
	blocked: { glyph: "~", inkClass: "text-warning" },
	dropped: { glyph: "-", inkClass: "text-ink-dim" },
};

/**
 * A phase that is its own header is the TUI's `_IMPLICIT_PHASE` rule: a single
 * phase named exactly this renders as a headerless flat list, and the string is
 * kept in sync with the TUI's or the two surfaces disagree about the same list.
 */
export const IMPLICIT_PHASE = "Todos";

export const todoRow = (item: TodoItem): TodoRow => {
	const tone = TODO_GLYPHS[item.status];
	return {
		text: item.text,
		status: item.status,
		reason: item.reason,
		glyph: tone.glyph,
		inkClass: tone.inkClass,
		// Dropped is the only struck state: a done item is quiet, not struck, and
		// striking it would say "cancelled" about work that finished.
		struck: item.status === "dropped",
	};
};

export interface TodoProjection {
	/** Phases in wire order, each with its rows already ordered. */
	phases: { name: string; headerless: boolean; rows: TodoRow[] }[];
	done: number;
	total: number;
	empty: boolean;
}

/** Open items first, then blocked, then done, then dropped — and stable within a
 *  group, because a list that reshuffles between repaints is unreadable. */
const TODO_ORDER: Record<TodoStatus, number> = {
	pending: 0,
	blocked: 1,
	done: 2,
	dropped: 3,
};

export const projectTodos = (todos: TodoPhase[]): TodoProjection => {
	let done = 0;
	let total = 0;
	const phases = todos.map((phase) => {
		for (const item of phase.items) {
			total += 1;
			if (item.status === "done") done += 1;
		}
		const rows = phase.items
			.map(todoRow)
			.sort((a, b) => TODO_ORDER[a.status] - TODO_ORDER[b.status]);
		return {
			name: phase.name,
			headerless: phase.name === IMPLICIT_PHASE,
			rows,
		};
	});
	return { phases, done, total, empty: total === 0 };
};

/* ------------------------------------------------------------------ subagents */

export interface SubagentRowView {
	jobId: string;
	label: string;
	status: SubagentRow["status"];
	glyph: string;
	inkClass: string;
	/** `agent · effort`, or whichever half exists. */
	metadata: string;
	/** `null` contributes nothing: a roster with no age shows no clock, never
	 *  `0s` (`components.md` § 17). */
	elapsed: string | null;
	/** Nesting depth, from the row's own ancestor list. Depth is carried by
	 *  INDENTATION, never by a card inside a card. */
	depth: number;
	testID: string;
}

const SUBAGENT_GLYPHS: Record<
	SubagentRow["status"],
	{ glyph: string; inkClass: string }
> = {
	queued: { glyph: "⋯", inkClass: "text-ink-dim" },
	running: { glyph: "⟳", inkClass: "text-accent" },
	completed: { glyph: "✓", inkClass: "text-success" },
	failed: { glyph: "✗", inkClass: "text-danger" },
	/* `‖` for parked, `–` for cancelled, both as the shipped web client draws
	 * them. The port had given both the same `–`, so the two end-states were
	 * indistinguishable — and `–` is the kit's INTERRUPTED glyph (§ 17), which is
	 * what a parked child is. Parity is the fix rather than a new codepoint: `‖`
	 * (U+2016) is already proven in the shipped client, and § 17's "survives every
	 * system font" rule is a rule about not adding characters lightly. */
	parked: { glyph: "‖", inkClass: "text-warning" },
	cancelled: { glyph: "–", inkClass: "text-ink-dim" },
};

/** Statuses that count as still working, for the `n/m running` header. */
const ACTIVE_STATUSES: ReadonlySet<SubagentRow["status"]> = new Set([
	"queued",
	"running",
]);

export const subagentRowView = (row: SubagentRow): SubagentRowView => {
	const tone = SUBAGENT_GLYPHS[row.status];
	const metadata = [row.agent, row.effort].filter((part) => part.length > 0);
	return {
		jobId: row.job_id,
		label: row.label,
		status: row.status,
		glyph: tone.glyph,
		inkClass: tone.inkClass,
		metadata: metadata.join(" · "),
		elapsed: row.elapsed_s === null ? null : elapsedLabel(row.elapsed_s),
		// The roster is flat with `ancestors` naming the chain; depth is its
		// length. Capped by the renderer rather than here, so the derivation stays
		// a statement about the wire.
		depth: row.ancestors.length,
		testID: subagentChipId(row.job_id),
	};
};

/**
 * The summary's vocabulary: one entry per WIRE status.
 *
 * Typed as a `Record<SubagentRow["status"], …>` for the reason the glyph table is:
 * a new status must fail typecheck here rather than vanish from the summary. The
 * previous shape — an `if` chain of counters plus six literals in the panel — did
 * exactly that: three of six states were missing, and the next enum change would
 * have been dropped the same way (design round 1 D3; review round 4 R9).
 */
const ROSTER_SUMMARY: Record<
	SubagentRow["status"],
	{
		word: string;
		inkClass: string /** The order a reader acts on, among equals. */;
		rank: number;
	}
> = {
	running: { word: "running", inkClass: "text-ink-muted", rank: 0 },
	queued: { word: "queued", inkClass: "text-ink-muted", rank: 1 },
	parked: { word: "parked", inkClass: "text-warning", rank: 2 },
	failed: { word: "failed", inkClass: "text-danger", rank: 3 },
	completed: { word: "done", inkClass: "text-ink-muted", rank: 4 },
	cancelled: { word: "cancelled", inkClass: "text-ink-muted", rank: 5 },
};

/** One clause of the panel's summary: a count and the word for its status. */
export interface SubagentClause {
	status: SubagentRow["status"];
	word: string;
	count: number;
	inkClass: string;
}

export interface SubagentProjection {
	rows: SubagentRowView[];
	running: number;
	total: number;
	empty: boolean;
	/** Every status that actually occurs, in the reader's order. Non-zero by
	 *  construction, so the renderer never filters its own formatted text. */
	clauses: SubagentClause[];
	/** `1 agent` / `6 agents`: the count is the roster's own word, and a summary
	 *  that reads "1 agents" is the kind of thing that makes a reader distrust the
	 *  numbers beside it (QA round 4, Q3). */
	totalLabel: string;
}

/**
 * The aggregate roster.
 *
 * Order is the wire's order — the daemon ranks its own children, and a client
 * that re-sorts them (by status, say) would move a running child out from under
 * the thumb that was about to tap it. The counts are the header's, and `failed`
 * is deliberately separate from `parked`: a parked child is waiting for a
 * decision, a failed one is not.
 */
export const projectSubagents = (
	subagents: SubagentRow[],
): SubagentProjection => {
	/* Counts keyed by the same table the words come from, so the two cannot drift:
	 * every status the wire can send has an entry, and the count for a status is
	 * whatever the rows say it is. */
	const counts = new Map<SubagentRow["status"], number>();
	for (const row of subagents) {
		counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
	}
	const clauses: SubagentClause[] = (
		Object.keys(ROSTER_SUMMARY) as SubagentRow["status"][]
	)
		.map((status) => ({
			status,
			count: counts.get(status) ?? 0,
			word: ROSTER_SUMMARY[status].word,
			inkClass: ROSTER_SUMMARY[status].inkClass,
			rank: ROSTER_SUMMARY[status].rank,
		}))
		.sort((left, right) => left.rank - right.rank)
		.filter((clause) => clause.count > 0)
		.map(({ status, count, word, inkClass }) => ({
			status,
			count,
			word,
			inkClass,
		}));
	const running = counts.get("running") ?? 0;
	return {
		rows: subagents.map(subagentRowView),
		// The header says "running", and a queued child is not running — but it IS
		// outstanding, and the panel collapses on `active` so a queued child keeps
		// the header legible rather than claiming the roster is idle.
		running,
		total: subagents.length,
		empty: subagents.length === 0,
		clauses,
		totalLabel: `${subagents.length} ${subagents.length === 1 ? "agent" : "agents"}`,
	};
};

export const subagentIsActive = (status: SubagentRow["status"]): boolean =>
	ACTIVE_STATUSES.has(status);

/* ---------------------------------------------------------------------- header */

/**
 * The header's name, truncated MIDDLE.
 *
 * `components.md` § F-6.1 asks for a middle truncation so the two ends — which
 * are the distinguishing parts of both a session name and a job id — survive. At
 * 200 % text the web client collapsed this to a single glyph (R14), so the
 * minimum is stated in characters and the renderer owes at least that many.
 */
export const MIN_HEADER_NAME_CHARS = 8;

export const middleTruncate = (value: string, max: number): string => {
	if (value.length <= max) return value;
	if (max <= 1) return "…";
	const keep = max - 1;
	const head = Math.ceil(keep / 2);
	const tail = keep - head;
	return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
};
