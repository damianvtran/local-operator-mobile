/**
 * Starting a new chat AS an agent or a team: the decisions behind the home's
 * identity pill and its "Start this chat with" sheet.
 *
 * WHY THIS EXISTS. The operator: "There doesn't seem to be any way to select a
 * team/agent from new chat in the mobile app … make this available to be able to
 * start a conversation with a team enabled". local-operator #4367 gave the relay
 * the means — `GET /api/start-targets` lists what a chat may be bound to, and
 * `POST /api/sessions/start` takes an optional, mutually exclusive `agent` or
 * `team`, writing the session's `attachment.json` before the child spawns so the
 * first turn already runs as that identity (the desktop's own create path).
 *
 * THE ONE HAZARD. Both are licensed by `capabilities.session_start.agent/team`.
 * A relay older than #4367 reads the UNKEYED start (the one this app sends) with
 * `body.get` and silently DROPS an unknown field, so a phone that sent `team`
 * blind would start an UNBOUND chat while its pill said "Lopdev". So the
 * reader's pick is ALWAYS written into the start record (`startTargetField`),
 * and the ONE place that decides whether it may leave is `gatedStart`, where the
 * bytes go out: it refuses, locally and visibly, a target this relay has not
 * licensed. `null` (no live capabilities frame yet) is its own reading — never
 * "supported", and never "unsupported" either (PR #358 round 1, F1/F2: an
 * earlier build dropped the field from the body while the licence was unread,
 * so a pick made just after a reconnect started a default-agent chat under a
 * pill that named the team).
 *
 * Pure (no React Native), so the rules are asserted in Node
 * (`start-targets.test.ts`); `home-pickers.tsx` only lays the sheet out.
 * Design: the identity-picker spec, decisions D-S1..D-S26.
 */
import type { Capabilities, Payload } from "@/contracts";
import { MODEL_SEARCH_THRESHOLD } from "@/features/home/picker-search-threshold";
import { t } from "@/i18n";
import type { StartSessionRequest } from "@/relay/endpoints";
import { isRelayError, RelayError } from "@/relay/errors";

/** What a new chat starts as. `name` is the wire value the start route takes;
 *  `label` is the relay's painted form, shown to the reader (D-S9). A restored
 *  record carries only the name, so its label falls back to it. */
export type StartTarget = Readonly<{
	kind: "agent" | "team";
	name: string;
	label: string;
}>;

/** Per-kind licence from `capabilities.session_start`, or `null` while the
 *  capabilities frame has not arrived. */
export type StartTargetSupport = Readonly<{ agent: boolean; team: boolean }>;

/** The picker's search appears above the same row count as the model picker's
 *  (D-S13), so the two sheets behave alike. */
export const START_TARGET_SEARCH_THRESHOLD = MODEL_SEARCH_THRESHOLD;

/** The Recent band appears only once the roster is longer than this (D-S12,
 *  a design proposal pending frames): on a short roster every row is already in
 *  view, and repeating three of them is clutter. */
export const RECENT_BAND_MIN_ROSTER = 8;

/** At most this many recents are remembered and shown (D-S12). */
export const RECENT_LIMIT = 3;

/** Each flag counts only when it is literally `true` — the effort flag's rule.
 *  A relay that sends `"yes"` has not licensed anything this build understands. */
export const startTargetSupport = (
	capabilities: Capabilities | null | undefined,
): StartTargetSupport | null => {
	if (capabilities === null || capabilities === undefined) return null;
	const flags = capabilities.session_start;
	return { agent: flags?.agent === true, team: flags?.team === true };
};

/** Whether the picker exists at all: some kind is licensed (D-S15). */
export const startTargetsOffered = (
	support: StartTargetSupport | null,
): boolean => support !== null && (support.agent || support.team);

/** Whether this relay may be sent this target. The single gate for the wire. */
export const startTargetLicensed = (
	target: StartTarget,
	support: StartTargetSupport | null,
): boolean => support?.[target.kind] === true;

/** The start RECORD's target field: `{agent}` or `{team}`, never both (the
 *  relay refuses both with `invalid_start_target`), and nothing unless the
 *  reader chose one (D-S16) — absent keeps the body byte-identical to a
 *  pre-#4367 start.
 *
 *  WHY NOT GATED HERE. The licence is deliberately NOT consulted: the record is
 *  what the reader asked for, and `gatedStart` is the gate on what leaves. A
 *  field dropped here while the licence was unread (every reconnect resets it)
 *  or withdrawn (an older relay) made the start go out UNBOUND with nothing on
 *  screen saying so (PR #358 F1/U2); kept, it is refused with a sentence. */
export const startTargetField = (
	target: StartTarget | null,
): Pick<StartSessionRequest, "agent" | "team"> => {
	if (target === null) return {};
	return target.kind === "agent"
		? { agent: target.name }
		: { team: target.name };
};

/**
 * The target the home shows and starts as (`use-start-target.ts`'s `resolve`).
 *
 * - DRAFT: the reader's pick on this computer, else what a restored record names.
 * - ADOPTED (the start landed, `fixed`): the RECORD's target — that is what the
 *   conversation is bound to. An earlier build reset the pick the moment the
 *   start landed and then showed "Default agent ✓" for a team chat (PR #358
 *   U1/D1); the record is the truth, and the pick only lends it its label.
 *
 * The label comes from the roster row when it has one, else the pick's own (a
 * record carries only the wire name), else the name.
 */
export const resolveStartTarget = (input: {
	/** The pick made on this computer: `undefined` = none this mount. */
	picked: StartTarget | null | undefined;
	record: StartSessionRequest | null | undefined;
	fixed: boolean;
	roster: IdentityRoster | null;
}): StartTarget | null => {
	const fromRecord = targetFromSelection(input.record);
	const base =
		input.fixed || input.picked === undefined ? fromRecord : input.picked;
	if (base === null) return null;
	const row = (
		base.kind === "team" ? input.roster?.teams : input.roster?.agents
	)?.find((candidate) => candidate.name === base.name);
	if (row !== undefined) return { ...base, label: row.label };
	if (input.picked && sameTarget(input.picked, base))
		return { ...base, label: input.picked.label };
	return base;
};

/** The target a coordinator record names, or `null`. Used to show a restored
 *  choice on the pill rather than sending something the screen does not show. */
export const targetFromSelection = (
	selection: StartSessionRequest | null | undefined,
): StartTarget | null => {
	if (!selection) return null;
	if (typeof selection.team === "string" && selection.team !== "")
		return { kind: "team", name: selection.team, label: selection.team };
	if (typeof selection.agent === "string" && selection.agent !== "")
		return { kind: "agent", name: selection.agent, label: selection.agent };
	return null;
};

/** One row of the sheet, with what the row draws. */
export type IdentityRow = Readonly<{
	kind: "agent" | "team";
	name: string;
	label: string;
	/** Agent: its description. Team: unused (the subtitle is built from
	 *  `manager`/`memberCount`, D-S14). */
	description: string;
	manager: string | null;
	memberCount: number | null;
	/** With `avatarSha256`, the key to `/v1/agents/{id}/avatar`. */
	agentId: string | null;
	avatarSha256: string | null;
	selected: boolean;
}>;

export type IdentityRoster = Readonly<{
	agents: readonly Omit<IdentityRow, "selected">[];
	teams: readonly Omit<IdentityRow, "selected">[];
	degraded: boolean;
}>;

/** The relay's roster, as the sheet offers it. Builtin profiles are hidden —
 *  the desktop menu's `draftTargetRoster` rule (`source !== "builtin"`), so the
 *  phone offers exactly the agents the desktop does. Catalogue order is kept:
 *  the relay already sorts, and a second sort here would disagree with it. */
export const identityRoster = (
	read: Payload<"startTargets">,
): IdentityRoster => ({
	agents: read.agents
		.filter((agent) => agent.source !== "builtin")
		.map((agent) => ({
			kind: "agent" as const,
			name: agent.name,
			label: agent.label?.trim() || agent.name,
			description: agent.description?.trim() ?? "",
			manager: null,
			memberCount: null,
			agentId: agent.agent_id ?? null,
			avatarSha256: agent.avatar_sha256 ?? null,
		})),
	teams: read.teams.map((team) => ({
		kind: "team" as const,
		name: team.name,
		label: team.label?.trim() || team.name,
		description: team.description?.trim() ?? "",
		manager: team.manager?.trim() || null,
		memberCount: team.member_count ?? null,
		agentId: null,
		avatarSha256: null,
	})),
	degraded: read.degraded,
});

export type IdentityBand = Readonly<{
	kind: "teams" | "agents";
	rows: readonly IdentityRow[];
}>;

export type IdentitySheet = Readonly<{
	/** `null` when an active query does not match "Default agent" (D-S13). */
	defaultRow: Readonly<{ selected: boolean }> | null;
	recent: readonly IdentityRow[];
	bands: readonly IdentityBand[];
	/** Headings only when two bands have rows and no query is active. */
	showHeadings: boolean;
	searchable: boolean;
	/** A clean read with nothing to offer (not a failure). */
	empty: boolean;
	degraded: boolean;
	noMatches: boolean;
}>;

const WHITESPACE = /\s+/;

const sameTarget = (
	a: Pick<StartTarget, "kind" | "name"> | null,
	b: Pick<StartTarget, "kind" | "name">,
): boolean => a !== null && a.kind === b.kind && a.name === b.name;

/**
 * The sheet, in render order (D-S12/D-S13): Default agent, then Recent (≤3,
 * only on a roster longer than `RECENT_BAND_MIN_ROSTER`, only with no query,
 * and not when the recents already cover the whole roster — the desktop
 * identity menu's rule), then Teams, then Agents (teams first, desktop U-2).
 *
 * The Default row is ALWAYS there with no query, so a tap never reflows the
 * list under the reader's finger (the model picker's D1 lesson). A query
 * flattens to one list with no headings and no Recent, and every whitespace
 * token must appear in the row's name, label or description (`filterModels`).
 */
export const identitySheet = (input: {
	roster: IdentityRoster | null;
	query: string;
	recents: readonly StartTarget[];
	chosen: StartTarget | null;
}): IdentitySheet => {
	const { roster, chosen } = input;
	const total = roster ? roster.agents.length + roster.teams.length : 0;
	const tokens = input.query
		.trim()
		.toLowerCase()
		.split(WHITESPACE)
		.filter(Boolean);
	const querying = tokens.length > 0;
	const matches = (text: string) => {
		const haystack = text.toLowerCase();
		return tokens.every((token) => haystack.includes(token));
	};
	const select = (row: Omit<IdentityRow, "selected">): IdentityRow => ({
		...row,
		selected: sameTarget(chosen, row),
	});
	const keep = (row: Omit<IdentityRow, "selected">) =>
		!querying ||
		matches(`${row.name} ${row.label} ${row.description} ${row.manager ?? ""}`);
	const teams = (roster?.teams ?? []).filter(keep).map(select);
	const agents = (roster?.agents ?? []).filter(keep).map(select);
	const bands: IdentityBand[] = [];
	if (teams.length > 0) bands.push({ kind: "teams", rows: teams });
	if (agents.length > 0) bands.push({ kind: "agents", rows: agents });

	let recent: IdentityRow[] = [];
	if (!querying && roster !== null && total > RECENT_BAND_MIN_ROSTER) {
		const offered = [...roster.teams, ...roster.agents];
		/* A name the roster no longer offers is dropped silently (D-S12): a recent
		 *  is a shortcut to a row, never a row of its own. */
		recent = input.recents
			.map((target) => offered.find((row) => sameTarget(target, row)))
			.filter((row): row is Omit<IdentityRow, "selected"> => row !== undefined)
			.slice(0, RECENT_LIMIT)
			.map(select);
		if (recent.length >= total) recent = [];
	}

	const defaultLabel = t("mobile.home.identity.default_agent");
	const defaultRow =
		!querying || matches(defaultLabel) ? { selected: chosen === null } : null;
	return {
		defaultRow,
		recent,
		bands,
		showHeadings: !querying && bands.length > 1,
		searchable: total > START_TARGET_SEARCH_THRESHOLD,
		empty: roster !== null && !roster.degraded && total === 0,
		degraded: roster?.degraded ?? false,
		noMatches: querying && bands.length === 0 && defaultRow === null,
	};
};

/** Remember a pick, most recent first, one entry per target, `RECENT_LIMIT`
 *  long. Clearing back to Default is not a pick and is not remembered. */
export const pushRecent = (
	recents: readonly StartTarget[],
	target: StartTarget,
): StartTarget[] =>
	[target, ...recents.filter((row) => !sameTarget(target, row))].slice(
		0,
		RECENT_LIMIT,
	);

/** The stored recents, read defensively: the file is the phone's own, but a
 *  hand-edited or older shape must read as "none", never throw into a render. */
export const recentsFrom = (raw: string | null): StartTarget[] => {
	if (raw === null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const rows: StartTarget[] = [];
	for (const value of parsed) {
		if (typeof value !== "object" || value === null) continue;
		const { kind, name, label } = value as Record<string, unknown>;
		if (kind !== "agent" && kind !== "team") continue;
		if (typeof name !== "string" || name === "") continue;
		rows.push({
			kind,
			name,
			label: typeof label === "string" && label !== "" ? label : name,
		});
	}
	return rows.slice(0, RECENT_LIMIT);
};

/** The preference key recents live under: PER COMPUTER (D-S12), because a
 *  roster is one machine's registries and another's names mean nothing. A
 *  custom route has no tunnel id and shares one slot. */
export const recentsKey = (computer: string | null): string =>
	`home.start-target-recents.${computer ?? "custom"}`;

/** The relay's start-target refusal codes (local-operator #4367,
 *  `start_receipts.py` / `daemon.py` `_resolve_start_target`). */
const START_TARGET_CODES = new Set([
	"invalid_start_target",
	"unknown_start_target",
	"start_target_registry_unavailable",
	"start_target_unsaved",
]);

const refusalSentence = (code: string, name: string): string => {
	switch (code) {
		case "unknown_start_target":
			return t("mobile.home.identity.refused_unknown", { name });
		case "start_target_registry_unavailable":
			return t("mobile.home.identity.refused_registry");
		case "start_target_unsaved":
			return t("mobile.home.identity.refused_unsaved", { name });
		default:
			return t("mobile.home.identity.refused_fallback", { name });
	}
};

/**
 * A start-target refusal, re-dressed as a DEFINITIVE refusal with readable copy;
 * `null` for any other failure (the existing taxonomy keeps deciding those).
 *
 * WHY. The relay answers these as `{error: code, code}`, so the raw code would be
 * the coordinator's "relay's own sentence" — `unknown_start_target` on screen.
 * And two of them are 503s, which the transport taxonomy reads as
 * `computer-offline` → envelope `keep` → the "may have started" HOLD. On the
 * unkeyed start this app sends, every one of them is refused BEFORE a child
 * spawns (validation runs before the id is minted; an unsaved binding returns
 * before `spawn_session`), so nothing exists and the draft must stay
 * correctable (D-S20) rather than locked behind a hold.
 */
export const startTargetRefusal = (
	failure: unknown,
	selection: StartSessionRequest,
	label?: string,
): RelayError | null => {
	if (!isRelayError(failure)) return null;
	const code = failure.code;
	if (code === undefined || !START_TARGET_CODES.has(code)) return null;
	/* The name the reader picked, not the wire slug (PR #358 U4/D3): the pill
	 *  says "Growth", so the sentence must too. */
	const name = label ?? selection.team ?? selection.agent ?? "";
	const sentence = refusalSentence(code, name);
	return new RelayError("rejected", sentence, {
		status: failure.status,
		code,
		detail: sentence,
		envelope: "clear",
		retry: "never",
		cause: failure,
	});
};

/**
 * The local refusal for a target the relay has not licensed.
 *
 * `null` and `false` are DIFFERENT readings (PR #358 F2). `false` is a live
 * frame saying this Local Operator cannot bind a chat: final, and the sentence
 * points at the default agent. `null` is no live frame YET — every reconnect
 * and every cold start begins there, and a second later the same relay may
 * license it — so that sentence says "still connecting" and asks for a resend,
 * never "give up the team". It is a refusal rather than a wait on purpose: a
 * wait needs a bound, and there is no measured time-to-first-frame to set one
 * by (delivery guide, "Measure before you cap"); a definitive refusal keeps the
 * message and the pick, and nothing was created.
 */
const unlicensedRefusal = (
	label: string,
	support: StartTargetSupport | null,
): RelayError => {
	const sentence =
		support === null
			? t("mobile.home.identity.refused_connecting", { name: label })
			: t("mobile.home.identity.refused_unlicensed", { name: label });
	return new RelayError("rejected", sentence, {
		detail: sentence,
		envelope: "clear",
		retry: "never",
	});
};

/**
 * The licence each relay client last advertised, as a LIVE frame said it.
 *
 * WHY A REGISTER BESIDE THE CLIENT. The home's own gate (`homeStartSelection`)
 * covers what the reader sends from the screen, but the startup coordinator
 * also REPLAYS a restored record on `resume()`, before any screen effect has run
 * — and a restored target is kept on purpose (it is the reader's choice, not an
 * invented value). So the last gate must sit where the bytes leave: the
 * coordinator's `start` dependency (`startup-runtime.ts`). The home publishes
 * the live reading here per client; a client nobody has vouched for yet reads
 * as `null`, and a target sent through it is refused LOCALLY and visibly
 * (contract "PR 2": "fail locally and visibly rather than starting unbound").
 * Weak, so a retired client takes its entry with it.
 */
const licences = new WeakMap<object, StartTargetSupport>();

/** The painted label of each target the home has shown for a client, so a
 *  refusal names what the pill named (U4/D3) even for a restored record, which
 *  carries only the wire name. Keyed like `licences`, and weak for the same
 *  reason. */
const labels = new WeakMap<object, Map<string, string>>();
const labelKey = (target: Pick<StartTarget, "kind" | "name">) =>
	`${target.kind}:${target.name}`;

/** Remember the label the screen shows for `target` on `client`. */
export const noteStartTargetLabel = (
	client: object,
	target: StartTarget | null,
): void => {
	if (target === null) return;
	let held = labels.get(client);
	if (held === undefined) {
		held = new Map();
		labels.set(client, held);
	}
	held.set(labelKey(target), target.label);
};

/** Record what `client`'s relay licenses; `null` forgets it (no live frame). */
export const noteStartTargetSupport = (
	client: object,
	support: StartTargetSupport | null,
): void => {
	if (support === null) licences.delete(client);
	else licences.set(client, support);
};

/**
 * `POST /api/sessions/start` through the target gate: the one path a start body
 * leaves the phone by. A target this relay has not licensed is refused before
 * any request (definitive, so the draft stays correctable); a start-target
 * refusal from the relay is re-dressed by `startTargetRefusal`. A body with no
 * target goes out exactly as before.
 */
export const gatedStart = async <T>(
	client: { startSession(request: StartSessionRequest): Promise<T> },
	selection: StartSessionRequest,
): Promise<T> => {
	const target = targetFromSelection(selection);
	const label =
		target === null
			? undefined
			: (labels.get(client)?.get(labelKey(target)) ?? target.label);
	if (target !== null && label !== undefined) {
		const support = licences.get(client) ?? null;
		if (!startTargetLicensed(target, support))
			throw unlicensedRefusal(label, support);
	}
	try {
		return await client.startSession(selection);
	} catch (failure) {
		throw startTargetRefusal(failure, selection, label) ?? failure;
	}
};

/**
 * The working line's words. The live activity wins; before it, a chat started
 * with an agent or team says so — "Starting with Lopdev…" — HERE, on the line
 * a start actually draws. The splash's own "Starting with" line is replaced by
 * the reader's bubble ~50 ms after Send, so it was never seen (PR #358 D2/U1);
 * this is the one place the binding is visible while the chat starts.
 */
export const startupWorkingLabel = (
	running: boolean,
	activity: string,
	startingAs: string | null,
): string => {
	if (running && activity.length > 0) return activity;
	if (!running && startingAs !== null)
		return t("mobile.home.identity.starting_with", { name: startingAs });
	return t("relay.chrome.session.subtitle.working_plain");
};
