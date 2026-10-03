/**
 * The scenario registry: every state a test or an audit round needs to pin,
 * expressed as data over the captured fixture corpus.
 *
 * Why a registry rather than code paths: ADR 0003 requires "a state is a
 * fixture, not a code path someone has to reproduce". Each entry below either
 * replays a capture verbatim or composes one — and the composition is written
 * out, so a reviewer can read what a state *is* without running it.
 *
 * Every scenario also carries `shows`: the screen/state cell it exists to fill
 * in the UX audit matrix (`docs/ux/audit-rubric.md` §1-§2). That is what lets
 * `tools/visual` walk the matrix without a second hand-maintained list.
 */

import type {
	PastSession,
	PendingRequest,
	SessionProjection,
	SessionSummary,
	ToolState,
} from "../../docs/relay/types.ts";
import type { Json } from "../lib/json.ts";
import { isRecord } from "../lib/json.ts";
import type { FixtureCorpus } from "./fixtures.ts";
import { syntheticSessionId } from "./wire.ts";

/**
 * How the event stream behaves in a scenario.
 *
 * `settleAfterTurns` and the stop reason are what make a stream a *finite* thing
 * a capture run can wait for: a scenario that streams forever cannot be
 * photographed as "the turn finished".
 */
export interface StreamSpec {
	/**
	 * `silent` is a connected-but-quiet runtime: the seed arrives so the client
	 * renders, keep-alives continue, and no turn frames ever follow. It is the
	 * state a degraded row's socket is actually in, as distinct from the
	 * `silent-stall` fault, which stops the keep-alives too.
	 *
	 * `refused` is the session's OWN event channel failing while the rest of the
	 * relay answers — a connected session whose stream is refused, which is the
	 * only shape the session view's error state can be reached from. A blanket
	 * `failure` cannot serve that cell: it refuses `/api/sessions` too, so the
	 * client never holds a projection, `connected` stays false, and the error
	 * marker is not rendered however true the failure is (measured: `session-error`
	 * is unreachable from a blanket refusal).
	 */
	mode: "streaming" | "idle" | "keepalive-only" | "silent" | "refused";
	/** The gateway refusal the event route answers with when `mode: "refused"`:
	 *  a key from the same space `FailureSpec.key` uses. Only a NON-transient
	 *  refusal reaches the error state — a transport drop is reconnected through. */
	refusalKey?: string;
	/** Milliseconds between pumped frames; the default is 700. */
	intervalMs?: number;
	settleAfterTurns?: number;
	settleStopReason?: string;
	settleCutOff?: boolean;
}

/** A refusal the mock answers before (or instead of) reaching the relay. */
export interface FailureSpec {
	surface: "edge" | "gateway";
	key: string;
}

/** A recorded response a scenario substitutes for a route's default. */
export interface FixtureOverride {
	status: number;
	headers: Record<string, string>;
	json?: Json;
	text?: string;
}

/**
 * The world a scenario declares: exactly the surface the relay serves from.
 *
 * Every field is optional because most scenarios change one thing. `world()` is a
 * function so each start of a scenario gets fresh clones — a mutated projection
 * must not leak into the next run of the same scenario.
 */
export interface ScenarioWorld {
	/** Session id → projection. An empty object is "no conversations at all". */
	projections?: Record<string, SessionProjection>;
	stream?: StreamSpec;
	/**
	 * Faults this state NEEDS, in the `faults.ts` spelling (`401-mid-session=2`).
	 *
	 * A fault that belongs to the state travels with the state: a cell pinned by the
	 * capture — which sends only the scenario NAME — gets it, and so does a rig that
	 * switches scenario. A scenario without faults leaves whatever the runner was
	 * started with alone, so `--fault` still works.
	 */
	faults?: string[];
	/** A fixture name whose recorded answer the command endpoint returns instead. */
	commandOverride?: string;
	failure?: FailureSpec;
	/** Seconds after which the set of list rows is replaced (the heartbeat case). */
	heartbeatTimeoutS?: number;
	/**
	 * Hold a surface open: `api: "forever"` never answers a read route, and
	 * `commands` is the relay's reply window in milliseconds, after which a command
	 * to an unreachable runtime is answered 504 (the state a `degraded` row is in).
	 */
	hold?: { api?: "forever"; commands?: number };
	listOverrides?: { degraded?: string[] };
	/** Field overrides applied to every derived row; `null` means "not reported". */
	rowOverrides?: Record<string, SessionSummary[keyof SessionSummary]>;
	rowOverridesAfterHeartbeat?: Record<
		string,
		SessionSummary[keyof SessionSummary]
	>;
	past?: PastSession[] | FixtureOverride;
	search?: FixtureOverride;
	models?: Json[];
}

/** One registered scenario. */
export interface ScenarioEntry {
	name: string;
	description: string;
	/** The audit-matrix cells this scenario exists to fill (rubric §1-§2). */
	shows: string[];
	world: () => ScenarioWorld;
}

/** The registry, keyed by scenario name. */
export type ScenarioRegistry = Record<string, ScenarioEntry>;

/** The session id every live capture in the corpus uses. */
export const CAPTURED_SESSION = "6714def86197";

/** A `SessionSummary` derived from a projection, so a row and its stream agree. */
export function rowFrom(
	projection: SessionProjection,
	overrides: Partial<SessionSummary> = {},
): SessionSummary {
	const subagents = projection.subagents ?? [];
	const running = subagents.filter((s) => s.status === "running").length;
	const queued = subagents.filter((s) => s.status === "queued").length;
	const todos = projection.todos ?? [];
	return {
		session_id: projection.session_id,
		// The shared catalogue's `active` rule is "has an unseen completion", not
		// "a live process exists" — a durable conversation with an unread
		// completion is active on every surface.
		section: "active",
		pinned: false,
		conversation_name: projection.conversation_name,
		cwd: projection.cwd,
		model_label: projection.model_label,
		streaming: projection.streaming,
		leaving: "",
		updating: "",
		needs_attention: projection.pending != null,
		pending_kind: projection.pending?.kind ?? "",
		// `null` means "not reported" and must never be read as 0; a vouched-for
		// registration reports a real count.
		subagents_running: running,
		subagents_queued: queued,
		todos_open: todos.reduce(
			(n, phase) =>
				n +
				(phase.items ?? []).filter(
					(i) => i.status === "pending" || i.status === "blocked",
				).length,
			0,
		),
		mtime: 1790727370.33,
		created_at: 1790727300.11,
		completion_kind: projection.stop_reason === "completed" ? "complete" : "",
		unseen: false,
		...overrides,
	};
}

/**
 * A projection built from a captured one. Mutating a clone of a capture is the
 * only way to add a state the corpus does not have while staying byte-shaped.
 */
/**
 * A projection's pending request, required to be present.
 *
 * A scenario that builds on a pending approval or ask is meaningless without
 * one, so a corpus change that dropped it fails here, naming the projection,
 * rather than producing a screen with no prompt and a passing capture.
 */
function pendingOf(projection: SessionProjection): PendingRequest {
	if (projection.pending === null || projection.pending === undefined) {
		throw new Error(
			`projection '${projection.session_id}' has no pending request to build on`,
		);
	}
	return structuredClone(projection.pending);
}

function projectionFrom(
	fixture: SessionProjection,
	overrides: Partial<SessionProjection> = {},
): SessionProjection {
	return { ...structuredClone(fixture), ...overrides };
}

const longName =
	"Refactor the payment reconciliation worker and its retry envelope";
const longCwd =
	"~/workspace/clients/meridian/operations/reporting/pipelines/nightly-reconciliation";

/** A 500-row transcript of tool rows, which is what the projection cap is about. */
function longTranscript(
	base: SessionProjection,
	rows = 520,
): SessionProjection["transcript"] {
	const template = base.transcript.find((entry) => entry.kind === "tool");
	if (template === undefined) {
		// The long-transcript scenario is the one that proves the list can carry 500+
		// rows; without a tool row to clone it would silently produce a short list and
		// the capture would look like a pass.
		throw new Error("the long-trace base projection has no tool row to clone");
	}
	const states: ToolState[] = [
		"done",
		"failed",
		"queued",
		"composing",
		"running",
		"interrupted",
	];
	const out = base.transcript
		.filter((entry) => entry.kind === "user" || entry.kind === "assistant")
		.slice(0, 2);
	for (let i = 0; i < rows; i += 1) {
		out.push({
			...structuredClone(template),
			id: `tc-long-${String(i).padStart(4, "0")}`,
			tool_call_id: `long-${i}`,
			tool_name: ["bash", "read", "edit", "glob", "grep"][i % 5] ?? "bash",
			tool_state: states[i % states.length] ?? "done",
			summary: `step ${i + 1} of the reconciliation sweep`,
			text: `Step ${i + 1}: processed ${i * 37} records`,
			elapsed_s: (i % 90) / 10,
			error: i % 6 === 1 ? "exit status 2: ledger mismatch" : "",
			diff_added: i % 7 === 0 ? 12 : 0,
			diff_removed: i % 7 === 0 ? 3 : 0,
		});
	}
	return out;
}

/**
 * Build the scenario registry against a loaded fixture corpus.
 * `fix` is the object `loadFixtures()` returns.
 */
export function buildScenarios(fix: FixtureCorpus): ScenarioRegistry {
	const capabilities = fix.list("sessions-empty").capabilities;
	const emptyList = () => ({ sessions: [], degraded: [] });

	const liveIdle = fix.projection("sse-projection-live-idle");
	const seed = fix.projection("sse-projection-seed");
	const approvalFrame = fix.projection("sse-projection-pending-approval");
	const richRowsFrame = fix.projection("sse-projection-rich-rows");
	const queuedFrame = fix.projection("sse-projection-queued-steer");
	const afterDeath = fix.projection("sse-projection-durable-after-death");
	const everyKind = fix.projection("sse-projection-every-entry-kind");
	const askFrame = fix.projection("sse-projection-pending-ask");
	const approvalExample = fix.projection(
		"sse-projection-pending-approval-example",
	);
	// The ranked catalogue is a synthetic frame, not a projection: its payload is
	// read off the fixture and checked for the one field the scenario publishes.
	const rankedPayload = fix.frame("models.ranked").data;
	const rankedModels: Json[] =
		isRecord(rankedPayload) && Array.isArray(rankedPayload.models)
			? rankedPayload.models
			: [];

	/** One live, idle conversation: the corpus's own capture. */
	const idleWorld = () => ({
		projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
	});

	/** A synthetic computer registry — 32-hex labels, per the edge's own regex. */
	const tunnels = [
		{
			id: "0123456789abcdef0123456789abcdef",
			owner_account_id: "acct_mock_0001",
			name: "Studio desktop",
			device_id: "dev_mock_0001",
			gateway_port: 4100,
			enabled: true,
			version: 7,
			hostname: "0123456789abcdef0123456789abcdef-lop.radienthq.com",
			harnesses: [
				{
					id: "local-operator",
					enabled: true,
					port: 4100,
					hostname: "0123456789abcdef0123456789abcdef-lop.radienthq.com",
					url: "https://0123456789abcdef0123456789abcdef-lop.radienthq.com",
				},
			],
			status: "active",
			created_at: "2026-08-02T09:14:00Z",
			updated_at: "2026-09-28T22:41:00Z",
			billing: { status: "active", accepted_monthly_price_usd: 0 },
		},
		{
			id: "fedcba9876543210fedcba9876543210",
			owner_account_id: "acct_mock_0001",
			name: "Laptop",
			device_id: "dev_mock_0002",
			gateway_port: 4100,
			enabled: false,
			version: 3,
			hostname: "fedcba9876543210fedcba9876543210-lop.radienthq.com",
			harnesses: [
				{
					id: "local-operator",
					enabled: false,
					port: 4100,
					hostname: "fedcba9876543210fedcba9876543210-lop.radienthq.com",
					url: "https://fedcba9876543210fedcba9876543210-lop.radienthq.com",
				},
			],
			status: "suspended",
			created_at: "2026-05-11T11:02:00Z",
			updated_at: "2026-08-19T08:20:00Z",
			revoked_at: "2026-08-19T08:20:00Z",
			billing: { status: "past_due", accepted_monthly_price_usd: 0 },
		},
		{
			id: "00112233445566778899aabbccddeeff",
			owner_account_id: "acct_mock_0001",
			name: "Build mini",
			device_id: "dev_mock_0003",
			gateway_port: 4100,
			enabled: true,
			version: 1,
			hostname: "00112233445566778899aabbccddeeff-lop.radienthq.com",
			harnesses: [
				{
					id: "local-operator",
					enabled: true,
					port: 4100,
					hostname: "00112233445566778899aabbccddeeff-lop.radienthq.com",
					url: "https://00112233445566778899aabbccddeeff-lop.radienthq.com",
				},
			],
			status: "active",
			created_at: "2026-09-01T07:00:00Z",
			updated_at: "2026-09-29T06:31:00Z",
			billing: { status: "active", accepted_monthly_price_usd: 0 },
		},
	];

	const scenarios: ScenarioRegistry = {};

	/** Register a scenario; `world` is a function so each start gets fresh clones. */
	const add = (
		name: string,
		description: string,
		shows: string[],
		world: () => ScenarioWorld,
	): void => {
		scenarios[name] = { name, description, shows, world };
	};

	/* ------------------------------------------------------------ list states -- */

	add(
		"empty",
		"No conversations at all: an empty catalogue with nothing degraded.",
		["S4/empty"],
		() => ({
			projections: {},
		}),
	);

	add(
		"loading",
		"No frame has arrived yet: every API route holds its response and the streams stay silent with keepalives only.",
		["S4/loading", "S5/loading", "S13/loading"],
		() => ({
			projections: {},
			hold: { api: "forever" },
			stream: { mode: "keepalive-only" },
		}),
	);

	add(
		"idle",
		"One live conversation, idle, after a completed turn (the corpus capture).",
		["S4/populated", "S5/populated"],
		() => idleWorld(),
	);

	add(
		"many",
		"Twelve rows: pinned, streaming, needing attention, running subagents, a long name and a long cwd.",
		["S4/populated", "S4/populated-long", "S4/narrow"],
		() => {
			const streaming = projectionFrom(everyKind, {
				session_id: syntheticSessionId("streaming-row"),
				conversation_name: "Index the vendor catalogue",
				streaming: true,
				activity: "running read",
				activity_started_s: 12.5,
				version: 41,
			});
			const attention = projectionFrom(approvalFrame, {
				session_id: syntheticSessionId("attention-row"),
				conversation_name: "Clean up the staging bucket",
			});
			const subagents = projectionFrom(everyKind, {
				session_id: syntheticSessionId("subagent-row"),
				conversation_name: "Audit every service for retries",
			});
			const long = projectionFrom(liveIdle, {
				session_id: syntheticSessionId("long-row"),
				conversation_name: longName,
				cwd: longCwd,
			});
			const previous = projectionFrom(afterDeath, {
				session_id: syntheticSessionId("previous-row"),
				conversation_name: "Yesterday's sweep",
			});
			const projections = {
				[liveIdle.session_id]: structuredClone(liveIdle),
				[streaming.session_id]: streaming,
				[attention.session_id]: attention,
				[subagents.session_id]: subagents,
				[long.session_id]: long,
				[previous.session_id]: previous,
			};
			for (let i = 0; i < 6; i += 1) {
				projections[syntheticSessionId(`filler-${i}`)] = projectionFrom(
					liveIdle,
					{
						session_id: syntheticSessionId(`filler-${i}`),
						conversation_name: `Background job ${i + 1}`,
						streaming: false,
						version: 10 + i,
					},
				);
			}
			return { projections };
		},
	);

	add(
		"degraded",
		"The session record is fresh but its runtime is unreachable: the row carries its own receipt (`degraded: true`, the signal a phone-observed SIGSTOP produces) AND `subagents_running` is null while the row stays active.",
		["S4/degraded-row", "S5/degraded"],
		() => ({
			/* BOTH signals, and they are not alternatives. #23 added the ROW's own
			 * receipt (`SessionSummary.degraded`), which is what the list row reads;
			 * this branch's `S5/degraded` marker reads the PROJECTION's field. Serving
			 * one without the other leaves the other cell's state unreachable, which is
			 * the defect this fixture already carried once (review round 6, M3): the
			 * cell that declares the state could not carry the marker that affirms it. */
			projections: {
				[liveIdle.session_id]: projectionFrom(liveIdle, { degraded: true }),
			},
			rowOverrides: {
				subagents_running: null,
				subagents_queued: null,
				degraded: true,
			},
			stream: { mode: "silent" },
			// A command to an unreachable runtime sits until the relay's reply
			// window expires, then answers 504.
			hold: { commands: 15_000 },
		}),
	);

	add(
		"degraded-listing",
		'The durable catalogue could not be walked: `degraded: ["sessions"]` with rows still present.',
		["S4/degraded-listing"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			listOverrides: { degraded: ["sessions"] },
		}),
	);

	add(
		"degraded-attention",
		'The completion-receipt store could not be read: `degraded: ["attention"]`. Same cell as `degraded-listing` — the app renders the same banner for both, because the reader\'s question ("is this list complete?") is the same one.',
		["S4/degraded-listing"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			listOverrides: { degraded: ["attention"] },
		}),
	);

	add(
		"wedged",
		"A frozen runtime: the row reports real subagent counts until HEARTBEAT_TIMEOUT_S (45 s) has elapsed, then flips to null while `section` stays active. The two-sample comparison is the only signal.",
		["S4/degraded-row", "S13/degraded"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			// Before the timeout the registration is still vouched for.
			rowOverrides: { subagents_running: 0, subagents_queued: 0 },
			rowOverridesAfterHeartbeat: {
				subagents_running: null,
				subagents_queued: null,
			},
			heartbeatTimeoutS: fix.probe("heartbeat_timeout_s", 45),
			stream: { mode: "silent" },
		}),
	);

	add(
		"ended",
		"A finished conversation whose runtime is gone",
		["S4/ended", "S10/populated"],
		() => {
			const projection = structuredClone(afterDeath);
			return {
				projections: { [projection.session_id]: projection },
				rowOverrides: {
					section: "previous",
					streaming: false,
					// The durable re-materialisation publishes pid 0 with ended false;
					// the listing row is what says the conversation is over.
					completion_kind: "complete",
					unseen: false,
				},
				past: [
					{
						id: projection.session_id,
						name: projection.conversation_name,
						mtime: 1790727370.33,
						forked: false,
					},
				],
			};
		},
	);

	/* ------------------------------------------------------- session states -- */

	add(
		"streaming",
		"A turn in flight: assistant text grows frame by frame, then settles.",
		["S5/streaming"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			stream: { mode: "streaming", settleAfterTurns: 6 },
		}),
	);

	add(
		"aborted",
		"A turn stopped on purpose: `stop_reason: aborted` with `cut_off: false`, then a second run with `cut_off: true`.",
		["S5/aborted"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			stream: {
				mode: "streaming",
				settleAfterTurns: 3,
				settleStopReason: "aborted",
				settleCutOff: false,
			},
		}),
	);

	add(
		"queued",
		"One queued steering message and the tool row it skipped past.",
		["S5/queued"],
		() => ({
			/* The CAPTURE has `queued_count: 0`: the fixture was recorded after the queue
			 * drained, and the message it held is the `steer` row already in the
			 * transcript. The scenario's own name and description are "one queued steering
			 * message", so the count is served here — otherwise the cell that declares
			 * `queued` is the one cell that would never carry the marker for it. */
			projections: {
				[queuedFrame.session_id]: projectionFrom(queuedFrame, {
					queued_count: 1,
				}),
			},
		}),
	);

	add(
		"approval",
		"A pending approval gate with a real running tool row beneath it.",
		["S5/pending-approval", "S8/approval"],
		() => ({
			projections: {
				[approvalFrame.session_id]: structuredClone(approvalFrame),
			},
		}),
	);

	// The transcript's RICH rows. Without a scenario carrying them, the markdown the
	// native transcript renders specially — a fenced block (which owns the copy
	// control), a fenced diff, a table — is in no cell's DOM, so the copy button's box
	// and states cannot be measured by anything. The rows come from a synthetic
	// fixture built on a captured envelope; see its `provenance.how`.
	add(
		"rich-rows",
		"A transcript with a fenced code block, a fenced diff and two tables: the rows that own the copy control.",
		["S5/rich-rows"],
		() => ({
			projections: {
				[richRowsFrame.session_id]: structuredClone(richRowsFrame),
			},
		}),
	);

	add(
		"approval-destructive",
		"A pending approval whose detail is a destructive command, tool still composing.",
		["S8/approval"],
		() => ({
			projections: {
				[approvalExample.session_id]: structuredClone(approvalExample),
			},
		}),
	);

	add(
		"ask",
		"A pending secret ask: free-text, with options offered and one recommended.",
		["S5/pending-ask", "S8/ask"],
		() => ({
			projections: { [askFrame.session_id]: structuredClone(askFrame) },
		}),
	);

	add(
		"ask-multi",
		"The second of two questions in one pending ask, with a parallel count above one.",
		["S8/ask-multi"],
		() => {
			const projection = projectionFrom(askFrame, {
				pending: {
					...pendingOf(askFrame),
					question_index: 1,
					question_total: 2,
				},
				pending_count: 2,
			});
			return { projections: { [projection.session_id]: projection } };
		},
	);

	add(
		"subagent-running",
		"A running subagent with a queued sibling and a parked one, plus a detail route.",
		["S5/subagents", "S6/populated"],
		() => {
			const projection = structuredClone(everyKind);
			return {
				projections: { [projection.session_id]: projection },
				subagentDetail: "from-roster",
			};
		},
	);

	add(
		"subagent-completed",
		"A completed subagent carrying a result, with a blocked second child.",
		["S6/populated", "S6/populated-long"],
		() => {
			const base = structuredClone(everyKind);
			const projection = projectionFrom(base, {
				subagents: base.subagents.map((row, index) =>
					index === 0
						? {
								...row,
								status: "completed",
								progress: "",
								result_text: "Swept 214 files; 3 needed edits.",
								activity: "",
							}
						: row,
				),
			});
			return {
				projections: { [projection.session_id]: projection },
				subagentDetail: "from-roster",
			};
		},
	);

	add(
		"long-transcript",
		"A 520-row tool transcript: the case the projection's 80-row cap and degradation tiers exist for.",
		["S5/populated-long", "S5/scroll"],
		() => {
			const projection = projectionFrom(everyKind, {
				transcript: longTranscript(everyKind, 520),
			});
			return { projections: { [projection.session_id]: projection } };
		},
	);

	add(
		"long-names",
		"A 64-character conversation name, a deep cwd, and a 400-character pending question.",
		["S5/populated-long", "S4/populated-long", "S8/populated-long"],
		() => {
			const projection = projectionFrom(approvalFrame, {
				conversation_name: longName,
				cwd: longCwd,
				pending: {
					...pendingOf(approvalFrame),
					title: "Approve this command?",
					detail: "rm -rf "
						.concat("build/cache/".repeat(24))
						.concat(
							" — this removes every cached artefact for the reconciliation pipeline, and the rebuild takes about eleven minutes; approve only if the ledger mismatch is reproducible.",
						),
				},
			});
			return { projections: { [projection.session_id]: projection } };
		},
	);

	add(
		"empty-transcript",
		"A session that has just started: the seed projection, no rows.",
		["S5/empty"],
		() => {
			const projection = structuredClone(seed);
			return { projections: { [projection.session_id]: projection } };
		},
	);

	add(
		"every-entry-kind",
		"One row of every TranscriptEntry kind, for the renderer's fallback path.",
		["S5/populated"],
		() => ({
			projections: { [everyKind.session_id]: structuredClone(everyKind) },
		}),
	);

	/* ----------------------------------------------------------- past / search -- */

	add("past-empty", "No past conversations.", ["S10/empty"], () => ({
		projections: {},
		past: [],
	}));

	add(
		"past-populated",
		"Past conversations to resume, including a fork wearing its parent's title.",
		["S10/populated"],
		() => ({
			projections: {},
			past: fix.past("past-with-rows").sessions,
		}),
	);

	add("search-empty", "A search query with no results.", ["S4/empty"], () => ({
		projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
		search: fix.response("search-empty"),
	}));

	add(
		"search-hit",
		"A search with body-only matches, which must be marked as such.",
		["S4/populated"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			search: fix.response("search-hit"),
		}),
	);

	add(
		"models-ranked",
		"The full ranked model catalogue — order is the ranking, never re-sorted.",
		["S9/populated"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			models: rankedModels,
		}),
	);

	/* -------------------------------------------------------------- computers -- */

	add(
		"multi-computer",
		"Three computers: active, suspended and a second active one.",
		["S3/populated"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			tunnels,
		}),
	);

	add(
		"no-computers",
		"No computer is registered yet: the set-up path.",
		["S3/empty", "S2/empty"],
		() => ({
			projections: {},
			tunnels: [],
		}),
	);

	add(
		"billing-inactive",
		"The tunnel's billing is past due: the gateway refuses with `authorization_refused`.",
		["S13/error", "S2/error"],
		() => ({
			projections: {},
			failure: { surface: "gateway", key: "503-authorization_refused" },
			tunnels: tunnels.map((t) => ({
				...t,
				billing: { status: "past_due", accepted_monthly_price_usd: 0 },
			})),
		}),
	);

	add(
		"tunnel-revoked",
		"The tunnel was revoked: the gateway refuses with `tunnel_not_authorized`.",
		["S13/error"],
		() => ({
			projections: {},
			failure: { surface: "gateway", key: "503-tunnel_not_authorized" },
		}),
	);

	add(
		"login-required",
		"The computer's Radient login expired: gateway `login_required`, and the edge answers 401 with the re-auth hint.",
		["S13/error"],
		() => ({
			projections: {},
			failure: { surface: "gateway", key: "503-login_required" },
		}),
	);

	add(
		"relay-refuses-command",
		"A reachable relay that refuses the command: 422 with a typed code, which must never be retried as-is.",
		["S13/error"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			commandOverride: "op-slash-unknown",
		}),
	);

	add(
		"mid-session-401",
		"The stream comes up, carries the session, and then the edge refuses it: the reconnect is answered 401, so a CONNECTED session sits in its error state.",
		["S5/error"],
		() => ({
			/* `S5/error` declares the session's ERROR state, and the app paints `session-error`
			 * from `runtime.error` — which the stream's own `onError` sets AFTER the
			 * subscription is up (`use-session.ts`). A refused SUBSCRIBE never gets there:
			 * that is a connection state, and the app answers it with `connection-banner`.
			 * So the cell needs a stream that arrives and then fails, which is what this
			 * fault does (review round 8; QA measured the same shape on `idle`). */
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			stream: { mode: "idle" },
			faults: ["401-mid-session=2"],
		}),
	);

	add(
		"stream-refused",
		"The session's own event channel is refused at the gateway (`control_plane_unreachable`) while the catalogue and the health route answer: a refused subscription, which the app surfaces as a CONNECTION state.",
		[],
		() => ({
			/* No matrix cell declares "the connection was refused" — the honest marker for
			 * it is `connection-banner`, which the session cells that own the banner assert
			 * — so this state is reachable by name and carries no cell (review round 8).
			 * It stays because it is what a refused session really looks like, and because
			 * `S5/error` moved off it: a refused subscribe never sets `runtime.error`, so
			 * the error marker could not paint. */
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			stream: {
				mode: "refused",
				refusalKey: "503-control_plane_unreachable",
			},
		}),
	);

	/* ------------------------------------------------------- typed failure family -- */

	// Generated from the constants the gateway itself dumps, so a reason added
	// upstream shows up here without anyone remembering to add it.
	for (const reason of fix.gatewayReasons()) {
		add(
			`gateway-503-${reason}`,
			`Every request refused at the gateway with \`${reason}\`.`,
			["S13/error"],
			() => ({
				projections: {},
				failure: { surface: "gateway", key: `503-${reason}` },
			}),
		);
	}
	for (const key of [
		"502-relay-down",
		"502-unsafe-redirect",
		"503-relay-not-installed",
		"404-unknown-host",
		"413-too-large",
		"400-get-body",
	]) {
		add(
			`gateway-${key}`,
			`The gateway answers its own \`${key}\` body.`,
			["S13/error"],
			() => ({
				projections: {},
				failure: { surface: "gateway", key },
			}),
		);
	}
	for (const key of [
		"401-login-required",
		"401-invalid-session",
		"403-cross-origin",
		"404-unknown-tunnel",
		"413-too-large",
		"503-radient-unavailable",
		"503-tunnel-unavailable",
		"530-cloudflare-1033",
		"502-cloudflare-origin",
	]) {
		add(
			`edge-${key}`,
			`The edge worker answers \`${key}\` before the request reaches the relay.`,
			["S13/error"],
			() => ({
				projections: {},
				failure: { surface: "edge", key },
			}),
		);
	}

	add(
		"relay-down-at-gateway",
		"The relay is up but the gateway cannot reach it: a local, fixable fault, not 'offline'.",
		["S13/error"],
		() => ({
			projections: {},
			failure: { surface: "gateway", key: "502-relay-down" },
		}),
	);

	return scenarios;
}

/**
 * Names a caller may pass to `--scenario` that are NOT relay states.
 *
 * These are the *app's* connection states, and a test author will reasonably try
 * them: the app distinguishes "no tunnel", "computer offline" and "relay down"
 * in its copy, while the relay sees only the HTTP answer underneath. Resolving
 * them here is what makes the mock answer the state a person would name.
 */
export const AUTH_ALIASES: Record<string, string | null> = {
	// The app's own connection states, which are not relay states at all.
	"no-tunnel": "edge-530-cloudflare-1033",
	"computer-offline": "edge-530-cloudflare-1033",
	"relay-down": "gateway-502-relay-down",
	"wrong-password": null, // handled by --password, not a scenario
	"expired-session": "edge-401-login-required",
};

/**
 * Resolve a `--scenario` value through the aliases above.
 *
 * Returns the canonical scenario name, or the input unchanged when it is neither
 * an alias nor a scenario — the caller reports the unknown name. A `null` entry
 * throws here, naming why: an alias that silently did nothing would be worse
 * than no alias at all.
 */
export function resolveScenarioName(
	requested: string,
	scenarios: ScenarioRegistry,
): string {
	if (scenarios[requested] !== undefined) return requested;
	if (!(requested in AUTH_ALIASES)) return requested;
	const mapped = AUTH_ALIASES[requested];
	if (mapped === null || mapped === undefined) {
		throw new Error(
			`'${requested}' is not a relay state: it is an app-side state with no answer of its own. ` +
				"For the wrong-password case, pass a different --password.",
		);
	}
	if (scenarios[mapped] === undefined) {
		throw new Error(
			`alias '${requested}' points at '${mapped}', which is not a registered scenario`,
		);
	}
	return mapped;
}

export const scenarioNames = (scenarios: ScenarioRegistry): string[] =>
	Object.keys(scenarios).sort();
