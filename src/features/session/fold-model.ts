/**
 * Tier A — Tool & Receipt Run Folding (`FoldBar` model), ported from the
 * desktop (`trace-fold-model.ts`) and mobile relay (`condense-fold.ts`,
 * `condense-copy.ts`).
 *
 * WHY TIER A EXISTS ALONGSIDE TIER B (`TurnBar`).
 * Completed-turn condensing (`TurnBar`) collapses an entire finished turn's
 * middle work into one summary bar, leaving the opening user prompt and the
 * closing answer on screen. Two surfaces remain un-condensed by design:
 *   1. the ACTIVE (live) turn while it is still streaming or executing tools;
 *   2. an EXPANDED completed turn after the reader taps its `TurnBar` open.
 *
 * Without Tier A, a 25-call research run in either surface renders 25 separate
 * `44-48 pt` tool rows (~1,150 pt of vertical scroll). Tier A folds any maximal
 * same-turn run of `>= 3` foldable tool calls (`FOLD_MIN_ACTIONS = 3`) OR a
 * trailing stretch of `>= 2` internal receipts (`FOLD_MIN_RECEIPTS = 2`) into a
 * compact borderless `FoldBar`.
 *
 * EXCLUSIONS — NEVER FOLDED INTO `FoldBar`:
 *   - `no_reply` (quiet-turn close call, not user-meaningful work);
 *   - media-artifact generation tools (`generate_image`, `generate_video`,
 *     `generate_voiceover`, `generate_sound_effect`) and any tool row carrying
 *     inline `images` or `videos` — their visible media cards must remain on
 *     screen without an extra tap;
 *   - error/warning notices, user prompts/steers, assistant prose, compactions,
 *     and settled `ask` records — all break a run so chronology stays exact.
 *
 * CANONICAL IDENTITY & LIVE LATCH:
 *   - Every tool row is keyed by `canonicalRowKey(entry)` (`call:<tool_call_id>`
 *     when `tool_call_id` is present), so a `FoldBar` (`fold:<canonicalKey>`)
 *     never resets its open state or duplicates when durable history (`<msg>:<call>`)
 *     replaces a live stream row (`tc-<call>`).
 *   - While a turn is live (`liveTurn === true`), `latchFoldedRuns` remembers
 *     canonical ids already shown inside a `FoldBar` so an arriving receipt or
 *     interleaved call never dissolves and re-closes a fold in front of the reader.
 */

import type { TranscriptEntry } from "@/contracts";
import { bridgeRowOf } from "@/features/session/bridge-row";
import {
	isPartialDelivery,
	sendDeliveryStateOf,
} from "@/features/session/delivery";
import {
	canonicalRowKey,
	displayToolName,
	isBridgeReceipt,
	isHubReceipt,
	toolElapsed,
	toolRowSummary,
} from "@/features/session/projection";
import { t } from "@/i18n";

export const FOLD_MIN_ACTIONS = 3;
export const FOLD_MIN_RECEIPTS = 2;
export const FOLD_COUNT_LIMIT = 5;

/** Media-artifact tools that render visible cards/players and never fold into a run. */
export const MEDIA_ARTIFACT_TOOLS: ReadonlySet<string> = new Set([
	"generate_image",
	"generate_video",
	"generate_voiceover",
	"generate_sound_effect",
]);

export type InternalReceiptFamily =
	| "incoming"
	| "job_result"
	| "wake"
	| "monitor_prompt";

/** Classify a `TranscriptEntry` into its internal receipt family, or `null` if it
 *  is not an internal receipt (e.g. generic notice, error incident, prose). */
export function entryReceiptFamily(
	entry: TranscriptEntry,
): InternalReceiptFamily | null {
	if (entry.images.length > 0 || (entry.videos?.length ?? 0) > 0) return null;
	if (entry.kind === "peer_message") return "incoming";
	if (isHubReceipt(entry) || isBridgeReceipt(entry)) return "incoming";
	if (entry.kind !== "notice") return null;
	if (
		entry.details.severity === "error" ||
		entry.details.severity === "warning"
	) {
		return null;
	}
	const customType = entry.custom_type || entry.details.custom_kind || "";
	if (customType === "wake_prompt" || entry.details.notice_kind === "wake") {
		return "wake";
	}
	if (customType === "job_result") return "job_result";
	if (customType === "monitor_prompt") return "monitor_prompt";
	if (customType === "hub_message" || customType === "team_bridge_message") {
		return "incoming";
	}
	return null;
}

export function isFoldReceiptEntry(entry: TranscriptEntry): boolean {
	return entryReceiptFamily(entry) !== null;
}

/** True when a tool row is `no_reply` (quiet-turn signal, never counted as an action). */
export function isQuietTurnTool(entry: TranscriptEntry): boolean {
	return (
		entry.kind === "tool" && entry.tool_name.trim().toLowerCase() === "no_reply"
	);
}

/** True when a tool row owns a media artifact or generation card that must stay visible. */
export function isMediaArtifactTool(entry: TranscriptEntry): boolean {
	if (entry.kind !== "tool") return false;
	if (entry.images.length > 0 || (entry.videos?.length ?? 0) > 0) return true;
	const normalized = displayToolName(entry.tool_name).toLowerCase();
	return (
		MEDIA_ARTIFACT_TOOLS.has(entry.tool_name.trim().toLowerCase()) ||
		MEDIA_ARTIFACT_TOOLS.has(normalized)
	);
}

/** True when `entry` is a foldable tool call eligible for `FoldBar` grouping. */
export function isFoldableToolEntry(entry: TranscriptEntry): boolean {
	if (entry.kind !== "tool") return false;
	if (isQuietTurnTool(entry)) return false;
	if (isMediaArtifactTool(entry)) return false;
	return true;
}

/** True when a tool call genuinely failed (excludes interrupted calls and partial mailbox sends). */
export function isFailedToolEntry(entry: TranscriptEntry): boolean {
	if (entry.kind !== "tool") return false;
	// A Bridge `refused` outcome is a failure even if an older relay stamped the
	// row `done`; read through `bridgeRowOf`, which narrows the untyped wire field.
	if (bridgeRowOf(entry)?.outcome === "refused") return true;
	if (entry.tool_state !== "failed") return false;
	const delivery = sendDeliveryStateOf(entry);
	return !isPartialDelivery(delivery);
}

export function actionClass(
	name: string,
): "files" | "searches" | "commands" | "edits" | "web" | "delegated" | null {
	const n = name.toLowerCase();
	if (
		n === "read" ||
		n === "grep" ||
		n === "glob" ||
		n === "ls" ||
		n === "list"
	) {
		return "files";
	}
	if (n === "search_the_web" || n === "web_search" || n === "search") {
		return "web";
	}
	if (n === "bash" || n === "exec" || n === "shell" || n === "run") {
		return "commands";
	}
	if (n === "edit" || n === "write" || n === "multiedit") return "edits";
	if (n === "task" || n === "delegate") return "delegated";
	if (n === "fetch" || n === "web_fetch" || n === "fetch_url") {
		return "searches";
	}
	return null;
}

const KIND_NOUNS: Record<string, { noun: string; plural: string }> = {
	agent: { noun: "agent", plural: "agents" },
	team: { noun: "team", plural: "teams" },
	team_delete: { noun: "team deletion", plural: "team deletions" },
	hub: { noun: "subagent", plural: "subagents" },
	secret: { noun: "secret", plural: "secrets" },
	project: { noun: "project", plural: "projects" },
	project_delete: { noun: "project deletion", plural: "project deletions" },
	wake: { noun: "wake", plural: "wakes" },
	jobs: { noun: "job check", plural: "job checks" },
	console: { noun: "console", plural: "consoles" },
	network: { noun: "network call", plural: "network calls" },
	browser: { noun: "browser action", plural: "browser actions" },
	todo: { noun: "todo update", plural: "todo updates" },
	send: { noun: "message", plural: "messages" },
	ask: { noun: "question", plural: "questions" },
	wait: { noun: "wait", plural: "waits" },
	lsp: { noun: "code lookup", plural: "code lookups" },
	web_read: { noun: "page", plural: "pages" },
	list_variables: { noun: "variable lookup", plural: "variable lookups" },
	read_variable: { noun: "variable read", plural: "variable reads" },
	sessions: { noun: "session", plural: "sessions" },
};

export interface FoldableAction {
	canonicalId: string;
	name: string;
	displayName: string;
	summary: string;
	op: string;
	failed: boolean;
	/** Unsettled (`composing` | `queued` | `running`). */
	running: boolean;
	/** Actively executing (`tool_state === "running"`). */
	executing: boolean;
	elapsed: string | null;
	durationS: number;
}

export interface FoldCountSegment {
	key: string;
	label: string;
	count: number;
}

function extractToolOp(entry: TranscriptEntry): string {
	const raw = entry.details.args;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
	const op = (raw as Record<string, unknown>).op;
	return typeof op === "string" ? op.trim().toLowerCase() : "";
}

export function toFoldableAction(entry: TranscriptEntry): FoldableAction {
	const disp = displayToolName(entry.tool_name);
	const settled =
		entry.tool_state === "done" ||
		entry.tool_state === "failed" ||
		entry.tool_state === "interrupted";
	return {
		canonicalId: canonicalRowKey(entry),
		name: disp,
		displayName: disp,
		summary: toolRowSummary(entry),
		op: extractToolOp(entry),
		failed: isFailedToolEntry(entry),
		running: !settled,
		executing: entry.tool_state === "running",
		elapsed: toolElapsed(entry),
		durationS: Math.max(0, entry.elapsed_s),
	};
}

export function foldCountSegments(
	actions: readonly FoldableAction[],
): FoldCountSegment[] {
	type Kind = { noun: string; plural: string | null };
	const counts = new Map<string, { kind: Kind; count: number }>();
	const bump = (key: string, kind: Kind) => {
		const seen = counts.get(key);
		if (seen) seen.count += 1;
		else counts.set(key, { kind, count: 1 });
	};
	for (const action of actions) {
		const n = action.name.toLowerCase();
		if (n === "bash" || n === "exec" || n === "shell" || n === "run") {
			bump("kind:shell", { noun: "shell", plural: null });
			continue;
		}
		if (n === "eval") {
			bump("kind:python", { noun: "python", plural: null });
			continue;
		}
		const cls = actionClass(action.name);
		if (cls === "files") bump("class:files", { noun: "file", plural: "files" });
		else if (cls === "searches") {
			bump("class:searches", { noun: "search", plural: "searches" });
		} else if (cls === "web") {
			bump("class:web", { noun: "web search", plural: "web searches" });
		} else if (cls === "edits") {
			bump("class:edits", { noun: "edit", plural: "edits" });
		} else if (cls === "delegated") {
			bump("class:delegated", { noun: "task", plural: "tasks" });
		} else if (n === "todo") {
			if (action.op === "view") {
				bump("kind:todo:view", { noun: "todo read", plural: "todo reads" });
			} else {
				bump("kind:todo", KIND_NOUNS.todo ?? { noun: "todo", plural: "todos" });
			}
		} else if (n === "jobs") {
			if (action.op === "cancel") {
				bump("kind:jobs:cancel", {
					noun: "job cancellation",
					plural: "job cancellations",
				});
			} else {
				bump(
					"kind:jobs",
					KIND_NOUNS.jobs ?? { noun: "job check", plural: "job checks" },
				);
			}
		} else {
			const noun = KIND_NOUNS[n];
			if (noun) bump(`kind:${n}`, noun);
			else {
				const name = displayToolName(action.name);
				bump(`name:${name}`, { noun: name, plural: null });
			}
		}
	}

	const order = [
		"class:files",
		"class:searches",
		"class:web",
		"kind:shell",
		"kind:python",
		"class:edits",
		"class:delegated",
		"kind:agent",
		"kind:team",
		"kind:hub",
	];
	const segments: FoldCountSegment[] = [];
	const fact = (count: number, kind: Kind) =>
		`${count} ${count === 1 || kind.plural === null ? kind.noun : kind.plural}`;
	for (const key of order) {
		const seen = counts.get(key);
		if (seen) {
			segments.push({
				key,
				label: fact(seen.count, seen.kind),
				count: seen.count,
			});
		}
	}
	const rest = [...counts.entries()]
		.filter(([key]) => !order.includes(key))
		.sort(
			([, a], [, b]) =>
				b.count - a.count || a.kind.noun.localeCompare(b.kind.noun),
		);
	for (const [key, seen] of rest) {
		segments.push({
			key,
			label: fact(seen.count, seen.kind),
			count: seen.count,
		});
	}
	return segments;
}

const CLASS_KIND: Readonly<Record<string, string>> = {
	"class:files": "files",
	"class:searches": "searches",
	"class:web": "web",
	"class:edits": "edits",
	"class:delegated": "tasks",
	"kind:shell": "shell",
	"kind:python": "python",
};

/** Localized unit for a structured `FoldCountSegment` via `relay.transcript.fold.*`. */
export function foldSegmentUnit(segment: FoldCountSegment): string {
	if (segment.key === "kind:shell") {
		return t("relay.transcript.fold.shell", { count: segment.count });
	}
	if (segment.key === "kind:python") {
		return t("relay.transcript.fold.python", { count: segment.count });
	}
	if (!(segment.key in CLASS_KIND) && !segment.key.startsWith("name:")) {
		return segment.label;
	}
	const kind = CLASS_KIND[segment.key] ?? "other";
	return t("relay.transcript.fold.unit", {
		kind,
		count: segment.count,
		name: segment.key.startsWith("name:")
			? segment.key.slice(5)
			: segment.label,
	});
}

/** Apply the 5-unit display cap (`FOLD_COUNT_LIMIT = 5`), rolling any remainder into
 *  localized `relay.transcript.fold.more` (`and N other actions`). */
export function localizedFoldUnits(
	segments: readonly FoldCountSegment[],
): string[] {
	if (segments.length <= FOLD_COUNT_LIMIT) {
		return segments.map(foldSegmentUnit);
	}
	const kept = segments.slice(0, FOLD_COUNT_LIMIT).map(foldSegmentUnit);
	const other = segments
		.slice(FOLD_COUNT_LIMIT)
		.reduce((sum, segment) => sum + segment.count, 0);
	return [...kept, t("relay.transcript.fold.more", { count: other })];
}

/** Localized receipt units for folded internal receipts (`incoming`, `wakes`, `other`). */
export function localizedReceiptUnits(
	receiptEntries: readonly TranscriptEntry[],
): string[] {
	let incoming = 0;
	let wakes = 0;
	let jobs = 0;
	let monitors = 0;
	let other = 0;
	let replyRequested = false;
	let steered = false;
	for (const entry of receiptEntries) {
		const family = entryReceiptFamily(entry);
		if (family === "incoming") incoming += 1;
		else if (family === "wake") wakes += 1;
		else if (family === "job_result") jobs += 1;
		else if (family === "monitor_prompt") monitors += 1;
		else other += 1;
		if (isHubReceipt(entry)) {
			if (entry.details.expects_reply === true) replyRequested = true;
			if (entry.details.steer === true) steered = true;
		}
	}
	const units: string[] = [];
	if (incoming > 0) {
		units.push(
			t("relay.transcript.fold.unit", {
				kind: "incoming",
				count: incoming,
				name: "",
			}),
		);
	}
	if (jobs > 0) {
		units.push(
			jobs === 1
				? t("relay.transcript.label.job")
				: t("relay.transcript.fold.unit", {
						kind: "other",
						count: jobs,
						name: "job results",
					}),
		);
	}
	if (wakes > 0) {
		units.push(
			t("relay.transcript.fold.unit", {
				kind: "wakes",
				count: wakes,
				name: "",
			}),
		);
	}
	if (monitors > 0) {
		units.push(
			t("relay.transcript.fold.unit", {
				kind: "other",
				count: monitors,
				name: monitors === 1 ? "monitor prompt" : "monitor prompts",
			}),
		);
	}
	if (other > 0) {
		units.push(
			t("relay.transcript.fold.unit", {
				kind: "other",
				count: other,
				name: other === 1 ? "receipt" : "receipts",
			}),
		);
	}
	if (replyRequested) units.push("Reply requested");
	if (steered) units.push(t("relay.transcript.label.steered"));
	return units;
}

/** Alias kept for the Tier B bar's failure tally: one predicate decides "failed"
 *  for both tiers so a `FoldBar` and the `TurnBar` that later subsumes it can
 *  never disagree about how many calls errored. */
export const isToolActionFailed = isFailedToolEntry;

/** The settled bar's visible units: action classes first (capped), then the
 *  receipt families folded alongside them — calls are the work, receipts are
 *  what arrived while it ran. */
export function foldSettledUnits(
	segments: readonly FoldCountSegment[],
	receiptEntries: readonly TranscriptEntry[],
): string[] {
	return [
		...localizedFoldUnits(segments),
		...localizedReceiptUnits(receiptEntries),
	];
}

/** `N actions` for the live bar's second line (and the empty-units fallback). */
export function foldActionCountLabel(count: number): string {
	return localizedActionCount(count);
}

/** The fold bar's accessible name. A screen reader landing on a closed bar must
 *  hear what it stands for (units), whether anything failed, and — while live —
 *  which call is running, since the pulsing glyph and ink carry none of that.
 *  Open/closed rides `accessibilityState`, never this string. */
export function foldBarAccessibleName(fold: FoldRun): string {
	const units = foldSettledUnits(fold.countSegments, fold.receiptEntries);
	const parts: string[] = [
		units.length > 0
			? units.join(", ")
			: foldActionCountLabel(fold.actions.length),
	];
	if (fold.running && fold.liveAction !== null) {
		parts.push(
			[fold.liveAction.displayName, fold.liveAction.summary]
				.filter((part) => part.length > 0)
				.join(" "),
		);
	}
	if (fold.failedCount > 0) parts.push(t("relay.transcript.fold.failed_label"));
	return parts.join(", ");
}

/** Localized `N actions` phrase via `relay.transcript.turn.actions`. */
export function localizedActionCount(count: number, partial = false): string {
	return t("relay.transcript.turn.actions", {
		count,
		label: `${count}${partial ? "+" : ""}`,
	});
}

export interface FoldLiveAction {
	displayName: string;
	summary: string;
	elapsed: string | null;
}

export interface FoldRun {
	/** Stable key `fold:<first canonical row key>`. */
	key: string;
	/** Canonical row keys (`call:<tool_call_id>` or `entry.id`) for latch stability. */
	canonicalIds: readonly string[];
	/** Wire entry ids (`entry.id`) for `revealTarget` / find / height cache lookups. */
	rowIds: readonly string[];
	actions: readonly FoldableAction[];
	receiptEntries: readonly TranscriptEntry[];
	countSegments: readonly FoldCountSegment[];
	failedCount: number;
	/** True while ANY member tool action is unsettled (`composing` | `queued` | `running`). */
	running: boolean;
	/** Newest actively executing (`tool_state === "running"`) action, or newest unsettled fallback. */
	liveAction: FoldLiveAction | null;
	/** Summed tool seconds across settled actions when >= 1s, else null. */
	durationS: number | null;
}

export function trailingReceiptStretch<T>(
	rows: readonly T[],
	isReceipt: (row: T) => boolean,
): number {
	let stretch = 0;
	for (let index = rows.length - 1; index >= 0; index -= 1) {
		const row = rows[index];
		if (row === undefined || !isReceipt(row)) break;
		stretch += 1;
	}
	return stretch;
}

/** Pick the live action to highlight on a closed running `FoldBar`:
 *  newest `executing` (`tool_state === "running"`) call wins; if calls are queued/composing
 *  between executions, `running` stays true on `FoldRun` while `liveAction` names the
 *  newest unsettled call only if it has a displayable name. */
export function pickFoldLiveAction(
	actions: readonly FoldableAction[],
): FoldLiveAction | null {
	for (let index = actions.length - 1; index >= 0; index -= 1) {
		const action = actions[index];
		if (action?.executing) {
			return {
				displayName: action.displayName,
				summary: action.summary,
				elapsed: action.elapsed,
			};
		}
	}
	for (let index = actions.length - 1; index >= 0; index -= 1) {
		const action = actions[index];
		if (action?.running && action.displayName) {
			return {
				displayName: action.displayName,
				summary: action.summary,
				elapsed: action.elapsed,
			};
		}
	}
	return null;
}

/** Build a `FoldRun` from a candidate stretch of entries, or `null` when neither
 *  threshold (`>= 3` actions or `>= 2` trailing receipts) nor the live latch licenses it. */
export function buildFoldRun(
	entries: readonly TranscriptEntry[],
	options: {
		liveTurn?: boolean;
		latchedFoldIds?: ReadonlySet<string>;
	} = {},
): FoldRun | null {
	if (entries.length === 0) return null;
	const first = entries[0];
	if (first === undefined) return null;

	const actions: FoldableAction[] = [];
	const receiptEntries: TranscriptEntry[] = [];
	const canonicalIds: string[] = [];
	const rowIds: string[] = [];

	for (const entry of entries) {
		canonicalIds.push(canonicalRowKey(entry));
		rowIds.push(entry.id);
		if (isFoldableToolEntry(entry)) {
			actions.push(toFoldableAction(entry));
		} else if (isFoldReceiptEntry(entry)) {
			receiptEntries.push(entry);
		}
	}

	const trailingReceipts = trailingReceiptStretch(entries, isFoldReceiptEntry);
	const latchedHere =
		options.liveTurn === true &&
		options.latchedFoldIds !== undefined &&
		canonicalIds.some((id) => options.latchedFoldIds?.has(id) === true);

	if (
		actions.length < FOLD_MIN_ACTIONS &&
		trailingReceipts < FOLD_MIN_RECEIPTS &&
		!latchedHere
	) {
		return null;
	}

	const countSegments = foldCountSegments(actions);
	const failedCount = actions.filter((a) => a.failed).length;
	const running = actions.some((a) => a.running);
	const liveAction = running ? pickFoldLiveAction(actions) : null;
	const totalDuration = actions.reduce((sum, a) => sum + a.durationS, 0);

	return {
		key: `fold:${canonicalRowKey(first)}`,
		canonicalIds,
		rowIds,
		actions,
		receiptEntries,
		countSegments,
		failedCount,
		running,
		liveAction,
		durationS: totalDuration >= 1 ? totalDuration : null,
	};
}

/** Retain latched canonical fold ids across sliding windows while pruning dropped rows. */
export function latchFoldedIds(
	previous: ReadonlySet<string>,
	heldCanonicalIds: ReadonlySet<string>,
	runs: readonly FoldRun[],
): Set<string> {
	const next = new Set<string>();
	for (const id of previous) {
		if (heldCanonicalIds.has(id)) next.add(id);
	}
	for (const run of runs) {
		for (const id of run.canonicalIds) next.add(id);
	}
	return next;
}
