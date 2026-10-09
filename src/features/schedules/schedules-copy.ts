/**
 * The Schedules surface's vocabulary — everything the screen says, in one
 * pure module (no React, no React Native: every function is a reading of the
 * wire).
 *
 * WHY ONE MODULE. A schedule row is a small set of facts, and several of them
 * are already spoken somewhere else: the CLI's `lop wake status` and `lop
 * monitor list` render the same instants and states, and the desktop's
 * Schedules page and run pane render the same rows. Each clause below is
 * either a PORT of the surface that already owns it, or new copy with the
 * constraint written down:
 *
 *  * `dueLabel` is a port of `cli._format_due` — `in 4m` / `2h overdue`, "the
 *    relative form a reminder is read in" — so the same instant reads the
 *    same on the phone and in the terminal. The desktop renders ABSOLUTE local
 *    clocks because its panes do not tick (a relative age would silently
 *    age); the phone's screen ticks once a minute (the conversations pane's
 *    own idiom), so the relative form stays true here.
 *  * `formatWakeDuration` is a port of the TUI's `wake.py::format_duration`
 *    (`1h30m`, `1w`, `45s`), reached via the desktop's `formatWakeDuration`.
 *    Two spellings of one number is how a desktop and a terminal come to
 *    disagree about one session's same fact.
 *  * `wakeCadence` follows the desktop's `formatWakeCadence`: `once`, `every
 *    1d`, `every 1d · 3 left`, `every 1d · no deliveries left`. `remaining` is
 *    `limit - fired_count` floored at 0, the same expression the backend clamps
 *    a delivery budget with (`harness/wake.py::missed_occurrences`:
 *    `max(limit - fired_count, 0)`; `advance_wake_schedule` retires a spent
 *    schedule at `fired >= limit`), never a second opinion.
 *  * The supervisor sentences come from the desktop's `supervisorLead`
 *    verbatim, including the ORDER: a store the probe cannot speak for
 *    reports `supported: false` AND `verifiable: false`, and the platform
 *    sentence has to win or a Linux user reads a launchd sentence.
 *  * `PARKED_CLAUSE` is the desktop's, kept verbatim including the measured
 *    fact behind it: a stop parks a conversation's wakes until its NEXT TURN
 *    (opening it is not enough — round-2 U9), which is why the sentence does
 *    not say "when you open it". The GONE clause is the phone's own and is a
 *    deliberate split from the desktop: the desktop collapses `dormant ||
 *    ghost` into "Parked", but the supervisor and the CLI both treat ghost as
 *    the STRONGER, distinct fact ("with no session on disk, nothing can fire
 *    this at all" — `wakes/supervisor.py`, round 3 R11), and "wakes resume
 *    after its next turn" is false of a conversation that no longer exists.
 *
 * THE THREE ANSWER STATES (the point of the whole surface): "nothing is
 * armed", "this process could not read the store", and "the list is bounded"
 * are three different claims, and each has its own clause here:
 *
 *  * `readErrorClause(family)` — the store could not be read. NEVER render it
 *    as an empty list.
 *  * `truncatedClause(family, shown, total)` — the listing was capped; say
 *    which slice is shown rather than implying the store holds only that.
 *  * the empty state exists only when BOTH families read OK and are empty
 *    (`schedulesEmpty`), so an unreadable store can never produce it.
 */

import type {
	ScheduleMonitorEntry,
	ScheduleMonitorListing,
	ScheduleMonitorRow,
	ScheduleSupervisorInfo,
	SchedulesResponse,
	ScheduleWakeEntry,
	ScheduleWakeListing,
	ScheduleWakeRow,
} from "@/contracts";
import { isRelayError } from "@/relay";

/* --------------------------------------------------------------- durations */

/**
 * An interval as the TUI spells it: `1h`, `45s`, `1h30m`, `1w` — a port of
 * `local_operator/harness/wake.py::format_duration` (via the desktop's
 * `formatWakeDuration`, which carries the same two rules):
 *
 * - exact single unit first, but only at the largest unit the value reaches —
 *   `8h30m` is also exactly `510m` and reads nothing like what was asked for;
 * - two terms at most, the second a natural count of its unit, so `30m` rather
 *   than `1h90m`.
 */
export const formatWakeDuration = (ms: number): string => {
	const units: ReadonlyArray<readonly [string, number]> = [
		["w", 604_800_000],
		["d", 86_400_000],
		["h", 3_600_000],
		["m", 60_000],
		["s", 1_000],
	];
	for (const [index, [unit, step]] of units.entries()) {
		if (ms < step) continue;
		if (ms % step === 0) return `${ms / step}${unit}`;
		const head = Math.floor(ms / step);
		const remainder = ms % step;
		for (const [smaller, subStep] of units.slice(index + 1)) {
			if (remainder % subStep !== 0) continue;
			const quotient = remainder / subStep;
			const cap = smaller === "s" ? 60_000 / subStep : step / subStep;
			if (quotient < cap) return `${head}${unit}${quotient}${smaller}`;
		}
		break;
	}
	return `${ms}ms`;
};

/**
 * The relative form a due instant is read in: `in 4m` / `2h overdue` — a port
 * of `cli._format_due`, thresholds and all (under 90 s in seconds, under
 * 90 min in minutes, under 48 h in hours, else days).
 *
 * `seconds` is the signed distance from now: positive = still ahead, negative
 * = overdue. The CLI's word for a negative value is `overdue` and the phone
 * keeps it — "late" or "missed" would be a second word for a state the
 * terminal already names.
 */
export const dueLabel = (seconds: number): string => {
	const overdue = seconds < 0;
	const magnitude = Math.abs(seconds);
	let text: string;
	if (magnitude < 90) {
		text = `${Math.floor(magnitude)}s`;
	} else if (magnitude < 5_400) {
		text = `${Math.floor(magnitude / 60)}m`;
	} else if (magnitude < 172_800) {
		text = `${Math.floor(magnitude / 3_600)}h`;
	} else {
		text = `${Math.floor(magnitude / 86_400)}d`;
	}
	return overdue ? `${text} overdue` : `in ${text}`;
};

/* -------------------------------------------------------------- count copy */

/** `1 wake` / `2 wakes` — the desktop's `wakeCountClause`, verbatim. */
export const wakeCountClause = (count: number): string =>
	count === 1 ? "1 wake" : `${count} wakes`;

/** `1 monitor` / `2 monitors` — the twin of `wakeCountClause`. */
export const monitorCountClause = (count: number): string =>
	count === 1 ? "1 monitor" : `${count} monitors`;

/**
 * The head clause's instant tail: the desktop's own `· next <label>` splice,
 * over the phone's RELATIVE label (`dueLabel`).
 *
 * WHY "next" DROPS WHEN OVERDUE. The desktop splices `next` onto an absolute
 * clock (`next 2:14 PM EDT`) — a noun phrase with no tense, reading the same
 * before and after the instant. The phone's label is relative, and once the
 * instant is past it reads `8d overdue`; splicing `next` onto that would say
 * `next 8d overdue`, a forward word against a past one (design round 1,
 * D64-3). So the phone drops `next` when the instant has passed: `3 wakes ·
 * 8d overdue`. Composition only — the label itself is the CLI's vocabulary,
 * unchanged.
 */
export const nextDueClause = (countClause: string, seconds: number): string => {
	const label = dueLabel(seconds);
	return seconds < 0
		? `${countClause} · ${label}`
		: `${countClause} · next ${label}`;
};

/* --------------------------------------------------------- the two clauses */

/**
 * The parked clause, which replaces the count and the next instant on a wake
 * entry (the desktop's `PARKED_CLAUSE`; see the module header for the
 * measured fact it encodes).
 */
export const PARKED_WAKES_CLAUSE = "Parked — wakes resume after its next turn";

/** The monitor side of the parked clause: monitors tick while the
 *  conversation runs, so a stopped conversation pauses them until it runs
 *  again (the monitor store's own semantics — dormancy is the honest state,
 *  and monitors never engage a cold session, §10.4). */
export const PARKED_MONITORS_CLAUSE =
	"Parked — monitors resume when its conversation runs again";

/** The ghost clauses. See the module header for why the phone splits ghost
 *  from parked where the desktop collapses them. */
export const GONE_WAKES_CLAUSE =
	"Gone — its conversation is no longer on this machine, so nothing fires";
export const GONE_MONITORS_CLAUSE =
	"Gone — its conversation is no longer on this machine, so nothing checks";

/* ----------------------------------------------------------- the supervisor */

/**
 * The one sentence that says whether anything will actually fire, and picks
 * the reason — the desktop's `supervisorLead`, verbatim (order included; see
 * the module header). `""` when nothing needs saying: a supported, running,
 * verifiable supervisor is the quiet case.
 *
 * `verifiable === false` is the sandbox / foreign-store case: `supported` and
 * `running` describe SOMEBODY ELSE's launchd there, so the sentence must not
 * claim "not running" about a domain the probe never looked at.
 */
export const supervisorLead = (supervisor: ScheduleSupervisorInfo): string => {
	if (!supervisor.supported) {
		return "Wakes are not supervised on this platform yet, so the wakes below only fire while a conversation is running.";
	}
	if (supervisor.verifiable === false) {
		return "Nothing supervises the wakes below, so they only fire while their conversation is running.";
	}
	if (!supervisor.running) {
		return "The wake supervisor is installed but not running, so the wakes below will not fire.";
	}
	return "";
};

/** Whether the supervisor's verdict is "something will fire these": the
 *  desktop's `canFire`, all three terms (`verifiable !== false` because an
 *  absent field reads as "the probe can speak"). */
export const supervisorFires = (supervisor: ScheduleSupervisorInfo): boolean =>
	supervisor.supported && supervisor.running && supervisor.verifiable !== false;

/* ------------------------------------------------------------ the families */

/**
 * A family's own answer state, before any rendering: the four states the
 * screen must keep apart for EACH of wakes and monitors.
 *
 * `read_error` is checked FIRST and is terminal for the family: a store that
 * could not be read has no entries to show and must never fall through to the
 * empty clause. `empty` is only claimed when the store WAS readable and holds
 * nothing.
 */
export type FamilyState = "unreadable" | "empty" | "ready";

export const familyState = (
	listing: ScheduleWakeListing | ScheduleMonitorListing,
): FamilyState => {
	if (listing.read_error) return "unreadable";
	if (listing.entries.length === 0) return "empty";
	return "ready";
};

/** The unreadable strip's sentence, one per family. Deliberately says what
 *  failed rather than "no schedules": the two must never read alike, and the
 *  family is named so a half-readable machine still shows which half failed. */
export const readErrorClause = (family: "wakes" | "monitors"): string =>
	family === "wakes"
		? "The wakes on this machine could not be read."
		: "The monitors on this machine could not be read.";

/**
 * The bounded-listing strip, the desktop's own shape ("Showing N of M
 * conversations with wakes."): entries are the slice shown, `total` is what
 * the store holds, and the sentence states the slice rather than implying the
 * store holds only what was sent.
 */
export const truncatedClause = (
	family: "wakes" | "monitors",
	shown: number,
	total: number,
): string =>
	`Showing ${shown} of ${total} conversations with ${family === "wakes" ? "wakes" : "monitors"}.`;

/* ------------------------------------------------------------ empty state */

/**
 * Whether the screen may say "nothing is armed".
 *
 * BOTH families must have settled readable and empty: the one predicate
 * behind the empty state, so a store that could not be read (either family)
 * can never render as "nothing is armed" — the defect this surface exists to
 * avoid, one level up. `SchedulesResponse` is only reached when the read
 * itself answered.
 */
export const schedulesEmpty = (payload: SchedulesResponse): boolean =>
	familyState(payload.wakes) === "empty" &&
	familyState(payload.monitors) === "empty";

export const NOTHING_ARMED_TITLE = "Nothing is armed";
export const NOTHING_ARMED_BODY =
	"Ask an agent in chat to do something on a regular basis and it will appear here. Wakes fire a prompt into a conversation at a time; monitors watch one thing and report what changes.";

/* ------------------------------------------------------------ wake rows */

/** One wake schedule as the screen draws it. */
export type WakeLineView = {
	id: string;
	message: string;
	/** `once` / `every 1d` / `every 1d · 3 left` (bounded recurrences). */
	cadence: string;
	/** The due slot: `in 4m`, `2h overdue`, `stale`, or `""` when the entry is
	 *  parked/gone and its instants are not fireable. */
	due: string;
	/** Past the supervisor's staleness bound: nothing will fire it until the
	 *  conversation is next opened. Rendered in the alert tone. */
	stale: boolean;
};

/** One wake-carrying conversation as the screen draws it. */
export type WakeEntryView = {
	sessionId: string;
	name: string;
	cwd: string;
	/** The head clause: `2 wakes · next in 1h` (`3 wakes · 8d overdue` once
	 *  the instant has passed), or the parked/gone sentence, which REPLACES
	 *  count and instant (neither is fireable). */
	clause: string;
	parked: boolean;
	ghost: boolean;
	rows: WakeLineView[];
	/** Rows beyond the per-entry cap, surfaced by the row's own control. */
	hidden: number;
};

/** The full wake line for one schedule row. `suppressed` is the entry's
 *  parked/gone verdict: the stored instant will not fire and is not even the
 *  instant that would fire after a resume, so it is replaced by "" (the
 *  desktop's own suppression rule, applied to its wake lines). */
export const wakeLineView = (
	row: ScheduleWakeRow,
	nowMs: number,
	suppressed: boolean,
): WakeLineView => {
	const remaining =
		row.limit === null ? null : Math.max(row.limit - row.fired_count, 0);
	return {
		id: row.id,
		message: row.message,
		cadence: wakeCadenceWord(row.every_ms, remaining),
		/* A spent budget carries NO due slot (the desktop's QA round 1, Q1): the
		 * last delivery fired at `next_due_at`, the supervisor retires the
		 * schedule on its next pass, and printing the instant in that window
		 * would promise a fire the schedule has no budget for. The cadence
		 * already says "no deliveries left". */
		due: suppressed || remaining === 0 ? "" : wakeDueWord(row, nowMs),
		stale: row.stale,
	};
};

/** `once` / `every 1d` / `every 1d · 3 left` / `every 1d · no deliveries
 *  left` — the desktop's `formatWakeCadence` clauses, one for one (a spent
 *  budget is named as spent: `0 left` would promise a fire that is not
 *  coming). */
export const wakeCadenceWord = (
	everyMs: number | null,
	remaining: number | null,
): string => {
	if (everyMs === null) return "once";
	const cadence = `every ${formatWakeDuration(everyMs)}`;
	if (remaining === null) return cadence;
	if (remaining === 0) return `${cadence} · no deliveries left`;
	return `${cadence} · ${remaining} left`;
};

/**
 * The due slot for a wake row.
 *
 * A STALE row says `stale` instead of a clock — the CLI's own precedence
 * (`cli.py`: `elif row["stale"]: state = "stale"`): the supervisor no longer
 * fires it, and printing "8d overdue" would describe a pending fire that is
 * not pending. The stale flag rides the row beside it so the tone can mark it.
 */
export const wakeDueWord = (row: ScheduleWakeRow, nowMs: number): string => {
	if (row.stale) return "stale";
	return dueLabel((row.next_due_at - nowMs) / 1000);
};

/** The entry's head clause: parked/gone sentences replace the count and the
 *  soonest instant; otherwise `2 wakes · next in 1h` — the desktop's head
 *  shape over the phone's label (`nextDueClause`; `next` drops once the
 *  instant is overdue: `3 wakes · 8d overdue`). */
export const wakeEntryClause = (
	entry: ScheduleWakeEntry,
	nowMs: number,
): string => {
	if (entry.dormant) return PARKED_WAKES_CLAUSE;
	if (entry.ghost) return GONE_WAKES_CLAUSE;
	const count = wakeCountClause(entry.schedules.length);
	if (entry.next_due_at === null) return count;
	return nextDueClause(count, (entry.next_due_at - nowMs) / 1000);
};

/* --------------------------------------------------------- monitor rows */

/** One monitor as the screen draws it. */
export type MonitorLineView = {
	id: string;
	name: string;
	description: string;
	/** The due-or-state slot: `in 4m` / `2h overdue` for an armed watch, or
	 *  the state word — `disabled`, `expired`, `dormant`, `waiting`. `""` when
	 *  the entry is parked/gone (nothing ticks). */
	slot: string;
	/** `once` / `every 5m` — the same cadence renderer the wake rows use. */
	cadence: string;
	/** The store's own health sentence, the disabled reason, or `N failed`;
	 *  `null` when there is nothing to say (the common case, which stays
	 *  silent). */
	tail: string | null;
	/** The alert tone: a disabled/expired/dormant watch, an unavailable
	 *  episode, or strikes on the failure ladder. */
	alerting: boolean;
};

/** One monitor-carrying conversation as the screen draws it. */
export type MonitorEntryView = {
	sessionId: string;
	name: string;
	cwd: string;
	clause: string;
	parked: boolean;
	ghost: boolean;
	rows: MonitorLineView[];
	hidden: number;
};

/**
 * The due-or-state slot for a monitor row, the states in the wire's own
 * precedence (`state` is the server's word — `dormant` | `disabled` |
 * `expired` | `armed` — passed through, never re-derived):
 *
 * - a state word other than `armed` takes the slot, because the clock it
 *   replaces is the least informative thing in the row;
 * - `armed` shows the due clock through the same `dueLabel` the CLI uses,
 *   `waiting` when no due time is recorded (the TUI band's word for it).
 */
export const monitorSlot = (row: ScheduleMonitorRow): string => {
	if (row.state !== "armed") return row.state;
	if (row.due_in_s === null) return "waiting";
	return dueLabel(row.due_in_s);
};

/** The monitor row's health tail, in the TUI band's precedence: an unavailable
 *  episode's sentence first (it outranks a stale failure count — the count
 *  froze when the tool went out of reach), then the failure-ladder count,
 *  then the store's neutral hint. `null` when there is nothing to say. */
export const monitorTail = (row: ScheduleMonitorRow): string | null => {
	if (row.unavailable_since > 0 && row.health !== null && row.health !== "") {
		return row.health;
	}
	if (row.consecutive_failures > 0) return `${row.consecutive_failures} failed`;
	if (row.health !== null && row.health !== "") return row.health;
	return null;
};

/** Whether the row carries news: a disabled or expired watch, an unavailable
 *  episode, or strikes on the failure ladder. `dormant` is deliberately NOT
 *  news — it is the parked clause's business (the whole entry is parked, and
 *  its explanation sits on the entry head), and calling it attention here
 *  would double-count it in the section header. The ink rule lives here so the
 *  row and the section header cannot disagree about which rows "need
 *  attention". */
export const monitorAlerting = (row: ScheduleMonitorRow): boolean =>
	row.state === "disabled" ||
	row.state === "expired" ||
	row.unavailable_since > 0 ||
	row.consecutive_failures > 0;

export const monitorLineView = (
	row: ScheduleMonitorRow,
	suppressed: boolean,
): MonitorLineView => ({
	id: row.id,
	name: row.name,
	description: row.description,
	slot: suppressed ? "" : monitorSlot(row),
	cadence:
		row.every_ms === null
			? "once"
			: `every ${formatWakeDuration(row.every_ms)}`,
	tail: monitorTail(row),
	alerting: monitorAlerting(row),
});

/** The monitor entry's head clause; `2 monitors · next in 4m` mirrors the
 *  wake head (`nextDueClause`, overdue drop included), parked/gone replace
 *  it. */
export const monitorEntryClause = (
	entry: ScheduleMonitorEntry,
	nowMs: number,
): string => {
	if (entry.dormant) return PARKED_MONITORS_CLAUSE;
	if (entry.ghost) return GONE_MONITORS_CLAUSE;
	const count = monitorCountClause(entry.monitors.length);
	if (entry.next_due_at === null) return count;
	return nextDueClause(count, (entry.next_due_at - nowMs) / 1000);
};

/* --------------------------------------------------------- view derivation */

/**
 * The number of schedule rows one conversation shows before its own
 * "Show N more" control — the desktop's `WAKE_LINE_CAP` (3), for the
 * desktop's reason: a row's height compounds in a list of conversations, and
 * a 16-schedule conversation must not be a wall. The control puts the
 * remainder back, so nothing is unreachable.
 */
export const LINE_CAP = 3;

/**
 * The wake section's header count: `N scheduled`, counting WAKE ROWS (the TUI
 * band's own meaning for its heading) rather than conversations — a section
 * that said "2" over one two-wake conversation would name neither number
 * honestly.
 */
export const wakeSectionSummary = (rows: WakeLineView[]): string =>
	`${rows.length} scheduled`;

export const wakeEntryViews = (
	listing: ScheduleWakeListing,
	nowMs: number,
): WakeEntryView[] =>
	listing.entries.map((entry) => {
		const suppressed = entry.dormant || entry.ghost;
		const rows = entry.schedules.map((row) =>
			wakeLineView(row, nowMs, suppressed),
		);
		return {
			sessionId: entry.session_id,
			name: entry.name,
			cwd: entry.cwd,
			clause: wakeEntryClause(entry, nowMs),
			parked: entry.dormant,
			ghost: entry.ghost,
			rows,
			hidden: Math.max(rows.length - LINE_CAP, 0),
		};
	});

export const monitorEntryViews = (
	listing: ScheduleMonitorListing,
	nowMs: number,
): MonitorEntryView[] =>
	listing.entries.map((entry) => {
		const suppressed = entry.dormant || entry.ghost;
		const rows = entry.monitors.map((row) => monitorLineView(row, suppressed));
		return {
			sessionId: entry.session_id,
			name: entry.name,
			cwd: entry.cwd,
			clause: monitorEntryClause(entry, nowMs),
			parked: entry.dormant,
			ghost: entry.ghost,
			rows,
			hidden: Math.max(rows.length - LINE_CAP, 0),
		};
	});

/** The section header's count word. Wakes: `N scheduled` (the TUI band's word
 *  for its own heading). Monitors: `N armed`, and the broken count is called
 *  out — `2 of 5 need attention` — because a header reading "5 armed" above a
 *  row reading `disabled` says something the row itself contradicts (the TUI
 *  band's design round 1, D7). */
export const monitorSectionSummary = (rows: MonitorLineView[]): string => {
	const broken = rows.filter((row) => row.alerting).length;
	if (broken > 0) return `${broken} of ${rows.length} need attention`;
	return `${rows.length} armed`;
};

/* --------------------------------------------------- the list's own states */

/**
 * The wake listing's own empty line, rendered under its header when only the
 * OTHER family has content: the screen-level empty state is the both-empty
 * case, and a reader with monitors running should still see the wakes they
 * have armed — none — rather than a vanished section. Same rule for monitors.
 */
export const NO_WAKES_LINE = "No wakes scheduled.";
export const NO_MONITORS_LINE = "No monitors armed.";

/** The per-entry disclosure's label: the desktop's `hiddenWakesLabel`, whose
 *  singular was a shipped defect on the desktop list ("Show 1 more wakes"). */
export const showMoreWakeLabel = (hidden: number): string =>
	hidden === 1 ? "Show 1 more wake" : `Show ${hidden} more wakes`;

export const showMoreMonitorLabel = (hidden: number): string =>
	hidden === 1 ? "Show 1 more monitor" : `Show ${hidden} more monitors`;

/** The disclosure's collapse label, shown once expanded. */
export const showLessWakeLabel = "Show fewer wakes";
export const showLessMonitorLabel = "Show fewer monitors";

/** A read that failed without a sentence: a transport drop, which the
 *  connection's own surface owns rather than this screen re-wording it. */
export const READ_UNREACHABLE =
	"We couldn't read this machine's schedules just now.";

/**
 * The relay's own refusal sentence for a failed read, or `null` when the
 * failure is the connection's (mirroring `projectRefusalSentence`, same rule):
 * only `kind: "rejected"` is a definitive answer the relay wrote for a reader.
 * A `malformed-frame` message is a client-side diagnostic and never user copy.
 */
export const scheduleRefusalSentence = (error: unknown): string | null => {
	if (!isRelayError(error)) return null;
	if (error.kind !== "rejected") return null;
	const sentence = error.displayableMessage.trim();
	return sentence === "" ? null : sentence;
};
