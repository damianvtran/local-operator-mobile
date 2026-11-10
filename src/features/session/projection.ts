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
	PeerSender,
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
	| "reasoning"
	| "tool"
	| "notice"
	| "compaction"
	| "parent"
	| "subagent"
	| "peer"
	/** A settled queued ask's record: `ask_response` (answered / late / declined)
	 *  or `ask_timeout` (the deadline). One treatment for both — the card
	 *  distinguishes them from `entry.kind` and their details, and the two share
	 *  the tool-row family's shape (a record, not a decision). */
	| "ask"
	| "generic";

const KIND_MAP: Record<string, RowKind> = {
	user: "user",
	steer: "steer",
	assistant: "assistant",
	reasoning: "reasoning",
	tool: "tool",
	notice: "notice",
	compaction: "compaction",
	parent_message: "parent",
	subagent_message: "subagent",
	peer_message: "peer",
	ask_response: "ask",
	ask_timeout: "ask",
};

export const classifyEntry = (entry: TranscriptEntry): RowKind =>
	KIND_MAP[entry.kind] ?? "generic";

/** Session state is model-facing harness metadata, not a conversation event.
 * The producer stamps `custom_type=session_state`; older projections carry the
 * same provenance in `details.custom_kind`. Never infer this from the body's
 * marker: a human or peer quoting [session-state] still owns those words.
 * Filter before condensing so hidden metadata contributes no rows or counts.
 * This is display-only: the received projection and durable history stay intact. */
export const visibleTranscriptEntries = (
	entries: readonly TranscriptEntry[],
): readonly TranscriptEntry[] => {
	const visible = (entry: TranscriptEntry) =>
		!(
			entry.kind === "notice" &&
			(entry.custom_type || entry.details.custom_kind) === "session_state"
		);
	return entries.every(visible) ? entries : entries.filter(visible);
};

/** Whether the row is one the reader wrote. Used for alignment, and for the one
 *  place the transcript puts a bubble around text. */
export const isOwnRow = (kind: RowKind): boolean => kind === "user";

/** The identity a peer receipt leads with: the sender's conversation name,
 *  its session id, or the shared fallback. ONE spelling for the receipt row
 *  (`transcript-row.tsx`) and the quiet group's sender summary
 *  (`turn-condensing.ts`), so a fold cannot disagree with the rows it stands
 *  for about who sent them. */
export const peerLabel = (sender: PeerSender | undefined): string =>
	sender?.conversation_name ?? sender?.session_id ?? "another session";

/** A legacy parent-looking row may be a launch/user request. Only producer
 * direction establishes hub continuation; body wording and IDs cannot do so. */
export const isHubReceipt = (entry: TranscriptEntry): boolean =>
	(entry.kind === "parent_message" || entry.kind === "subagent_message") &&
	(entry.details.direction === "to_child" ||
		entry.details.direction === "to_parent");

/** A typed Bridge receipt is incoming traffic, never a peer certificate. */
export const isBridgeReceipt = (entry: TranscriptEntry): boolean =>
	entry.kind === "notice" &&
	(entry.custom_type || entry.details.custom_kind) === "team_bridge_message";

/** Only receiver-projected display metadata names an incoming organization member. */
export function bridgeReceiptLabel(entry: TranscriptEntry): string {
	const receipt = entry.details.bridge_receipt;
	if (receipt?.v !== 1) return "Team Bridge";
	const name = receipt.sender?.name;
	return typeof name === "string"
		? [...name]
				.filter((char) => !isHubIdentityControl(char.codePointAt(0) ?? 0))
				.join("")
				.trim()
				.slice(0, 240) || "Team Bridge"
		: "Team Bridge";
}

/** Optional secondary facts on a typed Bridge receipt (channel/DM + attachment count)
 *  from receiver-projected display metadata, sanitized against control/bidi code points. */
export function bridgeReceiptMeta(entry: TranscriptEntry): string {
	const receipt = entry.details.bridge_receipt;
	if (receipt?.v !== 1) return "";
	const parts: string[] = [];
	const convName = receipt.conversation?.label;
	if (typeof convName === "string") {
		const clean = [...convName]
			.filter((char) => !isHubIdentityControl(char.codePointAt(0) ?? 0))
			.join("")
			.trim()
			.slice(0, 120);
		// Only channels read as `#name`; a group conversation keeps its label bare.
		if (clean) {
			parts.push(
				receipt.conversation?.kind === "channel" && !clean.startsWith("#")
					? `#${clean}`
					: clean,
			);
		}
	} else if (receipt.conversation?.kind === "dm") {
		parts.push("DM");
	}
	const attachments = receipt.attachment_count;
	if (
		typeof attachments === "number" &&
		Number.isFinite(attachments) &&
		attachments > 0
	) {
		const n = Math.floor(attachments);
		if (n > 0) parts.push(`${n} ${n === 1 ? "attachment" : "attachments"}`);
	}
	return parts.join(" · ");
}

/** Canonical identity for a transcript row across live (`tc-<call>`) and durable
 *  (`<msg>:<call>`) tool streams: when `tool_call_id` is present on a tool row,
 *  `call:<tool_call_id>` stays invariant across stream-to-history handoff so open
 *  disclosures and fold bars never reset or duplicate. */
export const canonicalRowKey = (
	entry: Pick<TranscriptEntry, "id" | "kind" | "tool_call_id">,
): string =>
	entry.kind === "tool" && entry.tool_call_id !== ""
		? `call:${entry.tool_call_id}`
		: entry.id;

/** Display identity rejects control/bidi code points, never authored body.
 * Numeric ranges make that boundary explicit without a regex whose embedded
 * control escapes violate the pinned linter's source-safety rule. */
const isHubIdentityControl = (point: number): boolean =>
	point <= 0x1f ||
	(point >= 0x7f && point <= 0x9f) ||
	(point >= 0x200b && point <= 0x200f) ||
	(point >= 0x202a && point <= 0x202e) ||
	(point >= 0x2060 && point <= 0x206f);
const HUB_IDENTITY_SPACE = /\s+/g;

/** Same advisory label in the row and group; no manufactured parent/session ID. */
export function hubLabel(
	entry: Pick<TranscriptEntry, "kind" | "details">,
): string {
	for (const field of [
		entry.details.label,
		entry.details.job_id,
		entry.details.sender?.conversation_name,
		entry.details.sender?.session_id,
	]) {
		if (typeof field !== "string") continue;
		const value = field
			.split("")
			.filter((character) => !isHubIdentityControl(character.charCodeAt(0)))
			.join("")
			.replace(HUB_IDENTITY_SPACE, " ")
			.trim()
			.slice(0, 120);
		if (value) return value;
	}
	return entry.kind === "parent_message" ? "Parent" : "Subagent";
}

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

const MCP_PREFIX = "mcp__";

/**
 * A tool's display name: strips the `mcp__<server>__` / `mcp__<server>_` prefix
 * so narrow phone rows show the actual call identifier (`query_metrics`) rather
 * than repeating `mcp__` across every server call. Matches desktop & relay
 * `displayName` (`tool-row-model.ts` / `condense-predicates.ts`) so `FoldBar`
 * count keys agree across surfaces.
 */
export function displayToolName(toolName: string): string {
	const name = toolName.trim();
	if (!name.toLowerCase().startsWith(MCP_PREFIX)) return name;
	const rest = name.slice(MCP_PREFIX.length);
	const doubleSplit = rest.indexOf("__");
	if (doubleSplit > 0) {
		return rest.slice(doubleSplit + 2) || rest;
	}
	const split = rest.indexOf("_");
	if (split <= 0) return rest || name;
	return rest.slice(split + 1) || rest;
}

/** Whether a raw summary adds nothing to the name column (`todo  todo` stutter). */
export function isBareToolName(summary: string, toolName: string): boolean {
	const s = summary.trim();
	const raw = toolName.trim();
	return (
		s.length === 0 ||
		s === raw ||
		s === displayToolName(raw) ||
		s.toLowerCase() === raw.toLowerCase() ||
		s.toLowerCase() === displayToolName(raw).toLowerCase()
	);
}

const PYTHON_REPR_SUMMARY =
	/^\s*[a-zA-Z_]\w*\s*=\s*(?:['"`[\]{]|True\b|False\b|None\b|-?\d)/;
const QUOTED_INTENT_REPR =
	/^(?:.*,\s*)?i\s*=\s*(?:'([^']*)'|"([^"]*)")(?:\s*,.*)?$/;

function firstCleanLine(value: unknown, skipComments = false): string {
	if (typeof value !== "string") return "";
	for (const raw of value.split("\n")) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		if (skipComments && trimmed.startsWith("#")) continue;
		return trimmed;
	}
	return "";
}

function scalarArg(value: unknown): string {
	if (typeof value === "string") return firstCleanLine(value);
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return "";
}

/** Derive a clean, human-readable one-line summary from structured `args`. */
export function summaryFromToolArgs(
	toolName: string,
	args: Record<string, unknown> | null | undefined,
): string {
	if (!args) return "";
	const name = displayToolName(toolName).toLowerCase();
	const intent = firstCleanLine(args.i);

	if (name === "read" || name === "edit" || name === "write") {
		const path = scalarArg(args.path ?? args.file_path);
		const range = scalarArg(args.range);
		if (path) return range ? `${path}:${range}` : path;
		if (intent) return intent;
	}
	if (name === "grep" || name === "glob") {
		const pattern = scalarArg(args.pattern);
		const path = scalarArg(args.path);
		if (pattern && path && path !== ".") return `${pattern} ${path}`;
		if (pattern) return pattern;
		if (intent) return intent;
	}
	if (name === "bash" || name === "exec" || name === "shell") {
		if (intent) return intent;
		const cmd = firstCleanLine(args.command ?? args.cmd);
		if (cmd) return cmd;
	}
	if (name === "eval") {
		if (intent) return intent;
		const code = firstCleanLine(args.code, true);
		if (code) return code;
	}
	if (name === "task" || name === "delegate") {
		if (Array.isArray(args.tasks) && args.tasks.length > 0) {
			return `${args.tasks.length} ${args.tasks.length === 1 ? "task" : "tasks"}`;
		}
		const label = scalarArg(args.label);
		const agent = scalarArg(args.agent);
		if (label && agent && label !== agent) return `${agent} · ${label}`;
		if (label) return label;
		if (agent) return agent;
		if (intent) return intent;
	}
	if (name === "wait") {
		const jobId = args.job_id;
		if (Array.isArray(jobId) && jobId.length > 0) {
			const ids = jobId.map(scalarArg).filter(Boolean);
			if (ids.length > 0) return ids.join(", ");
		}
		const single = scalarArg(jobId);
		if (single) return single;
		if (intent) return intent;
	}
	if (name === "hub") {
		const op = scalarArg(args.op);
		const to = scalarArg(args.to ?? args.job_id);
		if (op && to) return `${op} · ${to}`;
		if (op) return op;
		const msg = firstCleanLine(args.message);
		if (msg) return msg;
		if (intent) return intent;
	}
	if (name === "todo") {
		const op = scalarArg(args.op);
		const phase = scalarArg(args.phase);
		if (op && phase) return `${op} · ${phase}`;
		if (op) return op;
		if (intent) return intent;
	}
	if (name === "ask") {
		if (Array.isArray(args.questions) && args.questions.length > 0) {
			const first = args.questions[0];
			if (first && typeof first === "object") {
				const q = firstCleanLine((first as Record<string, unknown>).question);
				if (q) return q;
			}
		}
		const q = firstCleanLine(args.question);
		if (q) return q;
		if (intent) return intent;
	}
	if (
		name === "web_search" ||
		name === "search_the_web" ||
		name === "web_fetch" ||
		name === "fetch_url"
	) {
		const target = scalarArg(args.query ?? args.url);
		if (target) return target;
		if (intent) return intent;
	}

	if (intent) return intent;

	const op = scalarArg(args.op ?? args.action ?? args.method);
	const subjectKeys = [
		"name",
		"path",
		"url",
		"query",
		"pattern",
		"target",
		"session",
		"key",
		"job_id",
		"id",
	];
	const subjects = subjectKeys
		.map((key) => scalarArg(args[key]))
		.filter(Boolean);
	if (op && subjects.length > 0) return `${op} ${subjects[0]}`;
	if (subjects.length > 0) return subjects.slice(0, 2).join(" ");
	if (op) return op;

	const fallback = Object.entries(args)
		.filter(([key]) => key !== "i")
		.map(([, val]) => scalarArg(val))
		.filter(Boolean);
	return fallback.slice(0, 2).join(" ");
}

/**
 * Clean one-line summary for a tool row: suppresses duplicate bare tool names
 * (`todo  todo`) and replaces raw Python-repr strings (`i='Checking...'`,
 * `op='list'`) with structured human-readable summaries derived from `args`.
 */
export function toolRowSummary(
	entry: Pick<TranscriptEntry, "tool_name" | "summary" | "intent" | "details">,
): string {
	const raw = entry.summary.trim();
	const rawArgs = entry.details.args;
	const argsObj =
		rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs)
			? (rawArgs as Record<string, unknown>)
			: null;

	const bare = isBareToolName(raw, entry.tool_name);
	const isRepr = PYTHON_REPR_SUMMARY.test(raw);

	if (!bare && !isRepr) return raw;

	const derived = summaryFromToolArgs(entry.tool_name, argsObj);
	if (derived) return derived;

	if (isRepr) {
		const intentMatch = QUOTED_INTENT_REPR.exec(raw);
		const extracted = (intentMatch?.[1] ?? intentMatch?.[2] ?? "").trim();
		if (extracted) return extracted;
	}

	const intentFallback = entry.intent.trim();
	if (intentFallback && !isBareToolName(intentFallback, entry.tool_name)) {
		return intentFallback;
	}

	return bare ? "" : raw;
}

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

const MAX_SERIALIZED_LINE_CHARS = 400;

function formatStructuredValue(item: unknown): string {
	if (typeof item === "string") return item;
	if (item === null || item === undefined) return String(item);
	if (typeof item === "number" || typeof item === "boolean")
		return String(item);
	try {
		const json = JSON.stringify(item);
		if (typeof json === "string") {
			return json.length > MAX_SERIALIZED_LINE_CHARS
				? `${json.slice(0, MAX_SERIALIZED_LINE_CHARS - 1)}…`
				: json;
		}
	} catch {
		// Circular or non-serializable value falls back safely below.
	}
	return "[unserializable]";
}

/**
 * Normalise one `details` field to display lines.
 *
 * Three shapes arrive here and all three are legal: a string (`output`,
 * `partial`), an array of lines or structured items (the fold's `diff` or an
 * array-typed payload), and a plain object (the fold's `args`, one `key: value`
 * per entry). Nested objects inside arrays serialize cleanly via JSON instead
 * of `[object Object]`, and excessively wide values cap safely.
 */
export const toLines = (value: unknown): string[] => {
	if (value === null || value === undefined) return [];
	if (typeof value === "string") return value.split("\n");
	if (Array.isArray(value)) {
		return value.map((line) => formatStructuredValue(line));
	}
	if (typeof value === "object") {
		return Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.map(([key, item]) => `${key}: ${formatStructuredValue(item)}`);
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

/**
 * Whether a turn is running, for EVERY surface that acts on it: the header's
 * "Working" rung, the composer's steer/send op and the Stop control.
 *
 * ONE predicate because two drifted: the header read `activity` and the
 * composer read `streaming`, so a frame carrying a working label with
 * `streaming: false` (a reconcile on attach or at a command boundary can lower
 * `streaming` without touching `activity`) said "Working" while the composer
 * minted a `prompt`. A prompt into a busy runtime is not refused quickly: the
 * serving owner makes it wait out the turn, the daemon answers `504 session did
 * not answer` after its 15 s ack budget, and the reader saw a failed send for a
 * session the header said was working (TestFlight 578).
 *
 * Either fact counts, deliberately biased toward steer: a steer into an idle
 * runtime is ADMITTED and drives a turn (measured on the 0.101.12 daemon:
 * `steering queued`, then a run), whereas a prompt into a busy one hangs. The
 * relay SPA reads `streaming` alone for the same three surfaces; this is a
 * superset of it, never a contradiction.
 */
export const turnRunning = (
	projection: Pick<SessionProjection, "streaming" | "activity">,
): boolean => projection.streaming || projection.activity.length > 0;

/**
 * The PINNED working line above the dock (the relay's `session-view.tsx` mount of
 * `WorkingLine` with `stopPid`): present for exactly as long as a turn is alive.
 *
 * Gated on `turnRunning`, not on the label alone, because this instance carries
 * the turn's Stop, and "a turn is alive" is the condition that must always have
 * its Stop in reach — the relay draws the line before a label exists for that
 * reason (`working-line.tsx`: `if (!activity && !stopPid) return null`). The
 * label may therefore be `""` (spinner, clock and Stop, no words); the clock
 * follows the same `null`-withholds rule as `workingLine`.
 *
 * NOT `streaming` alone: a reconcile can lower `streaming` while the label still
 * reads `Reading`, and in that frame the header says Working and the composer
 * steers (both read `turnRunning`), so the line and its Stop must show too —
 * one predicate across header, composer and line, or they disagree on screen.
 */
export const pinnedWorkingLine = (
	projection: Pick<
		SessionProjection,
		"streaming" | "activity" | "activity_started_s"
	>,
): { activity: string; startedS: number | null } | null =>
	turnRunning(projection)
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
