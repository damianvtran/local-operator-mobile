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
	Capabilities,
	PastSession,
	PendingRequest,
	SessionProjection,
	SessionSummary,
	SttCapability,
} from "../../docs/relay/types.ts";
import type { Json } from "../lib/json.ts";
import { isRecord } from "../lib/json.ts";
import type { FixtureCorpus } from "./fixtures.ts";
import type { TranscribeAnswer } from "./transcribe.ts";
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
	/** What the growing assistant row grows INTO. `"table"` makes the frames a
	 *  markdown table arriving piece by piece instead of prose passes — the one
	 *  shape §4.1 #10 of the S5 design pass needs consecutive frames of. See
	 *  `sessionFrames`'s `tableArrival` for the tick order and why the divider
	 *  never arrives alone. */
	growth?: "table";
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
	hold?: { api?: "forever"; commands?: number; mutations?: "forever" };
	listOverrides?: { degraded?: string[] };
	/** Field overrides applied to every derived row; `null` means "not reported". */
	rowOverrides?: Record<string, SessionSummary[keyof SessionSummary]>;
	/** Overrides applied to ONE row, keyed by session id, on top of the blanket
	 *  `rowOverrides`. Exists because `unseen` is per conversation: a state that
	 *  needs some rows unread and some read (the §1.4 equality cell) cannot say
	 *  that with a blanket override. */
	rowOverridesById?: Record<string, Partial<SessionSummary>>;
	rowOverridesAfterHeartbeat?: Record<
		string,
		SessionSummary[keyof SessionSummary]
	>;
	past?: PastSession[] | FixtureOverride;
	search?: FixtureOverride;
	models?: Json[];
	/**
	 * The projects surface this state pins (S16, the read path).
	 *
	 * `list` replaces the `GET /api/projects` body and `detail` the key-scoped one;
	 * either may be a RECORDED RESPONSE (`FixtureOverride`) instead of a bare body,
	 * which is how a refusal cell drives a real status and body. Absent, the mock
	 * serves the captured six-project listing, and the key-scoped route answers the
	 * captured detail for the captured row's own id or name and the captured `404
	 * project_not_found` sentence for anything else — so a refusal cell is driven
	 * by the relay's real body rather than one this mock wrote.
	 */
	projects?: { list?: Json | FixtureOverride; detail?: Json | FixtureOverride };
	/**
	 * The voice-input surface this state pins — the only two answers a mic's
	 * visibility and one transcription upload need, and they must agree: a state
	 * that ADVERTISES a voice path is the state whose `POST /api/transcribe`
	 * answers `200`, and one that does not answers the `503` its hidden mic could
	 * never have reached.
	 */
	voice?: {
		/**
		 * The `capabilities.stt` block the list frame serves, replacing the block the
		 * captured `sessions-empty` fixture carries (`available: false`):
		 *
		 *  - an OBJECT advertises exactly that block, and the mic shows (§3.2);
		 *  - `null` OMITS the key entirely — the older-relay case the contract says
		 *    must read as unavailable, which is a DIFFERENT state from a block that
		 *    says `available: false` even though both hide the mic;
		 *  - absent (undefined) keeps the captured block.
		 */
		capability?: SttCapability | null;
		/** The success answer `POST /api/transcribe` returns when the capability is
		 *  available; `transcribe.ts`'s default stands in when this is absent. */
		answer?: TranscribeAnswer;
	};
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

/**
 * The list frame's `capabilities` block, with the scenario's own voice override
 * applied.
 *
 * Three outcomes, and the third is why this is a function rather than a spread:
 * an override of `null` must DELETE the key (the older-relay shape), not set it
 * to `null` — `{"stt": null}` is a key the contract does not describe, and a
 * client reading `capabilities.stt?.available` would see the same `undefined`
 * either way while a stricter reader of the wire would not. The `features` bag
 * is carried through untouched: this override is only ever about `stt`.
 */
export function capabilityBlock(
	base: Capabilities,
	override: ScenarioWorld["voice"],
): Capabilities {
	const next: Capabilities = structuredClone(base);
	if (override === undefined) return next;
	const stt = override.capability;
	if (stt === null) {
		delete next.stt;
		return next;
	}
	if (stt !== undefined) next.stt = stt;
	return next;
}

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

/**
 * A 520-row multi-turn conversation: thirteen turns, each one `user · 38 tool
 * rows · answer` rows.
 *
 * WHY TURNS AND NOT ONE LONG RUN OF TOOLS. This scenario is the transcript's
 * long case (the projection's 80-row cap and the render window's 500+ rows
 * budget), and since conversation condensing landed it is also the case that
 * proves a phone can keep the SHAPE of a long conversation: every completed
 * turn collapses to one summary bar once a newer turn exists, so the frames
 * from this world exercise the collapse at real depth. A single 520-row turn
 * cannot condense anything (the active turn never does), so the shape would be
 * the one thing this scenario could not show.
 *
 * Uniform on purpose — 13 x (1 + 38 + 1) = 520 exactly — because the number is
 * quoted in prose (`windowPolicy`'s comment, the geometry test, the e2e
 * README) and a scenario that quietly changed it would turn those into lies.
 */
function longConversation(
	base: SessionProjection,
	turns = 13,
	toolsPerTurn = 38,
): SessionProjection["transcript"] {
	const tool = base.transcript.find((entry) => entry.kind === "tool");
	const user = base.transcript.find((entry) => entry.kind === "user");
	const answer = base.transcript.find((entry) => entry.kind === "assistant");
	if (tool === undefined || user === undefined || answer === undefined) {
		// Without a template of each kind the builder would silently produce a
		// shorter or answer-less list, and every capture of it would look like a
		// pass for the states this scenario exists to feed.
		throw new Error(
			"the long-conversation base projection is missing a row to clone",
		);
	}
	const out: SessionProjection["transcript"] = [];
	for (let turn = 0; turn < turns; turn += 1) {
		const at = String(turn).padStart(2, "0");
		out.push({
			...structuredClone(user),
			id: `tc-conv-${at}-user`,
			text: PROMPTS[turn % PROMPTS.length] ?? "Continue the sweep.",
			// The template carries an image reference; the mock has no bytes to
			// serve for a fabricated row id, and a reference that can never resolve
			// renders as the app's unloadable-image treatment in every frame (a red
			// block the size of the bubble) — a defect the capture would rightly
			// flag. A fabricated conversation carries text only.
			images: [],
		});
		for (let step = 0; step < toolsPerTurn; step += 1) {
			const stepId = String(step).padStart(2, "0");
			out.push({
				...structuredClone(tool),
				id: `tc-conv-${at}-tool-${stepId}`,
				tool_call_id: `conv-${turn}-${step}`,
				tool_name: ["bash", "read", "edit", "glob", "grep"][step % 5] ?? "bash",
				// Settled states only: a condensed turn summarises work that FINISHED,
				// and a running row inside a completed turn would be a state no relay
				// can actually persist (`docs/relay/contract.md` — `interrupted` is the
				// default precisely because a call nobody saw return must not look done).
				tool_state: step % 9 === 4 ? "failed" : "done",
				summary: `turn ${turn + 1}, step ${step + 1}: sweeping the reconciliation ledger`,
				text: "",
				elapsed_s: ((step * 7) % 40) / 10,
				error: "",
				diff_added: step % 7 === 0 ? 12 : 0,
				diff_removed: step % 7 === 0 ? 3 : 0,
			});
		}
		out.push({
			...structuredClone(answer),
			id: `tc-conv-${at}-answer`,
			text: `Turn ${turn + 1} done: ${ANSWERS[turn % ANSWERS.length] ?? "ledger reconciled."}`,
		});
	}
	return out;
}

/** The opening messages, one per turn, in the register a real session has. */
const PROMPTS: readonly string[] = [
	"Reconcile last night's ledger and tell me what slipped.",
	"Now add retry backoff to the exporter.",
	"Write a test for the backoff, not just the happy path.",
	"Why did turn one miss the euro conversions?",
	"Fix the euro conversion rounding and note it in the changelog.",
	"Check the staging bucket for stale exports.",
	"Add the nightly sweep to the runbook.",
	"Which services still retry without jitter?",
	"Tighten the retry timeout and rerun the sweep.",
	"Summarise what changed this week for the standup.",
	"Draft the migration note for the ledger cutover.",
	"Re-run the reconciliation with the verbose flag.",
	"Close out the sweep and mark the task done.",
];

/** The closing answers, one per turn — short, the way a real answer reads. */
const ANSWERS: readonly string[] = [
	"three records were late, all from the same shard",
	"backoff added with full jitter",
	"seven cases covered, two of them failures",
	"the shard clock, not the maths",
	"rounding pinned to the ledger's own scale",
	"two stale files found and quarantined",
	"runbook updated with the 03:00 sweep",
	"four services, listed in the summary",
	"timeout halved, sweep clean in 6 minutes",
	"a short paragraph you can paste as-is",
	"the note is in docs/migration.md",
	"sweep verbose output attached below",
	"done — nothing left open",
];

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
	const tablesFrame = fix.projection("sse-projection-tables");
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
		["S4/idle", "S15/empty"],
		() => ({
			projections: {},
		}),
	);

	add(
		"loading",
		"No frame has arrived yet: every API route holds its response and the streams stay silent with keepalives only.",
		["S15/loading", "S5/loading", "S13/loading"],
		() => ({
			projections: {},
			hold: { api: "forever" },
			stream: { mode: "keepalive-only" },
		}),
	);

	add(
		"idle",
		"One live conversation, idle, after a completed turn (the corpus capture).",
		["S15/populated", "S5/populated"],
		() => idleWorld(),
	);

	add(
		"many",
		"Twelve rows: pinned, streaming, needing attention, running subagents, a long name and a long cwd.",
		/* `narrow` used to be declared beside `populated-long` (then `S4/narrow` ×
		 * `S4/populated-long`, re-homed to `S15/*` with the panel), and it was the same
		 * rendering under a second name: this scenario builds ONE world, both names navigate
		 * to the same route (`/conversations` at this head; `/` when the list was the landing),
		 * and the readiness table already aliases both names onto the list's single `populated`
		 * marker, so neither name had a look of its own.
		 * The identical-state check reported the pair as a COLLAPSE — the same bytes AND the
		 * same content, on iphone-se and tablet-landscape — and the remedy is the one
		 * `long-transcript`'s `S5/scroll`, `models-ranked`'s `S9/populated` and `approval`'s
		 * `S5/pending-approval` already take: remove the declaration, never an exemption,
		 * because an exemption is a signed statement that two DIFFERENT states are a limit of
		 * the camera, and this is one state wearing two names.
		 *
		 * `narrow` goes rather than `populated-long`, and the reasons are checkable rather
		 * than a preference. A width is an AXIS, not a state: the rubric's `narrow (320 pt)`
		 * is the `iphone-se` device this tier already captures for every cell, so a `narrow`
		 * CELL would re-declare the viewport inside the cell axis — the one axis the tier
		 * deliberately keeps whole. `populated-long` is a content variant the rubric names (a
		 * long session name, a long question) and the one `verify.ts`'s vocabulary enumerates.
		 * And `populated-long` has a second declaration (`long-names`) while `narrow`
		 * existed only here.
		 *
		 * The cost is named rather than papered over: no cell evidences the list under the
		 * `narrow` NAME. Nothing is unmeasured — the narrow viewport is captured at every cell
		 * by the device axis, and this scenario's rendering is still captured as
		 * `S15/populated-long` (the list's cells re-homed from S4 with the Part 2 panel) — so
		 * this is not a `PENDING_CELLS` gap and must not be recorded as one. */
		["S15/populated", "S15/populated-long"],
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
		"unread",
		"Three conversations: two carry unread notifications and one does not — the frame-level `unread` block (count 2) and the rows it describes, for the badge's equality cell (ADR 0006 §1.1-1.2).",
		/* The list's cells re-homed to `S15` with the panel on this branch, so #35's
		 * declaration — written against the sessions list's old home at `/` — names
		 * `S15/populated` here: `S4` is the composer home now. */
		["S15/populated"],
		() => {
			const unreadRow = projectionFrom(afterDeath, {
				session_id: syntheticSessionId("unread-row"),
			});
			const olderUnread = projectionFrom(
				fix.projection("sse_projection_ended"),
				{ session_id: syntheticSessionId("unread-older") },
			);
			const readRow = projectionFrom(liveIdle, {
				session_id: syntheticSessionId("read-row"),
			});
			return {
				projections: {
					[unreadRow.session_id]: unreadRow,
					[olderUnread.session_id]: olderUnread,
					[readRow.session_id]: readRow,
				},
				/* `rowFrom` defaults `unseen` to false — the listing row is what says — so
				 * the two unread conversations are marked per row here, leaving the
				 * third read: count 2 over 3 rows is the mixed case the equality test
				 * must survive (a count of all rows would pass a 2-of-2 fixture). */
				rowOverridesById: {
					[unreadRow.session_id]: { unseen: true, section: "active" },
					[olderUnread.session_id]: { unseen: true, section: "active" },
				},
			};
		},
	);

	add(
		"degraded",
		"The session record is fresh but its runtime is unreachable: the row carries its own receipt (`degraded: true`, the signal a phone-observed SIGSTOP produces) AND `subagents_running` is null while the row stays active.",
		["S15/degraded-row", "S5/degraded"],
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
		["S15/degraded-listing"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			listOverrides: { degraded: ["sessions"] },
		}),
	);

	add(
		"degraded-attention",
		'The completion-receipt store could not be read: `degraded: ["attention"]`. Same cell as `degraded-listing` — the app renders the same banner for both, because the reader\'s question ("is this list complete?") is the same one.',
		["S15/degraded-listing"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			listOverrides: { degraded: ["attention"] },
		}),
	);

	add(
		"wedged",
		"A frozen runtime: the row reports real subagent counts until HEARTBEAT_TIMEOUT_S (45 s) has elapsed, then flips to null while `section` stays active. The two-sample comparison is the only signal.",
		["S15/degraded-row", "S13/degraded"],
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
		["S15/ended", "S10/populated"],
		() => {
			const projection = structuredClone(afterDeath);
			return {
				projections: { [projection.session_id]: projection },
				rowOverrides: {
					section: "previous",
					streaming: false,
					/* The LISTING ROW is the receipt this cell reads: the pane paints
					 * `SessionSummary.ended` as the muted title and the word `ended`
					 * (`list-row.tsx`), and `rowFrom` derives no receipt from a projection —
					 * the durable frame above is the same death at the ref where it read
					 * `ended: false`. Without this override the row carried no `ended` at
					 * all, so `S15/ended` photographed as `S15/populated` — byte-identical
					 * at iphone-15-landscape / 200 %, where the one thing that differed
					 * elsewhere (the meta line) sits below the fold — and the
					 * identical-state check reported the collapse it exists to catch. The
					 * wire fact mirrors the live capture `http/list_row_ended.json`:
					 * `ended: true`, subagents null while the runtime is gone. */
					ended: true,
					/* The runtime is gone, so the relay cannot vouch for a count:
					 * `null` is "not reported" and must never be read as `0`
					 * (`docs/relay/contract.md` §3.2 — the pair the capture shows).
					 * `degraded` and `wedged` null the same pair for the same reason. */
					subagents_running: null,
					subagents_queued: null,
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

	/* The voice-input states. `voice` is the mic-VISIBLE frame the design round
	 * needs; the hidden look is not a second scenario because it is already
	 * every other scenario's: the captured block says `available: false`, so
	 * `S5/populated` IS the mic-hidden frame, and a dedicated cell would be the
	 * same bytes under a second name (the COLLAPSE the identical-state check
	 * exists to refuse). `voice-absent` declares no cell for the same reason —
	 * it differs from `available: false` on the WIRE, not on the screen — but it
	 * is the older-relay shape a client is most likely to get wrong, so it is
	 * pinnable and asserted rather than left to a unit mock. */

	add(
		"voice",
		"A live conversation whose relay advertises voice input: the composer shows the mic, and POST /api/transcribe answers the contract's success shape. Built on `idleWorld()` — the SAME world the `S5/populated` cell renders — so the visible/hidden pair differs by the mic and the capability block, and nothing else.",
		["S5/voice"],
		() => ({
			...idleWorld(),
			voice: {
				// A real `STT_BACKENDS` key, because the app stores the path the
				// upload RETURNS as `input_path` and never re-derives it.
				capability: {
					available: true,
					path: "provider_stt_radient",
					reason: "",
				},
				answer: {
					text: "Add a retry to the send path.",
					provider: "radient",
					model: null,
					path: "provider_stt_radient",
				},
			},
		}),
	);

	add(
		"voice-absent",
		"An older relay: `capabilities.stt` is OMITTED, which reads exactly like `available: false` (§3.2) — and `/api/transcribe` answers its 503, the race a hidden mic can still reach.",
		[],
		() => ({
			...idleWorld(),
			voice: { capability: null },
		}),
	);

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
		/* `S8/approval` ALONE. `S5/pending-approval` used to be declared beside it, and it
		 * was the same capture under a second name: `matrix.ts` gives S8 the session route
		 * (`/session/{sessionId}`) and `SCREEN_MARKER_SUBJECT` gives it the session subject,
		 * so a cell on either name navigates to the same URL against the same projection.
		 * The identical-state check caught it the moment every cell was captured — a
		 * collapse, i.e. the same bytes AND the same content, on iphone-se and
		 * tablet-landscape — and the remedy is the one `models-ranked`'s `S9/populated` and
		 * `long-transcript`'s `S5/scroll` already take: remove the declaration, never an
		 * exemption, because an exemption is a signed statement that two DIFFERENT states
		 * are a camera limit and this is one state wearing two names. S8 keeps the name
		 * because the pending card is what that surface is named for, and it is also the
		 * cheaper side to keep: dropping `S8/approval` instead would leave
		 * `approval-destructive`'s declaration as the only one serving the name, silently
		 * re-pointing this cell at the destructive card. The cost is that the SESSION view
		 * (S5) no longer declares the pending-approval state under its own name; the
		 * rendering is unchanged and still captured, and the gap is named in the PR. */
		["S8/approval"],
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

	/* The hero tables: one priced to fit the rail exactly and one three-column
	 * 64-character digest table. The pair is what the S5 table checks need in ONE
	 * state: `S5/tables` shows both directions of the scroll affordance (the wide
	 * table's fade + cut edge, and the fitting table's silence), and `S5/tables-end`
	 * re-renders the same state with the wide table scrolled to its end via the
	 * `lo-md-scroll` viewer hook, where the left-mirror fade and the retired right
	 * fade have a frame. Two cells over ONE projection, so the scroll pair cannot
	 * drift apart. See `sse-projection-tables.json`'s provenance for the arithmetic. */
	add(
		"tables",
		"A transcript ending in two tables: one priced to fit the rail exactly (no cue may appear) and a 3x64-character digest table that overflows, bleeds and cues.",
		["S5/tables", "S5/tables-end", "S5/tables-in-view"],
		() => ({
			projections: {
				[tablesFrame.session_id]: structuredClone(tablesFrame),
			},
		}),
	);

	/* The table that ARRIVES: the same primitives as `tables`, grown one row per
	 * frame with the divider and the first row in one tick (`growth: "table"`).
	 * Consecutive frames of this cell are §4.1 #10's evidence that the table does
	 * not reflow the row as its cells arrive.
	 *
	 * `intervalMs: 150` and `settleAfterTurns: 80` (review rounds 1–2): at the
	 * default 700 ms pump every tick landed outside the capture's fixed frame
	 * offsets, so the cell's frame set sampled no arrival at all; the faster pump
	 * fixed that but ended the state in under a second, and BOTH the capture's
	 * 8 s settled stamp and the audit's re-drive window (it reads the marker
	 * around 1.2 s in) then landed after the stream was over — the records read
	 * unready and the re-drive could not reproduce the state (measured: all eight
	 * combos BLOCKED). Eighty turns at 150 ms keep `session-streaming` true for
	 * twelve seconds, covering every reader's window, while the content stops
	 * growing after the fourth row — the windows moved, not the cell's render.
	 *
	 * What the consecutive frames show (review rounds 2–3, D4): `-f0` is the
	 * pre-first-paint blank, and the `-f250` → `-settled` pair is §4.1 #10's
	 * evidence — no reflow between the first painted frame and the settled
	 * one. A stamp's position against the stream depends on the boot, which
	 * is why the durable claim is the pair's, not one frame's, and why this
	 * comment does not claim a particular frame catches a particular tick. */
	add(
		"tables-streaming",
		"A streaming turn whose answer introduces a table: the divider and the first row land in one frame, then the rows arrive one per frame.",
		["S5/streaming-tables"],
		() => ({
			projections: {
				[tablesFrame.session_id]: structuredClone(tablesFrame),
			},
			stream: {
				mode: "streaming",
				settleAfterTurns: 80,
				growth: "table",
				intervalMs: 150,
			},
		}),
	);

	/* The `send` tool's delivery states: the desktop tool row's four-state arm
	 * (local-operator-ui #719) as the phone renders it (local-operator PR #1855
	 * is the vocabulary's source). The rows carry the same `details.delivery`
	 * payload the real result attaches (`DeliveryOutcome.details()`), with the
	 * core's own sentences as the output text; the LAST row is a PRE-FIELD send
	 * — no `delivery` key at all — so one frame shows what a relay that
	 * predates the field sends beside what this client renders when the field
	 * arrives. */
	add(
		"send-delivery",
		"A transcript where cross-session sends settled in each delivery state — delivered, wake unconfirmed, delivery unconfirmed, not delivered — beside a pre-field send row with no `details.delivery`.",
		["S5/send-delivery"],
		() => {
			const base = structuredClone(everyKind);
			const template = base.transcript.find((entry) => entry.kind === "tool");
			if (template === undefined) {
				throw new Error(
					"the send-delivery base projection has no tool row to clone",
				);
			}
			type Row = SessionProjection["transcript"][number];
			const sendRow = (
				id: string,
				summary: string,
				overrides: Partial<Row>,
			): Row => ({
				...structuredClone(template),
				id: `tc-${id}`,
				tool_call_id: id,
				tool_name: "send",
				tool_state: "done",
				text: "",
				summary,
				intent: "",
				diff_added: 0,
				diff_removed: 0,
				elapsed_s: 5.1,
				error: "",
				images: [],
				final: true,
				text_complete: true,
				details: {},
				...overrides,
			});
			const projection = projectionFrom(base, {
				conversation_name: "Release sweep",
				transcript: [
					{
						...structuredClone(template),
						id: "m-send-1",
						kind: "user",
						tool_call_id: "",
						tool_name: "",
						tool_state: "interrupted",
						text: "Send the sweep results out and tell me how they landed.",
						summary: "",
						intent: "",
						details: {},
						images: [],
					},
					sendRow("delivered", "→ release-owner · nightly sweep is green", {
						details: {
							delivery: {
								state: "delivered",
								message_id: "peer-9f31c0d2a4b8e6f70918273645546372",
								wake: false,
								attempts: 1,
								cause: "",
								route: "direct",
							},
							output: "delivered (id peer-9f31c0d2a4b8e6f70918273645546372)",
						},
					}),
					sendRow("mailbox", "→ nightly-audit · ledger check", {
						details: {
							delivery: {
								state: "mailbox",
								message_id: "peer-1a2b3c4d5e6f708192a3b4c5d6e7f809",
								wake: true,
								attempts: 3,
								cause: "no wake ack",
								route: "direct",
							},
							output:
								"delivered to its mailbox (id peer-1a2b3c4d5e6f708192a3b4c5d6e7f809) — the wake was not acknowledged within 5s after 3 attempts. It will read the message on its next turn; do not send it again.",
						},
					}),
					sendRow("unconfirmed", "→ build-mini · cache flush", {
						details: {
							delivery: {
								state: "unconfirmed",
								message_id: "peer-2b3c4d5e6f708192a3b4c5d6e7f8091a",
								wake: true,
								attempts: 3,
								cause: "no answer",
								route: "direct",
							},
							output:
								"delivery unconfirmed (id peer-2b3c4d5e6f708192a3b4c5d6e7f8091a) — no answer within 5s after 3 attempts and the message is not yet in its transcript. It may still arrive once its loop turns. Check the target's transcript before resending; sending again may deliver it twice.",
						},
					}),
					sendRow("failed", "→ nightly-sweep · stop the run", {
						tool_state: "failed",
						error:
							"no delivery confirmation from nightly-sweep: the peer is not running. The message was not delivered.",
						details: {
							delivery: {
								state: "failed",
								message_id: "peer-3c4d5e6f708192a3b4c5d6e7f8091a2b",
								wake: true,
								attempts: 1,
								cause: "the peer is not running",
								route: "direct",
							},
							output: "",
						},
					}),
					/* The pre-field row: what a relay that predates `details.delivery`
					 * sends, and the frame's own before/after pair — the four rows above
					 * are the arm, this one is the row without it. */
					sendRow("prefield", "→ release-owner · status note", {
						details: {
							output: "delivered (id peer-4d5e6f708192a3b4c5d6e7f8091a2b3c)",
						},
					}),
				],
			});
			return { projections: { [projection.session_id]: projection } };
		},
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
		/* `S8/ask` alone, for the reason `approval` records above: `S5/pending-ask`
		 * navigated to the same route with the same projection, so the pair was one state
		 * under two names and the identical-state check reported it as a byte-identical
		 * pair as soon as every cell was captured. The SESSION view loses the name, not
		 * the rendering. */
		["S8/ask"],
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
		"A 520-row multi-turn conversation: thirteen completed turns of tool work, so the transcript has both its long case (the projection's 80-row cap and degradation tiers) and turns to condense.",
		/* `S5/populated-long` ALONE, and the second cell it declared is not a declaration the
		 * relay can honour. This scenario builds ONE projection and both of its cells were
		 * pinned from it, so `S5/scroll` was `S5/populated-long` rendered from the same
		 * projection at the same viewport: the identical-state check reported the pair on the
		 * ci tier (light, iphone-se and tablet-landscape) and the readiness table already
		 * aliases `scroll` onto `populated`. A scroll POSITION is a viewport interaction, not
		 * a state the wire can declare — driving the two apart needs a scroll action or an id
		 * the app itself exposes — so the duplicate name goes the way
		 * `S2/error` went from `billing-inactive`. The coverage it claimed (a cell evidencing
		 * a scrolled transcript) is named as a gap in the PR rather than papered over with an
		 * exemption: an exemption is for two states a camera cannot tell apart, and this is
		 * one state wearing two names.
		 *
		 * The two path cells beside it are that id, now that the app exposes one: a settled
		 * frame of any session cell lands at the TAIL (the list follows new content), and the
		 * tail of a long conversation is the ACTIVE turn — the one turn condensing never
		 * touches — so without pinning the viewport the collapse itself has no still.
		 * `lo-scroll=top` renders the list at its first row; `lo-expand` opens one named
		 * turn, because the reader's open is a tap the capture cannot drive. The cells are
		 * declared here, in the scenario that owns the conversation, so the tier counts keep
		 * reading off the registry rather than a second hand-maintained list. */
		[
			"S5/populated-long",
			"path:/session/{sessionId}?lo-scroll=top/condensed",
			"path:/session/{sessionId}?lo-scroll=top&lo-expand=tc-conv-00-user/expanded",
		],
		() => {
			const projection = projectionFrom(everyKind, {
				transcript: longConversation(everyKind),
			});
			return { projections: { [projection.session_id]: projection } };
		},
	);

	add(
		"long-names",
		"A 64-character conversation name, a deep cwd, and a 400-character pending question.",
		["S5/populated-long", "S15/populated-long", "S8/populated-long"],
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

	/* --------------------------------------------------------------- projects -- */

	add(
		"projects-empty",
		"No projects yet: the listing answers an empty array, so the screen must show its own empty state rather than nothing.",
		["S16/empty"],
		() => ({ projects: { list: { projects: [] } } }),
	);

	add(
		"projects-loading",
		"No project read has been answered yet: every API route holds its response open and the streams stay silent with keepalives only.",
		["S16/loading", "S16-detail/loading"],
		/* `keepalive-only` as well as the held reads: the harness asserts a scenario
		 *  filling a `loading` cell streams NO frame, and a stream that pushes one
		 *  would make `S16/loading` a state that had in fact heard from the relay. */
		() => ({ hold: { api: "forever" }, stream: { mode: "keepalive-only" } }),
	);

	add(
		"projects-populated",
		"The six-project seeded store, and one project's composed detail with a live and a stopped link — plus every lifecycle WRITE surface, which is this same world with a control pressed.",
		[
			"S16/populated",
			"S16-detail/populated",
			/* The write surfaces are reached by PRESSING a control, declared per cell
			 *  in `CELL_OPENERS` (`tools/visual/matrix.ts`) and replayed by the audit's
			 *  re-drive. One world, several cells: a cell here is a STATE, and "the
			 *  create sheet is open over the listing" is a state of this listing. */
			"S16/create",
			"S16/create-filled",
			"S16/create-refused",
			"S16-detail/milestone-editor",
			"S16-detail/milestone-remove",
			"S16-detail/slash",
			"S16-detail/delete-confirm",
		],
		() => ({}),
	);

	add(
		"projects-write-busy",
		"A project write IN FLIGHT: the relay reads the body and never answers it, which is the only honest source of the in-flight state — the app is mid-write, not asked to pretend.",
		["S16/create-busy", "S16-detail/busy"],
		/* `hold.mutations`, not `hold.api`: a cell whose listing read were held too
		 *  would render the loading skeleton instead of the surface under test. */
		() => ({ hold: { mutations: "forever" } }),
	);

	add(
		"projects-unknown-status",
		"A listing carrying a status this build has never heard of: it takes its own trailing section rather than vanishing.",
		["S16/unknown-status"],
		() => {
			/* Built from the CAPTURED listing rather than hand-written: a row that did
			 *  not carry the relay's own field set would make this cell measure a shape
			 *  the wire never sends. One row's status is replaced with a word none of
			 *  the relay's seven statuses is, and its name makes it obvious which one. */
			const listing = fix.record("projects-list");
			const rows = Array.isArray(listing.projects) ? listing.projects : [];
			const unknown = rows.find(
				(row) => isRecord(row) && row.status === "done",
			);
			const patched = rows.map((row) =>
				row === unknown && isRecord(row)
					? {
							...row,
							name: "vendor-blocker",
							status: "escalated",
						}
					: row,
			);
			return { projects: { list: { projects: patched } } };
		},
	);

	add(
		"projects-refused",
		"The key-scoped read for a project the store does not hold: the relay's own 404 sentence, with its near-miss name.",
		["S16-detail/refused"],
		() => {
			/* The REFUSAL IS THE CAPTURED ONE: the 404 body is read out of the corpus and
			 *  re-sent with its recorded status, so the sentence the screen renders is a
			 *  sentence the relay actually wrote. Writing a plausible one here would make
			 *  the cell assert this mock's copy rather than the daemon's. */
			const notFound = fix.response("projects-not-found");
			return {
				projects: {
					detail: {
						status: notFound.status,
						headers: notFound.headers,
						json: notFound.json,
					},
				},
			};
		},
	);

	/* The two search scenarios carry RESPONSE fixtures (a search request's answer);
	 *  what a capture of the panel renders without a typed query is the one live
	 *  row both worlds declare, so the cell they fill is the populated one. The
	 *  empty-search STATE is reachable only by typing — it has its own marker
	 *  (`sidebar/empty-search`) and is asserted by the flow that types, not by a
	 *  capture. */
	add(
		"search-empty",
		"A search query with no results.",
		["S15/populated"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			search: fix.response("search-empty"),
		}),
	);

	add(
		"search-hit",
		"A search with body-only matches, which must be marked as such.",
		["S15/populated"],
		() => ({
			projections: { [liveIdle.session_id]: structuredClone(liveIdle) },
			search: fix.response("search-hit"),
		}),
	);

	add(
		"models-ranked",
		"The full ranked model catalogue — order is the ranking, never re-sorted.",
		/* NO CELL, and that is the honest count. This scenario served `S9/populated`, and
		 * `S9/populated` was never a state of its own: the sheets are modals the app opens
		 * from the composer, nothing on the wire opens one, and the harness reaches a screen
		 * only by URL — so the cell navigated to the session route, declared the SESSION's
		 * own populated marker (`S9` → `session` in `SCREEN_MARKER_SUBJECT`), and rendered
		 * byte-identically to `S5/populated`. Measured 2026-10-03 on the full tier: the
		 * capture reported `S5/populated = S9/populated` as a cross-cell collapse, which is
		 * the check working — two declared states, one state. Removing the declaration is the
		 * same remedy `billing-inactive` takes below, and it costs the SHEETS surface its only
		 * cell: giving it a real one needs a way to drive a sheet into view (an app-side
		 * affordance or an id the app declares for the open sheet), which is a change this
		 * harness cannot make for itself. The scenario stays because the ranked catalogue is
		 * still part of the relay's contract and `verify.ts` exercises it. */
		[],
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
		/* `S13/error` ALONE, and the second cell it used to declare is not a
		 * declaration the app can honour. `/tunnels` renders ONE refusal surface for
		 * every gateway cause — `S2`, `S3` and `S13` are the same screen
		 * (`computers-screen`, `SCREEN_MARKER_SUBJECT` in `tools/lib/readiness.ts`) and
		 * `STATE_MARKER.computers` declares exactly one state, `error`. So `S2/error`
		 * and `S13/error` were one state under two names, and the capture run reported
		 * them as a cross-cell collapse on all 26 frames of the core tier — the exact
		 * finding the identical-state check exists to make, raised against a
		 * declaration that never named a second state. The rubric is what settles it:
		 * `docs/ux/audit-rubric.md` §1 gives S2 the states "no tunnel yet; waiting;
		 * connected" and gives the refusal to S13 ("connection loss, re-auth, relay
		 * refusal"), so the error state belongs to the screen the rubric names for it. */
		["S13/error"],
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
