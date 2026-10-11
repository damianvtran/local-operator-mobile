/**
 * Turn supplements ("Highlights") on the phone — this surface's ONE mapping
 * place (turn-supplements memo §2.4/§2.7/§2.8/§2.11/§4.1/§4.2, lane N).
 *
 * It sits beside `imagegen`-shaped feature modules (this repo has no imagegen
 * one, so the parallel is `delivery.ts`: a wire vocabulary with exactly one
 * definition) for the same reason: the feature's whole vocabulary has one
 * definition per surface, so a wire rename or a copy change is an edit here and
 * no renderer changes. What lives here:
 *
 *   - the WIRE SHAPES the relay's projection carries (`local-operator`
 *     `mobile/types.py`'s sibling `supplements` map: `{anchor: beat}`, read
 *     defensively — a malformed entry is dropped, never guessed);
 *   - the FROZEN READER RULE (`supplementDisposition`), the port of the core
 *     contract's `reader_disposition` (`local_operator/supplements/contract.py`)
 *     and of the relay web's own port, so all four surfaces agree about the
 *     state machine, the stale-row rule and the "files do not wait for the
 *     generator" arms;
 *   - the DISPLAY COPY, byte-identical to the TUI's constants
 *     (`local_operator/tui/supplements.py`) and the other surfaces': one
 *     spelling per line, because the surfaces are reviewed against a shared
 *     copy table;
 *   - the paint-boundary string discipline (`displayText`, `fileSizeText`,
 *     `filesSummaryLine`, `moreText`, `sourceLine`) — the same functions the
 *     TUI, UI and relay web port, so all surfaces agree on what a display
 *     string is;
 *   - the frame MESSAGE WIRE shape (`acceptFrameMessage`), the theme reader
 *     (`supplementThemeFor`) and the mount budget (`frameBudgetPx`,
 *     `planComponentMounts`);
 *   - the NATIVE-ONLY SHIM (`nativeSupplementDocument`) — see below; it is the
 *     one deliberate divergence from the relay web's module, and BUILD.md
 *     names it as this lane's obligation.
 *
 * WHAT IT MUST NOT DO. No component document is assembled or interpreted here;
 * documents arrive as `{html}` from the relay's own route and are mounted in a
 * sandboxed host. Nothing in this module executes frame content, reads file
 * bytes, or talks to the backend.
 *
 * THE TWO PHONE-SPECIFIC RULES this module states, because the relay file
 * cannot answer them:
 *
 * 1. THE FRAME DOCUMENT IS A TOP-LEVEL DOCUMENT on this surface. The relay
 *    mounts the same bytes in an `iframe`, where `parent` is the host page and
 *    `parent.postMessage` reaches it. A WebView has no parent browsing context
 *    (`window.parent === window`), so the prelude's outbound `parent.postMessage`
 *    disperses into the frame's own window and the host never sees it, and the
 *    host's `window.ReactNativeWebView` channel has no listener inside the
 *    document. `local_operator/supplements/prelude/BUILD.md` assigns the fix to
 *    this lane ("Lane N either injects a native-only shim at assembly time
 *    without touching this shared pair, or revisits the cap in its own PR"):
 *    the shared prelude pair has 46 gzip bytes of headroom, so the answer is
 *    `nativeSupplementDocument`, which injects ONE listener into the fetched
 *    document before the frame mounts. The shim only FORWARDS frames' own
 *    contract-tagged posts through the WebView's standard message channel; it
 *    grants the frame nothing, and the host→frame push still travels the
 *    document's own `window.postMessage` (see `supplement-webview.tsx`).
 *
 * 2. `jobLive` COMES FROM THE PROJECTION'S OWN PROCESS IDENTITY, like the
 *    relay: a disk rebuild stamps `pid = 0` (`mobile/daemon.py`
 *    `_durable_projection`), so a beat is live iff its state is a live-only
 *    word (`running`/`cancelling` are never journaled) OR the carrying
 *    projection has a non-zero pid. A cold open's `decided`/`queued` rows then
 *    render `Highlights cancelled · Retry` instead of spinning forever — the
 *    stale-row rule, exactly as the shared fixture pins it.
 */

import type { ThemeName } from "@/ui/tokens.gen";
import { PALETTE } from "@/ui/tokens.gen";

/* ---------------------------------------------------------------------------
 * The frozen vocabulary (contract.py)
 * ------------------------------------------------------------------------- */

/** `error` value of a row cut by a newer user turn. It renders NOTHING (§2.8). */
export const SUPERSEDED_ERROR = "superseded";

/** `height_hint` is clamped by the validator at WRITE time (§2.4, round-1 R8);
 *  the reserved box, every `resize` and the block's own budget all operate on
 *  this one range. */
export const HEIGHT_HINT_MIN = 120;
export const HEIGHT_HINT_MAX = 480;

/** `more[]` disclosure bound (`contract.MORE_MAX`): the stored ≤ 20 paths. */
export const MORE_MAX = 20;

/** Components per job (`contract.MAX_COMPONENTS`), the aggregate budget's bound. */
export const MAX_COMPONENTS = 3;

/** The one-shot text bound for `supplement_steer` (`contract.STEER_TEXT_MAX_CHARS`). */
export const STEER_TEXT_MAX_CHARS = 500;

/* ---------------------------------------------------------------------------
 * Rows (the projection's sibling map, read defensively)
 * ------------------------------------------------------------------------- */

export type SupplementFile = {
	/** Session-relative or `~/`-relative, NEVER absolute (memo S-R14). */
	path: string;
	name: string;
	kind: string;
	sizeBytes: number;
	mtime: number;
	why: string;
};

export type SupplementComponent = {
	/** The attachment digest the document route is addressed by. */
	attachment: string;
	/** The component's name for tooling and accessibility — never chrome. */
	title: string;
	source: string;
	mime: string;
	heightHint: number;
};

/**
 * One anchor's newest beat, as the relay's projection carries it (the live
 * `SupplementProgressEvent` fields and, on a cold open, the durable row — the
 * same keys, plus fields this surface does not read).
 */
export type SupplementBeat = {
	anchor: string;
	job: string;
	version: number;
	state: string;
	stage: string;
	elapsedS: number;
	files: SupplementFile[];
	filesMore: number;
	more: string[];
	components: SupplementComponent[];
	error: string;
	dismissed: boolean;
};

/** A finite number from an untyped wire field, or `null`. */
function finiteNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
}

/** One file callout, read field-by-field; a malformed entry is dropped, never guessed. */
function fileFrom(value: unknown): SupplementFile | null {
	if (!value || typeof value !== "object") return null;
	const file = value as Record<string, unknown>;
	const path = typeof file.path === "string" ? file.path : "";
	if (!path) return null;
	return {
		path,
		name: typeof file.name === "string" ? file.name : "",
		kind: typeof file.kind === "string" ? file.kind : "",
		sizeBytes: finiteNumber(file.size_bytes) ?? 0,
		mtime: finiteNumber(file.mtime) ?? 0,
		why: typeof file.why === "string" ? file.why : "",
	};
}

/** The `files[]` array, tolerated malformed as a whole (absent = empty). */
export function filesFrom(value: unknown): SupplementFile[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(fileFrom)
		.filter((file): file is SupplementFile => file !== null);
}

/** One component, read field-by-field; a malformed entry is dropped. */
function componentFrom(value: unknown): SupplementComponent | null {
	if (!value || typeof value !== "object") return null;
	const component = value as Record<string, unknown>;
	const attachment =
		typeof component.attachment === "string" ? component.attachment : "";
	if (!isDigest(attachment)) return null;
	return {
		attachment,
		title: typeof component.title === "string" ? component.title : "",
		source: typeof component.source === "string" ? component.source : "",
		mime: typeof component.mime === "string" ? component.mime : "",
		heightHint: finiteNumber(component.height_hint) ?? HEIGHT_HINT_MIN,
	};
}

/** The `components[]` array, tolerated malformed as a whole. */
export function componentsFrom(value: unknown): SupplementComponent[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(componentFrom)
		.filter(
			(component): component is SupplementComponent => component !== null,
		);
}

/** A stored component's digest (`contract.DIGEST_PATTERN`). */
export const DIGEST_RE = /^[a-f0-9]{32}$/;

export function isDigest(value: unknown): value is string {
	return typeof value === "string" && DIGEST_RE.test(value);
}

/**
 * One beat, read field-by-field from the projection's map. `null` for anything
 * whose anchor is missing or whose state is not one of the eight frozen words —
 * an unknown state is not this build's to render, and guessing a disposition
 * for it would be a second state machine.
 */
export function beatFromWire(value: unknown): SupplementBeat | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const anchor = typeof raw.anchor === "string" ? raw.anchor : "";
	if (!anchor) return null;
	const state = typeof raw.state === "string" ? raw.state : "";
	if (!isRowState(state)) return null;
	const filesMore =
		typeof raw.files_more === "number" &&
		Number.isInteger(raw.files_more) &&
		raw.files_more >= 0
			? Math.trunc(raw.files_more)
			: 0;
	const more = Array.isArray(raw.more)
		? raw.more
				.filter((item): item is string => typeof item === "string")
				.slice(0, MORE_MAX)
		: [];
	return {
		anchor,
		job: typeof raw.job === "string" ? raw.job : "",
		version:
			typeof raw.version === "number" && Number.isInteger(raw.version)
				? raw.version
				: 0,
		state,
		stage: typeof raw.stage === "string" ? raw.stage : "",
		elapsedS: finiteNumber(raw.elapsed_s) ?? 0,
		files: filesFrom(raw.files),
		filesMore,
		more,
		components: componentsFrom(raw.components),
		error:
			typeof raw.error === "string"
				? raw.error.slice(0, ERROR_MSG_MAX_CHARS)
				: "",
		dismissed: raw.dismissed === true,
	};
}

/**
 * The projection's whole sibling map, read defensively — the ONE reader the
 * session screen calls. Absent or malformed keys drop to nothing rather than a
 * guess, and a beat whose version ties the one held keeps the later read,
 * exactly as every surface's newest-wins rule does.
 */
export function supplementsFromWire(
	value: unknown,
): Record<string, SupplementBeat> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, SupplementBeat> = {};
	for (const [anchor, raw] of Object.entries(
		value as Record<string, unknown>,
	)) {
		const beat = beatFromWire(raw);
		if (!beat || beat.anchor !== anchor) continue;
		const held = out[anchor];
		if (!held || beat.version >= held.version) out[anchor] = beat;
	}
	return out;
}

/**
 * Whether the job behind a beat is held by a LIVE runtime — the memo's
 * `job_live`, as this wire can express it (module header, rule 2).
 */
export function beatLive(beat: SupplementBeat, projectionPid: number): boolean {
	if (beat.state === "running" || beat.state === "cancelling") return true;
	return projectionPid > 0;
}

/* ---------------------------------------------------------------------------
 * The frozen reader rule
 * ------------------------------------------------------------------------- */

export type SupplementRowState =
	| "decided"
	| "queued"
	| "running"
	| "cancelling"
	| "done"
	| "failed"
	| "cancelled"
	| "skipped";

/** What a surface paints for the newest row of an anchor (`ReaderDisposition`). */
export type SupplementDisposition =
	| "preparing"
	| "files_preparing"
	| "block"
	| "cancelled_retry"
	| "files_cancelled_retry"
	| "failed_retry"
	| "files_failed_retry"
	| "nothing";

const WITH_FILES: Partial<
	Record<SupplementDisposition, SupplementDisposition>
> = {
	preparing: "files_preparing",
	cancelled_retry: "files_cancelled_retry",
	failed_retry: "files_failed_retry",
};

/**
 * How far along a state is, for "is this row newer than what we hold"
 * (`contract`/`tui.supplements.state_rank`): terminal arms tie, and an unknown
 * word reads as 0. The order is a READER fact, not a wire one.
 */
export function stateRank(state: unknown): number {
	switch (state) {
		case "decided":
			return 0;
		case "queued":
			return 1;
		case "running":
			return 2;
		case "cancelling":
			return 3;
		case "done":
		case "failed":
		case "cancelled":
		case "skipped":
			return 4;
		default:
			return 0;
	}
}

function isRowState(state: string): state is SupplementRowState {
	return (
		state === "decided" ||
		state === "queued" ||
		state === "running" ||
		state === "cancelling" ||
		state === "done" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "skipped"
	);
}

/**
 * The frozen reader rule: what every surface must paint for one row.
 *
 * `jobLive` is `beatLive` above. A cold reader (cold open, reaped job) has no
 * live job, and then a non-terminal row renders as `cancelled · Retry` instead
 * of spinning forever. Precedence is the memo's: a superseded or dismissed row
 * renders nothing whatever its state; then the committed state decides; then a
 * non-`done` row that carries files paints them above its line (the decision
 * wrote them first so they need not wait, §2.4). A `done` row with nothing to
 * show renders nothing at all — the block never draws a header (2026-10-10
 * amendment).
 */
export function supplementDisposition(
	beat: SupplementBeat,
	jobLive: boolean,
): SupplementDisposition {
	const state = beat.state;
	if (
		beat.error === SUPERSEDED_ERROR ||
		beat.dismissed ||
		state === "skipped"
	) {
		return "nothing";
	}
	if (state === "done") {
		return beat.files.length || beat.components.length ? "block" : "nothing";
	}
	let line: SupplementDisposition;
	if (state === "failed") line = "failed_retry";
	else if (state === "cancelled") line = "cancelled_retry";
	else if (
		state === "decided" ||
		state === "queued" ||
		state === "running" ||
		state === "cancelling"
	) {
		line = jobLive ? "preparing" : "cancelled_retry";
	} else return "nothing";
	return beat.files.length ? (WITH_FILES[line] ?? line) : line;
}

/* ---------------------------------------------------------------------------
 * Display copy and the paint boundary (ported from tui/supplements.py)
 * ------------------------------------------------------------------------- */

/** The loading line's fixed sentence (memo §2.8 copy table). */
export const COPY_PREPARING = "Preparing highlights…";
export const COPY_CANCELLED = "Highlights cancelled";
export const COPY_FAILED = "Couldn't prepare highlights";
/** The frame-level fallback (§2.8): shown in place of a frame that died or hung. */
export const COPY_FRAME_FALLBACK = "Couldn't render this graphic";
/** The two control labels of the action pair (D10). */
export const COPY_ADJUST = "Adjust…";
export const COPY_CANCEL = "Cancel";
/** The retry affordance the cancelled/failed/frame lines carry. */
export const COPY_RETRY = "Retry";

/** The three op leads, one spelling per act (the refusal hygiene every surface
 *  shares: the lead names what the reader attempted, then the relay's own
 *  sentence passes through unmodified). */
export const OP_LEAD = {
	cancel: "Could not cancel",
	steer: "Could not adjust",
	restart: "Could not retry",
} as const;

/**
 * The terminal control sequences, ported verbatim from the other surfaces'
 * `receipt-row-model.ts`/`receipt-row-model` ports (which port
 * `local_operator/ansi.py`'s `_CONTROL_RE`): every host-rendered string
 * (names, titles, paths, the "N more" line) is model-authored, and a file name
 * carrying an erase-display must not repaint the row it is painted on.
 */
/* The control characters ARE the input — this regex strips terminal control
   sequences (CSI/OSC/DCS) out of host-rendered strings, which is the same
   discipline the TUI and the other surfaces apply before painting a
   model-authored name. */
const CONTROL_SEQUENCES =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: see the comment above
	/(?:\u001b[\]PX^_]|[\u009d\u0090\u0098\u009e\u009f])(?:(?!\u0007|\u001b\\|\u009c)[\s\S])*(?:\u0007|\u001b\\|\u009c|$)|(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|(?:\u001b\[|\u009b)[0-?]*[ -/]*$|\u001b[ -/]+[0-~]|\u001b[@-Z\\-_]|\u001b$|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Every Unicode `Cf` (format) character: `U+202E` (RTL override) reorders the
 *  glyphs around it and a zero-width joiner hides the seam in a spliced word,
 *  so the category is stripped beside the sequences above. */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/** Every run of whitespace, the display boundary's collapse. */
const WHITESPACE_RUN = /\s+/;

/** The trailing `.0` a one-decimal size drops (`4.0 KB` reads `4 KB`). */
const TRAILING_ZERO_DECIMAL = /\.0$/;

/**
 * One host-rendered string, safe to paint on one line (the TUI's
 * `display_text`): control sequences stripped, every whitespace run — newlines
 * included, which survive sequence stripping by design — collapsed to a single
 * space. Non-strings read as `""` so a malformed row paints nothing rather
 * than raising on a render path.
 */
export function displayText(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.replace(CONTROL_SEQUENCES, "")
		.replace(FORMAT_CHARACTERS, "")
		.split(WHITESPACE_RUN)
		.filter(Boolean)
		.join(" ");
}

/** `2 files: report.md, bench.csv` — the files-only one-liner (memo §2.8). */
export function filesSummaryLine(names: readonly string[]): string {
	const count = names.length;
	const label = count === 1 ? "1 file" : `${count} files`;
	return `${label}: ${names.join(", ")}`;
}

/** The disclosure's words: `3 more files` (memo §2.8). */
export function moreText(count: number): string {
	const bounded = Math.max(0, Math.floor(count));
	return bounded === 1 ? "1 more file" : `${bounded} more files`;
}

/**
 * A byte count as the short column the file rows carry (`912 B` / `4.1 KB` /
 * `1.2 MB`): one decimal on the scaled units, a trailing `.0` dropped. A value
 * that is not a non-negative number reads as `""` — the column is simply
 * absent, never a wrong number.
 */
export function fileSizeText(sizeBytes: unknown): string {
	if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) return "";
	if (sizeBytes < 0) return "";
	if (sizeBytes < 1024) return `${Math.trunc(sizeBytes)} B`;
	const units: ReadonlyArray<readonly [string, number]> = [
		["KB", 1024],
		["MB", 1024 ** 2],
		["GB", 1024 ** 3],
	];
	for (const [unit, scale] of units) {
		if (sizeBytes < scale * 1024 || unit === "GB") {
			const value = sizeBytes / scale;
			const text = value.toFixed(1).replace(TRAILING_ZERO_DECIMAL, "");
			return `${text} ${unit}`;
		}
	}
	return "";
}

/** `(name, path, size)` for one callout row, each display-stripped. */
export function fileRowParts(file: SupplementFile): {
	name: string;
	path: string;
	size: string;
} {
	const name = displayText(file.name) || displayText(file.path);
	const rawPath = displayText(file.path);
	return {
		name,
		path: rawPath === name ? "" : rawPath,
		size: fileSizeText(file.sizeBytes),
	};
}

/**
 * One count clause, singular/plural: `1 file` / `2 files`, `1 graphic` /
 * `2 graphics`.
 */
export function countClause(count: number, noun: "file" | "graphic"): string {
	const bounded = Math.max(0, Math.floor(count));
	return bounded === 1 ? `1 ${noun}` : `${bounded} ${noun}s`;
}

/**
 * The graphics disclosure's words: `Show all 2 graphics` — singularized for
 * one, matching `moreText`'s own singular arm.
 */
export function showAllText(count: number): string {
	const bounded = Math.max(0, Math.floor(count));
	return bounded === 1 ? "Show all 1 graphic" : `Show all ${bounded} graphics`;
}

/**
 * The files-only one-liner's names: featured files first, then the stored tail
 * up to the known count, each as the display-stripped basename. Shared so a
 * counter and the expanded block can never summarize one set two ways.
 */
export function filesSummaryOf(beat: SupplementBeat): string | null {
	const names: string[] = [];
	for (const file of beat.files) {
		const { name, path } = fileRowParts(file);
		if (name || path) names.push(name || path);
	}
	if (beat.filesMore > 0) {
		for (const item of beat.more.slice(0, beat.filesMore)) {
			const base = displayText(item).split("/").pop() ?? "";
			if (base) names.push(base);
		}
	}
	const shown = names.filter(Boolean).slice(0, 2);
	return shown.length > 0 ? filesSummaryLine(shown) : null;
}

/** `Source: …` — the block's one caption line (§2.10). */
export function sourceLine(source: string): string {
	return `Source: ${displayText(source)}`;
}

/* ---------------------------------------------------------------------------
 * The frame message wire (§4.1/§4.2)
 * ------------------------------------------------------------------------- */

export const FRAME_MESSAGE_TAG = "supplement";
export const HOST_MESSAGE_TAG = "supplement-host";
export const FRAME_PROTOCOL_VERSION = 1;

/** The ONLY frame -> host shapes a host accepts. */
export const FRAME_MESSAGE_TYPES = [
	"ready",
	"resize",
	"error",
	"pong",
] as const;
export type FrameMessageType = (typeof FRAME_MESSAGE_TYPES)[number];

/** Those that can move host state and so MUST echo the per-frame nonce. */
export const NONCE_REQUIRED_TYPES: readonly FrameMessageType[] = [
	"resize",
	"error",
	"pong",
];

/** The longest nonce a host may mint (`contract.NONCE_MAX_CHARS`). */
export const NONCE_MAX_CHARS = 64;
/** The longest `msg` an `error` may carry (`contract.ERROR_MSG_MAX_CHARS`). */
export const ERROR_MSG_MAX_CHARS = 300;
/** The watchdog bound (`contract.WATCHDOG_S`), in ms. */
export const WATCHDOG_MS = 5000;
/** How often the host pings a ready frame, in ms. */
export const PING_INTERVAL_MS = 4000;

export type FrameMessage = {
	lo: "supplement";
	v: 1;
	t: FrameMessageType;
	n?: string;
	h?: number;
	msg?: string;
};

/**
 * The SHAPE half of the host's acceptance rule (the port of the core's
 * `accept_frame_message`, which every host mirrors). Returns the message when
 * it is one of the four accepted shapes and, for a state-moving type, carries
 * the live `nonce`; everything else — wrong tag or version, an unknown `t`,
 * a missing or stale nonce, a non-finite or negative `h`, an `error` whose
 * `msg` is not a string of at most `ERROR_MSG_MAX_CHARS` — is `null`.
 *
 * NOT the whole check: on the web host, `event.source === iframe.contentWindow`
 * and `event.origin === "null"`, the load counter and the one-message-per-
 * animation-frame coalescing sit beside this call; on the native host the
 * message arrives through the WebView's own channel (which only the mounted
 * document can use) and the nonce is the binding.
 */
export function acceptFrameMessage(
	message: unknown,
	nonce: string | null,
): FrameMessage | null {
	if (!message || typeof message !== "object") return null;
	const frame = message as Record<string, unknown>;
	if (frame.lo !== FRAME_MESSAGE_TAG) return null;
	if (frame.v !== FRAME_PROTOCOL_VERSION) return null;
	const kind = frame.t;
	if (
		typeof kind !== "string" ||
		!(FRAME_MESSAGE_TYPES as readonly string[]).includes(kind)
	) {
		return null;
	}
	const type = kind as FrameMessageType;
	if (
		NONCE_REQUIRED_TYPES.includes(type) &&
		(!nonce || nonce.length > NONCE_MAX_CHARS || frame.n !== nonce)
	) {
		return null;
	}
	if (type === "error") {
		const text = frame.msg;
		if (typeof text !== "string" || text.length > ERROR_MSG_MAX_CHARS)
			return null;
	}
	if (type === "resize") {
		const height = frame.h;
		if (typeof height !== "number" || !Number.isFinite(height) || height < 0)
			return null;
	}
	return {
		lo: "supplement",
		v: 1,
		t: type,
		...(typeof frame.n === "string" ? { n: frame.n } : {}),
		...(typeof frame.h === "number" ? { h: frame.h } : {}),
		...(typeof frame.msg === "string" ? { msg: frame.msg } : {}),
	};
}

/* The per-frame nonce (`mintNonce`) lives in `components/supplement-nonce.ts`:
 * it needs `expo-crypto`, and this module must stay loadable under Node for the
 * unit suites. */

/* ---------------------------------------------------------------------------
 * The theme channel (§2.6, §4.1; live switches)
 * ------------------------------------------------------------------------- */

/**
 * The variables the prelude consumes, as the ONE list this host reads — the
 * same fixed list the relay web reads (`prelude.css` styles every helper through
 * these names). The frame's own whitelist (`^--(lo|font)-[a-z0-9-]+$`) admits
 * these and drops anything else, so this list and that pattern are the whole
 * vocabulary.
 */
export const THEME_VARIABLE_NAMES: readonly string[] = [
	"--lo-accent",
	"--lo-accent-wash",
	"--lo-border-control",
	"--lo-canvas",
	"--lo-danger",
	"--lo-hairline",
	"--lo-info",
	"--lo-ink",
	"--lo-ink-dim",
	"--lo-ink-muted",
	"--lo-success",
	"--lo-sunken",
	"--lo-surface",
	"--lo-warning",
];

/**
 * The app colour role each `--lo-*` name resolves from. The roles are this
 * app's own (`tokens.gen.ts`); the names are the frame's, and the mapping is
 * the one place they meet. A role the app renames breaks this table at
 * type-check, not silently at paint time.
 */
const THEME_ROLE_BY_VARIABLE: Record<string, string> = {
	"--lo-accent": "accent",
	"--lo-accent-wash": "accent-wash",
	"--lo-border-control": "border-control",
	"--lo-canvas": "canvas",
	"--lo-danger": "danger",
	"--lo-hairline": "hairline",
	"--lo-info": "info",
	"--lo-ink": "ink",
	"--lo-ink-dim": "ink-dim",
	"--lo-ink-muted": "ink-muted",
	"--lo-success": "success",
	"--lo-sunken": "sunken",
	"--lo-surface": "surface",
	"--lo-warning": "warning",
};

export type SupplementTheme = {
	mode: "light" | "dark";
	vars: Record<string, string>;
};

/**
 * The theme as the frame is owed it: RESOLVED values, never a palette id
 * (`ThemeMessage`'s contract). Read from the app's generated palette for the
 * theme that RENDERS (the same values the live CSS variables resolve to,
 * `appearance.tsx`'s two systems agreeing by construction), so this is correct
 * for every theme without the frame knowing any of them — and because the block
 * re-renders on a theme change and pushes a fresh message, a live switch is one
 * more push, not a reload.
 */
export function supplementThemeFor(theme: ThemeName): SupplementTheme {
	const palette = PALETTE[theme];
	const vars: Record<string, string> = {};
	for (const name of THEME_VARIABLE_NAMES) {
		const role = THEME_ROLE_BY_VARIABLE[name];
		const value = role ? palette[role as keyof typeof palette] : undefined;
		if (typeof value === "string" && value.length > 0) vars[name] = value;
	}
	return { mode: theme, vars };
}

/* ---------------------------------------------------------------------------
 * The mount budget (§2.11)
 * ------------------------------------------------------------------------- */

/**
 * The block's automatic-mount budget: `min(480 px, 40 vh)`. Frames mount
 * automatically only while their cumulative RENDERED heights stay inside this;
 * anything beyond sits behind one disclosure.
 */
export function frameBudgetPx(viewportHeight: number): number {
	return Math.min(480, Math.round(0.4 * Math.max(0, viewportHeight)));
}

/** One component's clamped mount height (the reserved box measures the same). */
export function clampedHeightHint(component: SupplementComponent): number {
	return Math.min(
		HEIGHT_HINT_MAX,
		Math.max(HEIGHT_HINT_MIN, component.heightHint),
	);
}

/**
 * A resize's height, clamped into the contract's [120, 480] range. The accept
 * step validates SHAPE only (the contract's own reader); the CLAMP is the
 * host's — the nonce binds the browsing context, not the code in it, so a
 * hostile successor document would otherwise pick its own size.
 */
export function clampFrameHeight(height: number): number {
	return Math.min(HEIGHT_HINT_MAX, Math.max(HEIGHT_HINT_MIN, height));
}

/**
 * Which components mount automatically, and whether a disclosure is owed.
 *
 * The walk takes components in order while the cumulative RENDERED height stays
 * within the budget; whatever remains is behind `Show all N graphics`. The FIRST
 * frame is admitted regardless of the budget, deliberately: a block whose single
 * graphic sat behind `Show all 1 graphic` would open on an empty-looking row.
 *
 * THE ACCRUAL IS MADE OF RENDERED HEIGHTS: the walk HOLDS at the first
 * unmeasured predecessor — `measured` carries each mounted frame's ACTUAL box
 * height, by digest, once its resize has landed, and a frame whose height is
 * still unknown is the reserved box, NOT a rendered height. `measured` absent
 * means nothing has rendered yet, so only the first frame is admitted.
 */
export function planComponentMounts(
	components: readonly SupplementComponent[],
	budgetPx: number,
	measured?: ReadonlyMap<string, number>,
): { visible: SupplementComponent[]; hidden: SupplementComponent[] } {
	let used = 0;
	const visible: SupplementComponent[] = [];
	for (let index = 0; index < components.length; index += 1) {
		const component = components[index];
		if (component === undefined) break;
		const rendered = measured?.get(component.attachment);
		const height =
			rendered !== undefined
				? clampFrameHeight(rendered)
				: clampedHeightHint(component);
		if (index > 0) {
			const settled = visible.every(
				(earlier) => measured?.get(earlier.attachment) !== undefined,
			);
			if (!settled) break;
			if (used + height > budgetPx) break;
		}
		used += height;
		visible.push(component);
	}
	return { visible, hidden: components.slice(visible.length) };
}

/* ---------------------------------------------------------------------------
 * File callouts: the preview affordance (§2.7/§3.4 N5)
 * ------------------------------------------------------------------------- */

/**
 * What this surface can do with a recorded file, decided from the SUFFIX — the
 * same key the relay's file route resolves its `Content-Type` from
 * (`_SUPPLEMENT_FILE_TYPES` in `mobile/daemon.py`; kept in step deliberately,
 * because an affordance offered for a suffix the route refuses would be a dead
 * end). The route is still the authority: this decides only whether an
 * affordance is OFFERED, and every fetch renders the route's own refusal when it
 * refuses.
 *
 * `other` renders the row without an affordance: the phone cannot render it and
 * v1 has no download path (native's N5 note: "Preview" for text/image; Share is
 * phase 2).
 */
export type SupplementFileClass = "text" | "image" | "pdf" | "other";

const TEXT_SUFFIXES = new Set([
	".txt",
	".log",
	".md",
	".markdown",
	".csv",
	".tsv",
	".json",
]);
const IMAGE_SUFFIXES = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".heic",
	".heif",
	".avif",
]);

export function supplementFileClass(path: string): SupplementFileClass {
	const dot = path.lastIndexOf(".");
	const suffix = dot >= 0 ? path.slice(dot).toLowerCase() : "";
	if (TEXT_SUFFIXES.has(suffix)) return "text";
	if (IMAGE_SUFFIXES.has(suffix)) return "image";
	if (suffix === ".pdf") return "pdf";
	return "other";
}

/* ---------------------------------------------------------------------------
 * The native-only shim (BUILD.md, lane N)
 * ------------------------------------------------------------------------- */

/** The marker attribute the shim's `<script>` carries, so the injection is
 *  idempotent and a fixture can assert which document it is looking at. */
export const NATIVE_SHIM_MARKER = "data-lo-native-shim";

/**
 * The one script this lane adds to a fetched document before a WebView mounts
 * it. See the module header, rule 1, for why it exists.
 *
 * It is deliberately ADDITIVE and outbound-only:
 *
 *   - it installs ONE listener that forwards messages the document itself posts
 *     with the contract tag (`lo: "supplement"`) through
 *     `window.ReactNativeWebView.postMessage` — the WebView library's own
 *     channel, which the host reads via `onMessage`. Nothing is granted to the
 *     document: the shim reads nothing, exposes no object, and never answers.
 *   - it listens on BOTH `window` and `document`: the prelude posts via
 *     `parent.postMessage`, and on a top-level WebView document that disperses
 *     into the document's own window; listening on both is the cheap belt for
 *     the platform quirk BUILD.md names ("listen on `document` as well as
 *     `window`").
 *
 * The host -> frame direction needs no shim: the host injects
 * `window.postMessage(...)`, which is an ordinary same-document message the
 * prelude's own listener receives (its `event.source === parent` check holds
 * because `parent === window` at top level). `supplement-webview.tsx` states
 * that delivery beside its use.
 *
 * Injection is refused (the original bytes returned) when the document has no
 * `<head>` to open or already carries the marker: this function must never be
 * able to corrupt a document it does not recognise, and a second mount of the
 * same bytes must not stack a second listener.
 */
export function nativeSupplementDocument(html: string): string {
	if (html.includes(NATIVE_SHIM_MARKER)) return html;
	const shim =
		`<script ${NATIVE_SHIM_MARKER}>(function(){` +
		`var forward=function(e){var d=e&&e.data;if(!d||d.lo!=="supplement")return;` +
		`try{var b=window.ReactNativeWebView;if(b&&typeof b.postMessage==="function")b.postMessage(JSON.stringify(d))}catch(x){}};` +
		`window.addEventListener("message",forward);` +
		`document.addEventListener("message",forward);` +
		`})();</script>`;
	const headEnd = html.indexOf("<head>");
	if (headEnd < 0) return html;
	const insertAt = headEnd + "<head>".length;
	return html.slice(0, insertAt) + shim + html.slice(insertAt);
}

/**
 * One host -> frame message as the script an injected JavaScript evaluation can
 * carry. `JSON.stringify` output is a valid JavaScript expression; the extra
 * escapes close the two ways an evaluated source can be broken by its payload
 * (`</script>` is irrelevant on this channel, but U+2028/U+2029 were illegal in
 * string literals before ES2019 and old WebViews exist).
 */
export function hostMessageScript(message: Record<string, unknown>): string {
	const json = JSON.stringify(message)
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029")
		.replace(/</g, "\\u003c");
	return `window.postMessage(${json}, "*"); true;`;
}

/* ---------------------------------------------------------------------------
 * The web mount URL (§4.1: the `data:` form, and only it)
 * --------------------------------------------------------------------------- */

/**
 * The `data:` URL the app's WEB build mounts a component's document at. The
 * web build is the repo's capture/dev target (the native surface uses a
 * WebView), so this exists so a rendered frame of the block shows a real
 * component — the semantic mirror of the relay web's `supplementFrameUrl`.
 *
 * Base64, not percent-encoding: one code path, and 64 KB documents are fine in
 * it (§4.1). The encoding is UTF-8-safe (`btoa` alone throws on non-Latin-1),
 * which matters because component prose is arbitrary text.
 */
export function supplementFrameUrl(html: string): string {
	return `data:text/html;base64,${base64Utf8(html)}`;
}

/** UTF-8 bytes -> base64, without a TextEncoder dependency. */
function base64Utf8(text: string): string {
	const bytes = utf8Bytes(text);
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i] ?? 0;
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
		out += alphabet[b0 >> 2];
		out += alphabet[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
		out +=
			b1 === undefined ? "=" : alphabet[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
		out += b2 === undefined ? "=" : alphabet[b2 & 63];
	}
	return out;
}

/** The UTF-8 encoding of `text`, computed without a TextEncoder in scope. */
function utf8Bytes(text: string): number[] {
	const bytes: number[] = [];
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 0x7f) bytes.push(code);
		else if (code <= 0x7ff) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code <= 0xffff) {
			bytes.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		} else {
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}
	return bytes;
}
