import { describe, expect, it } from "vitest";

import type { Capabilities, Payload } from "@/contracts";
import { parsePayload } from "@/contracts";
import {
	homeStartSelection,
	restoredSupersede,
} from "@/features/home/home-defaults";
import {
	gatedStart,
	identityRoster,
	identitySheet,
	noteStartTargetLabel,
	noteStartTargetSupport,
	pushRecent,
	RECENT_BAND_MIN_ROSTER,
	recentsFrom,
	resolveStartTarget,
	START_TARGET_SEARCH_THRESHOLD,
	type StartTarget,
	startTargetLicensed,
	startTargetRefusal,
	startTargetSupport,
	startupWorkingLabel,
	targetFromSelection,
} from "@/features/home/start-targets";
import {
	classifyFailure,
	StartupCoordinator,
	type StartupRecord,
} from "@/features/new-session/startup-coordinator";
import { t } from "@/i18n";
import type { StartSessionRequest } from "@/relay/endpoints";
import { RelayError } from "@/relay/errors";

const OPENS_WITH_LABEL = /^Growth /;
const SAYS_PICK_SENDS = /to send your message/;
const SAYS_TAP_OR_PICK = /Tap your message .*send it now/;

/**
 * Starting a new chat as an agent or a team (operator: "There doesn't seem to be
 * any way to select a team/agent from new chat in the mobile app").
 *
 * The hazard this file guards is on the WIRE, not on screen: a relay older than
 * local-operator #4367 reads the unkeyed start with `body.get` and silently drops
 * `team`, so a phone that sent it blind would start an UNBOUND chat while its
 * pill named the team. So the capability gate is asserted on the body
 * `POST /api/sessions/start` receives, alongside the sheet's ordering rules.
 */

const LOPDEV: StartTarget = { kind: "team", name: "lopdev", label: "Lopdev" };
const CODER: StartTarget = { kind: "agent", name: "coder", label: "Coder" };
const BOTH = { agent: true, team: true } as const;
const NEITHER = { agent: false, team: false } as const;

const caps = (session_start: Record<string, unknown> | undefined) =>
	({ session_start }) as unknown as Capabilities;

describe("the capability gate (absent → no picker, no field)", () => {
	it("reads each flag only when it is literally true", () => {
		expect(startTargetSupport(null)).toBeNull();
		expect(startTargetSupport(caps(undefined))).toStrictEqual(NEITHER);
		expect(
			startTargetSupport(caps({ version: 1, effort: true })),
		).toStrictEqual(NEITHER);
		expect(startTargetSupport(caps({ agent: true, team: true }))).toStrictEqual(
			BOTH,
		);
		expect(startTargetSupport(caps({ agent: "yes", team: 1 }))).toStrictEqual(
			NEITHER,
		);
	});

	it("parses the capability flags through the real schema", () => {
		// A schema that stripped unknown keys would silently turn the flag off.
		const parsed = parsePayload("startTargets", {
			agents: [],
			teams: [],
		});
		expect(parsed.degraded).toBe(false);
	});

	it("licenses a target only for its own kind", () => {
		expect(startTargetLicensed(LOPDEV, BOTH)).toBe(true);
		expect(startTargetLicensed(LOPDEV, { agent: true, team: false })).toBe(
			false,
		);
		expect(startTargetLicensed(CODER, { agent: true, team: false })).toBe(true);
		expect(startTargetLicensed(CODER, null)).toBe(false);
	});
});

describe("the start body for agent, team and none", () => {
	const base = { cwd: "/tmp", chosenModel: null };

	it("names the team the reader chose", () => {
		expect(homeStartSelection({ ...base, target: LOPDEV })).toStrictEqual({
			cwd: "/tmp",
			team: "lopdev",
		});
	});

	it("names the agent the reader chose", () => {
		expect(homeStartSelection({ ...base, target: CODER })).toStrictEqual({
			cwd: "/tmp",
			agent: "coder",
		});
	});

	it("is byte-identical to today's body when nothing is chosen", () => {
		const body = homeStartSelection({ ...base, target: null });
		expect(JSON.stringify(body)).toBe(JSON.stringify(homeStartSelection(base)));
		expect(body).not.toHaveProperty("agent");
		expect(body).not.toHaveProperty("team");
	});

	it("names at most one of agent and team (mutual exclusion)", () => {
		for (const target of [LOPDEV, CODER]) {
			const body = homeStartSelection({
				...base,
				target,
			}) as StartSessionRequest;
			const named = ["agent", "team"].filter((key) => key in body);
			expect(named).toHaveLength(1);
		}
	});

	it("keeps the key order the restore comparison relies on", () => {
		const body = homeStartSelection({
			cwd: "/tmp",
			chosenModel: {
				selector: "anthropic/opus",
				provider: "anthropic",
				model_id: "opus",
				name: "Opus",
			},
			chosenEffort: "high",
			effortSupported: true,
			target: LOPDEV,
		});
		expect(Object.keys(body ?? {})).toStrictEqual([
			"cwd",
			"provider",
			"model_id",
			"effort",
			"team",
		]);
	});
});

/** A coordinator whose `start` is the production gate over a recording relay,
 *  so every test below asserts the bytes that would leave the phone. */
const SCOPE = "authorization-a/server-a";
const gatedHarness = (stored: StartSessionRequest | null) => {
	let disk: StartupRecord | null =
		stored === null
			? null
			: {
					version: 1,
					scope: SCOPE,
					phase: "draft",
					sessionId: null,
					selection: stored,
					draft: { text: "", images: [] },
					queue: [],
				};
	const relay = {
		sent: [] as StartSessionRequest[],
		answer: null as RelayError | null,
		startSession: async (request: StartSessionRequest) => {
			relay.sent.push(request);
			if (relay.answer !== null) throw relay.answer;
			return { ok: true as const, pid: 1, session_id: "session-a" };
		},
	};
	const coordinator = new StartupCoordinator(SCOPE, {
		store: {
			load: async () => (disk === null ? null : structuredClone(disk)),
			save: async (record) => {
				disk = structuredClone(record);
			},
		},
		start: (selection) => gatedStart(relay, selection),
		send: async () => undefined,
		isCurrent: () => true,
		uuid: () => "00000000-0000-4000-8000-000000000001",
	});
	return { relay, coordinator };
};

describe("a pick made before the live licence is read (PR #358 F1/F2)", () => {
	it("keeps the target in the body, so Send refuses it rather than starting unbound", async () => {
		/* The reconnect path: `liveFrameAt` is null, so the home's licence is
		 *  `null` while the cached roster still lets the reader pick. RED before
		 *  the fix: the commit wrote `{cwd}` with no team, and the relay started a
		 *  DEFAULT-agent chat under a pill that read "Lopdev". */
		const { relay, coordinator } = gatedHarness(null);
		coordinator.resume();
		await coordinator.ready;
		const body = homeStartSelection({
			cwd: "/tmp",
			chosenModel: null,
			target: LOPDEV,
		});
		expect(body).toStrictEqual({ cwd: "/tmp", team: "lopdev" });
		await coordinator.configure(body as StartSessionRequest, true);
		coordinator.edit("hello", []);
		await coordinator.enqueue();
		await coordinator.quiesce();
		expect(relay.sent).toStrictEqual([]);
		expect(coordinator.snapshot().phase).toBe("refused");
		// Not the final "choose the default agent" refusal: still connecting.
		expect(coordinator.snapshot().error).toBe(
			t("mobile.home.identity.refused_connecting", { name: "lopdev" }),
		);

		// The live frame lands; the same message goes out BOUND.
		noteStartTargetSupport(relay, BOTH);
		await coordinator.configure({ cwd: "/tmp", agent: "coder" }, true);
		await coordinator.quiesce();
		expect(relay.sent).toStrictEqual([{ cwd: "/tmp", agent: "coder" }]);
	});

	it("tells an unread licence apart from a refused one", async () => {
		const unread = { startSession: async () => ({ session_id: "s" }) };
		const old = { startSession: async () => ({ session_id: "s" }) };
		noteStartTargetSupport(old, NEITHER);
		const message = async (client: object & typeof unread) =>
			(
				(await gatedStart(client, { cwd: "/tmp", team: "lopdev" }).catch(
					(error: unknown) => error,
				)) as RelayError
			).displayableMessage;
		expect(await message(unread)).toBe(
			t("mobile.home.identity.refused_connecting", { name: "lopdev" }),
		);
		expect(await message(old)).toBe(
			t("mobile.home.identity.refused_unlicensed", { name: "lopdev" }),
		);
		expect(await message(unread)).not.toBe(await message(old));
	});
});

describe("a restored target (kept, re-gated where the bytes leave)", () => {
	const startBody = async (input: {
		stored: StartSessionRequest;
		target: StartTarget | null;
		support: { agent: boolean; team: boolean } | null;
	}) => {
		const { relay, coordinator } = gatedHarness(input.stored);
		noteStartTargetSupport(relay, input.support);
		await coordinator.ready;
		const next = restoredSupersede({
			stored: coordinator.snapshot().selection,
			folders: null,
			chosenModel: null,
			readerApplied: false,
			target: input.target,
		});
		if (next !== null) await coordinator.configure(next, true);
		coordinator.resume();
		coordinator.edit("hello", []);
		await coordinator.enqueue();
		await coordinator.quiesce();
		return { relay, coordinator };
	};

	it("survives the coordinator's restore (unlike an invented model)", async () => {
		const { relay } = await startBody({
			stored: { cwd: "/tmp", team: "lopdev" },
			target: LOPDEV,
			support: BOTH,
		});
		expect(relay.sent).toStrictEqual([{ cwd: "/tmp", team: "lopdev" }]);
	});

	it("is refused with a sentence, never sent unbound, once the relay stops licensing it (U2)", async () => {
		/* RED before the fix: the supersede stripped the field, so Send went out
		 *  as `{cwd}` — a default-agent chat — while the More row named the team. */
		const { relay, coordinator } = await startBody({
			stored: { cwd: "/tmp", team: "lopdev" },
			target: LOPDEV,
			support: NEITHER,
		});
		expect(relay.sent).toStrictEqual([]);
		expect(coordinator.snapshot().phase).toBe("refused");
		expect(coordinator.snapshot().selection).toStrictEqual({
			cwd: "/tmp",
			team: "lopdev",
		});
		expect(coordinator.snapshot().error).toBe(
			t("mobile.home.identity.refused_unlicensed", { name: "lopdev" }),
		);
	});

	it("is left alone while the capability is still unread", () => {
		expect(
			restoredSupersede({
				stored: { cwd: "/tmp", team: "lopdev" },
				folders: null,
				chosenModel: null,
				readerApplied: false,
				target: LOPDEV,
			}),
		).toBeNull();
	});

	it("reads back as the target the record names", () => {
		expect(targetFromSelection({ cwd: "/tmp", team: "lopdev" })).toStrictEqual({
			kind: "team",
			name: "lopdev",
			label: "lopdev",
		});
		expect(targetFromSelection({ cwd: "/tmp", agent: "coder" })).toStrictEqual({
			kind: "agent",
			name: "coder",
			label: "coder",
		});
		expect(targetFromSelection({ cwd: "/tmp" })).toBeNull();
		expect(targetFromSelection(null)).toBeNull();
	});
});

describe("what a started conversation says it is bound to (PR #358 U1/D1)", () => {
	const ROSTER = identityRoster(
		parsePayload("startTargets", {
			agents: [],
			teams: [{ name: "lopdev", label: "Lopdev" }],
			degraded: false,
		}),
	);

	it("reads the RECORD once the start landed, even after the draft pick was reset", () => {
		/* RED before the fix: the pick was reset to `null` on adoption and
		 *  `resolve` preferred it, so the More row said "Default agent ✓". */
		expect(
			resolveStartTarget({
				picked: null,
				record: { cwd: "/tmp", team: "lopdev" },
				fixed: true,
				roster: ROSTER,
			}),
		).toStrictEqual(LOPDEV);
		expect(
			resolveStartTarget({
				picked: undefined,
				record: { cwd: "/tmp", team: "lopdev" },
				fixed: true,
				roster: null,
			}),
		).toStrictEqual({ kind: "team", name: "lopdev", label: "lopdev" });
	});

	it("reads the pick while drafting, labelled from the roster or the pick", () => {
		expect(
			resolveStartTarget({
				picked: null,
				record: { cwd: "/tmp", team: "lopdev" },
				fixed: false,
				roster: ROSTER,
			}),
		).toBeNull();
		expect(
			resolveStartTarget({
				picked: CODER,
				record: { cwd: "/tmp", agent: "coder" },
				fixed: true,
				roster: null,
			}),
		).toStrictEqual(CODER);
	});

	it("names the target on the working line a start actually draws (D2)", () => {
		expect(startupWorkingLabel(false, "", "Lopdev")).toBe(
			t("mobile.home.identity.starting_with", { name: "Lopdev" }),
		);
		expect(startupWorkingLabel(false, "", null)).toBe(
			t("relay.chrome.session.subtitle.working_plain"),
		);
		// The turn's own activity wins once it reports one.
		expect(startupWorkingLabel(true, "Reading files", "Lopdev")).toBe(
			"Reading files",
		);
	});
});

describe("one start per refused re-pick (PR #358 QA Q2)", () => {
	it("sends one start when the commit and the supersede configure the same body in one tick", async () => {
		const { relay, coordinator } = gatedHarness(null);
		noteStartTargetSupport(relay, BOTH);
		relay.answer = new RelayError("rejected", "unknown_start_target", {
			status: 404,
			code: "unknown_start_target",
			serverError: "unknown_start_target",
		});
		coordinator.resume();
		await coordinator.ready;
		await coordinator.configure({ cwd: "/tmp", agent: "writer" }, true);
		coordinator.edit("hello", []);
		await coordinator.enqueue();
		await coordinator.quiesce();
		expect(relay.sent).toHaveLength(1);
		expect(coordinator.snapshot().phase).toBe("refused");

		/* The re-pick: the home's `commit` and its supersede effect both write
		 *  the new body before either save lands. RED before the fix: both
		 *  persisted, the second `kick` became a `pendingKick`, and the refused
		 *  record was drained again — two identical starts ~45 ms apart. */
		const body = { cwd: "/tmp", agent: "planner" };
		await Promise.all([
			coordinator.configure(body, true),
			coordinator.configure({ ...body }, true),
		]);
		await coordinator.quiesce();
		expect(relay.sent).toStrictEqual([
			{ cwd: "/tmp", agent: "writer" },
			{ cwd: "/tmp", agent: "planner" },
		]);
	});
});

const roster = (agents: number, teams: number): Payload<"startTargets"> =>
	parsePayload("startTargets", {
		agents: Array.from({ length: agents }, (_, index) => ({
			name: `agent-${index}`,
			label: `Agent ${index}`,
			kind: "role",
			source: "installed",
			description: `Does task ${index}`,
			agent_id: null,
			avatar_sha256: null,
		})),
		teams: Array.from({ length: teams }, (_, index) => ({
			name: `team-${index}`,
			label: `Team ${index}`,
			description: "",
			manager: "manager",
			member_count: 3,
		})),
		degraded: false,
	});

describe("the sheet's order and search threshold", () => {
	it("hides builtin profiles, as the desktop menu does", () => {
		const read = parsePayload("startTargets", {
			agents: [
				{ name: "default", source: "builtin" },
				{ name: "coder", source: "installed", label: "Coder" },
			],
			teams: [],
			degraded: false,
		});
		expect(identityRoster(read).agents.map((row) => row.name)).toStrictEqual([
			"coder",
		]);
	});

	it("orders Default, then Teams, then Agents, in catalogue order", () => {
		const sheet = identitySheet({
			roster: identityRoster(roster(2, 2)),
			query: "",
			recents: [],
			chosen: null,
		});
		expect(sheet.bands.map((band) => band.kind)).toStrictEqual([
			"teams",
			"agents",
		]);
		expect(sheet.showHeadings).toBe(true);
		expect(sheet.defaultRow).toStrictEqual({ selected: true });
		expect(sheet.bands[0]?.rows.map((row) => row.name)).toStrictEqual([
			"team-0",
			"team-1",
		]);
	});

	it("omits an empty band and the headings when only one band has rows", () => {
		const sheet = identitySheet({
			roster: identityRoster(roster(3, 0)),
			query: "",
			recents: [],
			chosen: null,
		});
		expect(sheet.bands.map((band) => band.kind)).toStrictEqual(["agents"]);
		expect(sheet.showHeadings).toBe(false);
	});

	it("shows search only above the model picker's threshold", () => {
		expect(START_TARGET_SEARCH_THRESHOLD).toBe(12);
		const at = identitySheet({
			roster: identityRoster(roster(10, 2)),
			query: "",
			recents: [],
			chosen: null,
		});
		expect(at.searchable).toBe(false);
		const over = identitySheet({
			roster: identityRoster(roster(11, 2)),
			query: "",
			recents: [],
			chosen: null,
		});
		expect(over.searchable).toBe(true);
	});

	it("filters every whitespace token over name, label and description, flat", () => {
		const sheet = identitySheet({
			roster: identityRoster(roster(20, 3)),
			query: "task 1",
			recents: [CODER],
			chosen: null,
		});
		expect(sheet.showHeadings).toBe(false);
		expect(sheet.recent).toStrictEqual([]);
		// The Default row shows only if it matches the query.
		expect(sheet.defaultRow).toBeNull();
		const names = sheet.bands.flatMap((band) => band.rows.map((r) => r.name));
		expect(names).toContain("agent-1");
		expect(names).toContain("agent-10");
		expect(names).not.toContain("agent-2");
		expect(sheet.noMatches).toBe(false);
		expect(
			identitySheet({
				roster: identityRoster(roster(20, 3)),
				query: "zzz",
				recents: [],
				chosen: null,
			}).noMatches,
		).toBe(true);
	});

	it("shows Recent only on a larger roster, and only for names it still offers", () => {
		const recents: StartTarget[] = [
			{ kind: "team", name: "team-1", label: "Team 1" },
			{ kind: "agent", name: "gone", label: "Gone" },
			{ kind: "agent", name: "agent-3", label: "Agent 3" },
		];
		const small = identitySheet({
			roster: identityRoster(roster(RECENT_BAND_MIN_ROSTER - 2, 2)),
			query: "",
			recents,
			chosen: null,
		});
		expect(small.recent).toStrictEqual([]);
		const large = identitySheet({
			roster: identityRoster(roster(10, 2)),
			query: "",
			recents,
			chosen: null,
		});
		expect(large.recent.map((row) => row.name)).toStrictEqual([
			"team-1",
			"agent-3",
		]);
		// Repeats, never removed from below.
		expect(
			large.bands.flatMap((band) => band.rows.map((r) => r.name)),
		).toContain("agent-3");
	});

	it("marks exactly one row selected, by kind and name", () => {
		const sheet = identitySheet({
			roster: identityRoster(
				parsePayload("startTargets", {
					agents: [{ name: "lopdev", source: "installed" }],
					teams: [{ name: "lopdev" }],
					degraded: false,
				}),
			),
			query: "",
			recents: [],
			chosen: LOPDEV,
		});
		expect(sheet.defaultRow).toStrictEqual({ selected: false });
		const selected = sheet.bands.flatMap((band) =>
			band.rows.filter((row) => row.selected).map((row) => row.kind),
		);
		expect(selected).toStrictEqual(["team"]);
	});
});

describe("the degraded roster", () => {
	it("is a read failure, not an empty roster", () => {
		const read = parsePayload("startTargets", {
			agents: [],
			teams: [],
			degraded: true,
		});
		const sheet = identitySheet({
			roster: identityRoster(read),
			query: "",
			recents: [],
			chosen: null,
		});
		expect(sheet.degraded).toBe(true);
		expect(sheet.empty).toBe(false);
		expect(sheet.defaultRow).toStrictEqual({ selected: true });
	});

	it("is empty only when the relay read cleanly and found nothing", () => {
		const sheet = identitySheet({
			roster: identityRoster(roster(0, 0)),
			query: "",
			recents: [],
			chosen: null,
		});
		expect(sheet.empty).toBe(true);
		expect(sheet.degraded).toBe(false);
	});
});

describe("recents", () => {
	it("keeps at most three, most recent first, one per target", () => {
		let list: StartTarget[] = [];
		for (const name of ["a", "b", "c", "d", "b"])
			list = pushRecent(list, { kind: "agent", name, label: name });
		expect(list.map((row) => row.name)).toStrictEqual(["b", "d", "c"]);
	});

	it("reads a stored list defensively", () => {
		expect(recentsFrom(null)).toStrictEqual([]);
		expect(recentsFrom("not json")).toStrictEqual([]);
		expect(
			recentsFrom(
				JSON.stringify([
					{ kind: "team", name: "lopdev", label: "Lopdev" },
					{ kind: "robot", name: "x" },
					{ kind: "agent", name: "" },
				]),
			),
		).toStrictEqual([LOPDEV]);
	});
});

describe("refusal mapping", () => {
	const refusal = (status: number, code: string) =>
		new RelayError(status === 503 ? "computer-offline" : "rejected", code, {
			status,
			code,
			serverError: code,
		});

	it.each([
		[404, "unknown_start_target"],
		[400, "invalid_start_target"],
		[503, "start_target_registry_unavailable"],
		[503, "start_target_unsaved"],
	])("turns %i %s into a definitive, readable refusal", (status, code) => {
		const mapped = startTargetRefusal(refusal(status, code), {
			cwd: "/tmp",
			team: "lopdev",
		});
		expect(mapped).not.toBeNull();
		// Definitive: nothing was created, so the draft stays correctable rather
		// than sitting in the "may have started" HOLD a 503 would otherwise get.
		expect(mapped?.envelope).toBe("clear");
		// The property that matters, read the way the coordinator reads it (F4).
		expect(classifyFailure(mapped)).toBe("definitive");
		expect(mapped?.code).toBe(code);
		expect(mapped?.displayableMessage).not.toContain("_");
		expect(mapped?.displayableMessage.length).toBeGreaterThan(10);
	});

	it("names the chosen target in the unknown-target sentence", () => {
		expect(
			startTargetRefusal(refusal(404, "unknown_start_target"), {
				cwd: "/tmp",
				team: "lopdev",
			})?.displayableMessage,
		).toContain("lopdev");
	});

	it("names the label the reader picked, not the wire slug (U4/D3)", async () => {
		expect(
			startTargetRefusal(
				refusal(404, "unknown_start_target"),
				{ cwd: "/tmp", team: "growth" },
				"Growth",
			)?.displayableMessage,
		).toBe(t("mobile.home.identity.refused_unknown", { name: "Growth" }));
		/* Through the gate, for a record that carries only the slug: the label
		 *  the home noted for this client is the one the sentence uses. RED
		 *  before the fix: "growth isn't available…" under a pill reading Growth. */
		const relay = {
			startSession: async () => {
				throw refusal(404, "unknown_start_target");
			},
		};
		noteStartTargetSupport(relay, BOTH);
		noteStartTargetLabel(relay, {
			kind: "team",
			name: "growth",
			label: "Growth",
		});
		const failure = (await gatedStart(relay, {
			cwd: "/tmp",
			team: "growth",
		}).catch((error: unknown) => error)) as RelayError;
		expect(failure.displayableMessage).toMatch(OPENS_WITH_LABEL);
		const unlicensed = {
			startSession: async () => ({ session_id: "s" }),
		};
		noteStartTargetSupport(unlicensed, NEITHER);
		noteStartTargetLabel(unlicensed, CODER);
		const local = (await gatedStart(unlicensed, {
			cwd: "/tmp",
			agent: "coder",
		}).catch((error: unknown) => error)) as RelayError;
		expect(local.displayableMessage).toBe(
			t("mobile.home.identity.refused_unlicensed", { name: "Coder" }),
		);
	});

	it("says that picking another row sends the message (U3)", () => {
		/* After a refusal, a pick re-sends the queued message at once (the
		 *  coordinator's `configure` from `refused`, the folder precedent); the
		 *  sentence must set that expectation rather than read as advice. */
		expect(
			t("mobile.home.identity.refused_unknown", { name: "Growth" }),
		).toMatch(SAYS_PICK_SENDS);
		expect(t("mobile.home.identity.refused_registry")).toMatch(
			SAYS_TAP_OR_PICK,
		);
	});

	it("leaves every other failure to the existing taxonomy", () => {
		expect(
			startTargetRefusal(refusal(400, "invalid_start_request"), {
				cwd: "/tmp",
				team: "lopdev",
			}),
		).toBeNull();
		expect(startTargetRefusal(new Error("boom"), { cwd: "/tmp" })).toBeNull();
	});
});

describe("the send-time gate (restored records replay before the screen renders)", () => {
	const client = () => {
		const sent: StartSessionRequest[] = [];
		return {
			sent,
			startSession: async (request: StartSessionRequest) => {
				sent.push(request);
				return { session_id: "s" };
			},
		};
	};

	it("refuses a target locally, sending nothing, until a live frame licensed it", async () => {
		const relay = client();
		const failure = await gatedStart(relay, {
			cwd: "/tmp",
			team: "lopdev",
		}).catch((error: unknown) => error);
		expect(relay.sent).toStrictEqual([]);
		expect(failure).toBeInstanceOf(RelayError);
		// Definitive: the coordinator moves to `refused`, the draft stays.
		expect((failure as RelayError).envelope).toBe("clear");
		expect((failure as RelayError).displayableMessage).toContain("lopdev");
	});

	it("refuses a kind the relay does not license", async () => {
		const relay = client();
		noteStartTargetSupport(relay, { agent: true, team: false });
		await expect(
			gatedStart(relay, { cwd: "/tmp", team: "lopdev" }),
		).rejects.toBeInstanceOf(RelayError);
		expect(relay.sent).toStrictEqual([]);
	});

	it("sends a licensed target, and an untargeted body always", async () => {
		const relay = client();
		await gatedStart(relay, { cwd: "/tmp" });
		noteStartTargetSupport(relay, BOTH);
		await gatedStart(relay, { cwd: "/tmp", team: "lopdev" });
		noteStartTargetSupport(relay, null);
		await gatedStart(relay, { cwd: "/tmp" });
		expect(relay.sent).toStrictEqual([
			{ cwd: "/tmp" },
			{ cwd: "/tmp", team: "lopdev" },
			{ cwd: "/tmp" },
		]);
	});

	it("re-dresses the relay's own start-target refusal", async () => {
		const relay = {
			startSession: async () => {
				throw new RelayError("computer-offline", "start_target_unsaved", {
					status: 503,
					code: "start_target_unsaved",
					serverError: "start_target_unsaved",
				});
			},
		};
		noteStartTargetSupport(relay, BOTH);
		const failure = (await gatedStart(relay, {
			cwd: "/tmp",
			agent: "coder",
		}).catch((error: unknown) => error)) as RelayError;
		expect(failure.envelope).toBe("clear");
		expect(failure.code).toBe("start_target_unsaved");
	});
});
