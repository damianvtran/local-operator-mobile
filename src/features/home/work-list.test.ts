import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TunnelSessionError } from "@/connection/tunnel-session";
import type { SessionSummary } from "@/contracts";
import {
	homeNamedRefusal,
	refusalFromError,
	tunnelSessionRelayError,
} from "@/features/auth/refusal";
import { homeRecoveryKind } from "@/features/home/home-recovery";
import {
	DROP_META_FROM,
	TRY_ROW_COUNT,
	trimWorkList,
	type WorkListSlotInput,
	WRAP_TITLE_ABOVE,
	workListBudget,
	workListFor,
	workListRowCount,
	workListSlot,
	workRowShape,
} from "@/features/home/work-list";

/**
 * The work list's model and, above all, the decision that decides whether it is
 * drawn. The decision is pure so a recovery or refusal state can be pinned out of
 * it here: the home renders no box in Node.
 */

const NOON = new Date(2026, 10, 22, 12, 0, 0, 0).getTime() / 1000;
const MIN = 60;

function row(
	id: string,
	overrides: Partial<SessionSummary> = {},
): SessionSummary {
	return {
		session_id: id,
		section: "active",
		pinned: false,
		conversation_name: id,
		cwd: "/synthetic",
		model_label: "",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: null,
		subagents_queued: null,
		todos_open: 0,
		mtime: NOON - 600 * MIN,
		completion_kind: "",
		ended: false,
		degraded: false,
		tags: [],
		primary: null,
		...overrides,
	} as SessionSummary;
}

const ids = (rows: readonly SessionSummary[]) => rows.map((r) => r.session_id);
const waiting = (id: string, overrides: Partial<SessionSummary> = {}) =>
	row(id, { needs_attention: true, pending_kind: "approval", ...overrides });
const busy = (id: string, overrides: Partial<SessionSummary> = {}) =>
	row(id, { streaming: true, ...overrides });

describe("the row budget", () => {
	it("is 4 at 100 %, 3 from 1.3×, 2 from 2.0×", () => {
		expect(workListBudget(1)).toBe(4);
		expect(workListBudget(1.29)).toBe(4);
		expect(workListBudget(1.3)).toBe(3);
		expect(workListBudget(1.99)).toBe(3);
		expect(workListBudget(2)).toBe(2);
		expect(workListBudget(3)).toBe(2);
	});
});

describe("workListFor", () => {
	it("splits needs-you, running and recent, newest first within each", () => {
		const list = workListFor(
			[
				row("old", { mtime: NOON - 900 * MIN }),
				row("new", { mtime: NOON - 5 * MIN }),
				busy("run"),
				waiting("ask", { pending_kind: "ask" }),
			],
			1,
		);
		expect(ids(list.needsYou)).toEqual(["ask"]);
		expect(ids(list.running)).toEqual(["run"]);
		expect(ids(list.recent)).toEqual(["new", "old"]);
		expect(list.rest).toBe(0);
	});

	it("lists a waiting row that is also streaming under needs-you only", () => {
		const list = workListFor([waiting("both", { streaming: true })], 1);
		expect(ids(list.needsYou)).toEqual(["both"]);
		expect(list.running).toEqual([]);
	});

	it("drops remote and ended rows, but keeps an ended row that is running", () => {
		const list = workListFor(
			[
				row("peer", { locality: "remote" } as Partial<SessionSummary>),
				waiting("peer-waiting", {
					locality: "remote",
				} as Partial<SessionSummary>),
				row("done", { ended: true }),
				busy("live-ended", { ended: true }),
				row("kept"),
			],
			1,
		);
		expect(ids(list.needsYou)).toEqual([]);
		expect(ids(list.running)).toEqual(["live-ended"]);
		expect(ids(list.recent)).toEqual(["kept"]);
	});

	it("lists a session once even when the frame repeats it", () => {
		const list = workListFor(
			[row("a"), row("a"), waiting("b"), waiting("b")],
			1,
		);
		expect(workListRowCount(list)).toBe(2);
	});

	it("fills the budget from running, then recent", () => {
		const list = workListFor(
			[
				waiting("w"),
				busy("r1"),
				busy("r2"),
				row("c1", { mtime: NOON - 10 * MIN }),
				row("c2", { mtime: NOON - 20 * MIN }),
			],
			1,
		);
		// 4 rows: 1 waiting + 2 running + 1 recent; one recent row is left over.
		expect(ids(list.needsYou)).toEqual(["w"]);
		expect(ids(list.running)).toEqual(["r1", "r2"]);
		expect(ids(list.recent)).toEqual(["c1"]);
		expect(list.rest).toBe(1);
	});

	it("never caps needs-you, and gives running/recent only what is left", () => {
		const five = [1, 2, 3, 4, 5].map((n) => waiting(`w${n}`));
		const list = workListFor([...five, busy("r"), row("c")], 1);
		expect(list.needsYou).toHaveLength(5);
		expect(list.running).toEqual([]);
		expect(list.recent).toEqual([]);
		expect(list.rest).toBe(2);
		// At 200 % the budget is 2 and the five still all show.
		expect(workListFor(five, 2).needsYou).toHaveLength(5);
	});

	it("shrinks the running/recent share with the text scale", () => {
		const rows = [
			waiting("w"),
			busy("r"),
			row("c1", { mtime: NOON - 1 * MIN }),
			row("c2", { mtime: NOON - 2 * MIN }),
		];
		expect(workListRowCount(workListFor(rows, 1))).toBe(4);
		expect(workListRowCount(workListFor(rows, 1.3))).toBe(3);
		expect(workListRowCount(workListFor(rows, 2))).toBe(2);
		expect(workListFor(rows, 2).rest).toBe(2);
	});

	it("leaves empty sections empty", () => {
		const list = workListFor([row("only")], 1);
		expect(list.needsYou).toEqual([]);
		expect(list.running).toEqual([]);
		expect(ids(list.recent)).toEqual(["only"]);
	});

	it("orders recent rows by the drawer's activity clock, rows without one last", () => {
		const list = workListFor(
			[
				row("none", { mtime: 0 }),
				row("mid", { mtime: NOON - 60 * MIN }),
				row("fresh", { mtime: NOON - MIN }),
			],
			1,
		);
		expect(ids(list.recent)).toEqual(["fresh", "mid", "none"]);
	});
});

describe("trimWorkList", () => {
	it("keeps every needs-you row and trims running then recent from the tail", () => {
		const list = workListFor(
			[waiting("w1"), waiting("w2"), busy("r"), row("c")],
			1,
		);
		const trimmed = trimWorkList(list, 1);
		expect(ids(trimmed.needsYou)).toEqual(["w1", "w2"]);
		expect(ids(trimmed.running)).toEqual(["r"]);
		expect(trimmed.recent).toEqual([]);
		expect(trimmed.rest).toBe(1);
		expect(workListRowCount(trimWorkList(list, 0)) - 2).toBe(0);
	});
});

const base: WorkListSlotInput = {
	connected: true,
	recovery: false,
	draft: "",
	editing: false,
	starting: false,
	frameLive: true,
	stale: false,
	sessions: [waiting("w"), busy("r"), row("c")],
	scale: 1,
};

describe("workListSlot — the decision", () => {
	it("shows the list when connected, live, quiet and there is something to resume", () => {
		const slot = workListSlot(base);
		expect(slot.kind).toBe("list");
	});

	it("never shows the list behind a refusal or recovery, however many rows wait", () => {
		// Phone access off is a refusal (`refusal.ts`, cause phone-access-off) and
		// renders INSTEAD of the splash; the decision refuses it again on its own.
		const five = [1, 2, 3, 4, 5].map((n) => waiting(`w${n}`));
		expect(workListSlot({ ...base, sessions: five, recovery: true }).kind).toBe(
			"none",
		);
		expect(workListSlot({ ...base, sessions: [], recovery: true }).kind).toBe(
			"none",
		);
	});

	it("hides when offline, not connected, or the frame is not live or is stale", () => {
		expect(workListSlot({ ...base, connected: false }).kind).toBe("none");
		expect(workListSlot({ ...base, frameLive: false }).kind).toBe("none");
		expect(workListSlot({ ...base, stale: true }).kind).toBe("none");
	});

	it("steps away while the reader has a draft, types, or sends", () => {
		expect(workListSlot({ ...base, draft: "hello" }).kind).toBe("none");
		expect(workListSlot({ ...base, editing: true }).kind).toBe("none");
		expect(workListSlot({ ...base, starting: true }).kind).toBe("none");
		// Whitespace is no draft (`draftExistsFor`).
		expect(workListSlot({ ...base, draft: "  " }).kind).toBe("list");
	});

	it("gives a brand-new account two TRY rows, without the two removed chips", () => {
		const slot = workListSlot({ ...base, sessions: [] });
		expect(slot.kind).toBe("try");
		if (slot.kind !== "try") return;
		expect(slot.rows).toHaveLength(TRY_ROW_COUNT);
		expect(slot.rows).toEqual(["Create a team of agents", "Set up Linear MCP"]);
		expect(slot.rows.join(" ")).not.toMatch(/phone access|last turn/i);
	});

	it("shows no TRY rows while loading, offline or typing", () => {
		const fresh = { ...base, sessions: [] };
		expect(workListSlot({ ...fresh, frameLive: false }).kind).toBe("none");
		expect(workListSlot({ ...fresh, connected: false }).kind).toBe("none");
		expect(workListSlot({ ...fresh, draft: "x" }).kind).toBe("none");
	});

	it("is not brand-new when only ended or other computers' rows exist", () => {
		const slot = workListSlot({
			...base,
			sessions: [
				row("done", { ended: true }),
				row("peer", { locality: "remote" } as Partial<SessionSummary>),
			],
		});
		expect(slot.kind).toBe("none");
	});

	it("shows a returning reader's quiet history as Recent", () => {
		const slot = workListSlot({ ...base, sessions: [row("a"), row("b")] });
		expect(slot.kind).toBe("list");
		if (slot.kind === "list") expect(ids(slot.list.recent)).toEqual(["a", "b"]);
	});
});

describe("a phone-access-off refusal keeps the list away through the real chain", () => {
	// The same chain home.tsx runs: the provider's refusal -> homeRecoveryKind ->
	// homeNamedRefusal -> `recovery` into the slot decision. No hand-set flag.
	const phoneAccessOff = () => {
		const error = tunnelSessionRelayError(
			new TunnelSessionError("disabled", "tunnel is unavailable", 403),
		);
		return refusalFromError({
			error,
			surface: error.surface,
			detail: error.detail ?? null,
			retryAfterMs: null,
			subject: "Studio Mac",
			computer: {
				billing: { active: false, eligible: null, message: null },
				rawStatus: "active",
			},
		});
	};

	it("yields a recovery kind and a named refusal, and the slot is none with five waiting", () => {
		const refusal = phoneAccessOff();
		expect(refusal?.copy?.cause).toBe("phone-access-off");
		// A refused tunnel is not a live route: `connected` is false.
		const kind = homeRecoveryKind({
			busy: false,
			coldStartSettled: true,
			connected: false,
			offline: false,
			refusal,
		});
		expect(kind).toBe("error");
		const named = homeNamedRefusal(kind, refusal);
		expect(named).not.toBeNull();
		const five = [1, 2, 3, 4, 5].map((n) => waiting(`w${n}`));
		// Even if the route were somehow live, the recovery state alone hides it.
		for (const connected of [false, true]) {
			expect(
				workListSlot({
					...base,
					connected,
					sessions: five,
					recovery: kind !== null || named !== null,
				}).kind,
			).toBe("none");
		}
	});
});

describe("workRowShape: titles wrap, then the folder goes, at large text (design D2)", () => {
	it("keeps one line and the folder through 1.3×", () => {
		for (const scale of [1, 1.15, WRAP_TITLE_ABOVE]) {
			for (const section of ["needs-you", "running", "recent"] as const) {
				expect(workRowShape(scale, section)).toEqual({
					titleLines: 1,
					showFolder: true,
				});
			}
		}
	});

	it("wraps every title to two lines above 1.3× and keeps the folder below 1.5×", () => {
		for (const section of ["needs-you", "running", "recent"] as const) {
			expect(workRowShape(1.4, section)).toEqual({
				titleLines: 2,
				showFolder: true,
			});
		}
	});

	it("drops the folder from running and recent rows from 1.5×, never from needs-you", () => {
		for (const scale of [DROP_META_FROM, 2]) {
			expect(workRowShape(scale, "needs-you")).toEqual({
				titleLines: 2,
				showFolder: true,
			});
			for (const section of ["running", "recent"] as const) {
				expect(workRowShape(scale, section)).toEqual({
					titleLines: 2,
					showFolder: false,
				});
			}
		}
	});
});

describe("the work list's wiring (source pins; Node cannot render these)", () => {
	const read = (name: string) =>
		readFileSync(new URL(name, import.meta.url), "utf8");

	it("hands the rows a stable open callback, so SessionRow's memo holds", () => {
		const home = read("./home.tsx");
		expect(home).toContain("onOpenSession={openWorkListSession}");
		expect(home).toContain("const openWorkListSession = useCallback(");
	});

	it("opens the drawer on Agents from the footer, as the header button does", () => {
		expect(read("./work-list-view.tsx")).toContain(
			'drawer.open({ returnFocus, mode: "agents" })',
		);
	});

	it("does not take or pass the dead onConnect prop", () => {
		// The splash's own props never name it; only HomeRecovery's call remains.
		const splash = read("./home-splash.tsx");
		const props = splash.slice(
			splash.indexOf("export type HomeSplashProps"),
			splash.indexOf("/** What the hero pill shows"),
		);
		expect(props).not.toContain("onConnect");
		expect(read("./home.tsx").split("onConnect=").length - 1).toBe(1);
	});
});
