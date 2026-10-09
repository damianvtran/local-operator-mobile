import { describe, expect, it } from "vitest";

import type { SessionSummary } from "@/contracts";
import {
	attentionWord,
	degradedNote,
	degradedShortNote,
	isRemoteRow,
	relativeTimeFor,
	remoteAttention,
	remoteDeviceLabel,
	rowMark,
	splitSidebarSections,
	staleNote,
	staleShortNote,
	unreadBadgeCount,
	visiblePeers,
} from "@/features/sessions/session-projection";

/**
 * The list's decisions, where a decision is not observable from a rendered frame.
 *
 * The screen itself is proved end to end against the mock relay (the capture
 * matrix's populated/streaming/degraded/ended states), so nothing here renders a
 * component or asserts markup. What is left is the precedence a reviewer argues
 * with, the grouping rule, and the two sentences that must not say the wrong
 * thing about a list that is old or incomplete.
 */

/** A session with every field defaulted, so each case states only what it means. */
function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		session_id: "abc12345678",
		section: "active",
		pinned: false,
		conversation_name: "a conversation",
		cwd: "/home/me/projects/app",
		model_label: "opus",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: 0,
		subagents_queued: 0,
		todos_open: 0,
		mtime: 0,
		completion_kind: "",
		...overrides,
	};
}

/** A REMOTE row (another device's conversation), with only its own fields set:
 *  the local-only fields are ABSENT on the wire — the boundary's defaults fill
 *  them, and these cases exist to prove nothing reads those defaults. */
function remoteSession(
	overrides: Partial<SessionSummary> = {},
): SessionSummary {
	return session({
		locality: "remote",
		owner_device: "d_peer000001",
		owner_device_name: "Studio mini",
		reachable: true,
		live_state: "",
		pending: null,
		...overrides,
	});
}

describe("rowMark", () => {
	it("picks the mark by the flow's precedence, first match wins", () => {
		// The case the whole ranking exists for is the first row: an approval gate
		// runs INSIDE a turn, so the loudest row in the list arrives carrying both
		// `needs_attention` and `streaming`, and ranking streaming first would swap
		// the danger mark for a neutral one on exactly that row.
		const cases: Array<[Partial<SessionSummary>, string]> = [
			[{ needs_attention: true, streaming: true, unseen: true }, "decision"],
			[{ streaming: true, unseen: true, ended: true }, "running"],
			[{ unseen: true, ended: true, degraded: true }, "new"],
			[{ ended: true, degraded: true }, "ended"],
			[{ degraded: true }, "degraded"],
			[{}, "idle"],
		];
		for (const [flags, expected] of cases) {
			expect(rowMark(session(flags))).toBe(expected);
		}
	});

	it("treats an absent health receipt exactly like false", () => {
		// Both receipts are optional on the wire: an older relay omits them and
		// absence reads as false, so a plain session must not render as ended.
		expect(rowMark(session({ ended: undefined, degraded: undefined }))).toBe(
			"idle",
		);
	});
});

describe("attentionWord", () => {
	it("names an ask a question, and defaults an unlabelled decision to approval", () => {
		expect(attentionWord(session({ pending_kind: "ask" }))).toBe("question");
		// `pending_kind` is "" when a relay reports a decision without saying which;
		// the row still has to carry a word rather than an empty slot.
		expect(attentionWord(session({ pending_kind: "" }))).toBe("approval");
	});
});

describe("unreadBadgeCount", () => {
	it("reads the machine's own count off the block", () => {
		// One number, one source: whatever the machine read (a conversation with
		// three unread completions counts once) is what the badge shows.
		expect(
			unreadBadgeCount({ count: 2, revision: [3, 2, 0], degraded: [] }),
		).toBe(2);
	});

	it("distinguishes a readable zero from unknown", () => {
		// `0` is a real answer (it clears the badge); a missing block and a missing
		// `count` are both UNKNOWN, and unknown must never render as 0.
		expect(
			unreadBadgeCount({ count: 0, revision: [2, 2, 0], degraded: [] }),
		).toBe(0);
		expect(unreadBadgeCount(null)).toBeNull();
		expect(
			unreadBadgeCount({ revision: [2, 0, 0], degraded: ["attention"] }),
		).toBeNull();
	});
});

/** Local noon on a fixed calendar day, so the section boundaries are asserted in
 *  the reader's own timezone rather than in UTC. */
const NOON = new Date(2026, 9, 3, 12, 0, 0, 0).getTime(); // 2026-10-03 12:00 local
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS_T = 24 * HOUR_MS;

describe("splitSidebarSections", () => {
	it("groups without re-sorting; pinned outranks, running outranks the time bins", () => {
		// The relay sorts rows so the phone, the TUI and the desktop agree; a client
		// that re-ordered them would be a fourth opinion. A pinned CONVERSATION
		// belongs with the pinned ones, or pinning an old session appears to do
		// nothing at all — and a running row is Running even at 10 days old, because
		// "what is working right now" is the question that section answers.
		const sections = splitSidebarSections(
			[
				session({ session_id: "1", mtime: NOON / 1000 - 60 }),
				session({
					session_id: "2",
					pinned: true,
					mtime: NOON / 1000 - (30 * DAY_MS_T) / 1000,
				}),
				session({
					session_id: "3",
					streaming: true,
					mtime: NOON / 1000 - (30 * DAY_MS_T) / 1000,
				}),
				session({
					session_id: "4",
					needs_attention: true,
					mtime: NOON / 1000 - (9 * DAY_MS_T) / 1000,
				}),
				session({
					session_id: "5",
					mtime: NOON / 1000 - (3 * DAY_MS_T) / 1000,
				}),
				session({
					session_id: "6",
					mtime: NOON / 1000 - (40 * DAY_MS_T) / 1000,
				}),
			],
			NOON,
		);
		expect(sections.pinned.map((s) => s.session_id)).toEqual(["2"]);
		expect(sections.running.map((s) => s.session_id)).toEqual(["3", "4"]);
		expect(sections.today.map((s) => s.session_id)).toEqual(["1"]);
		expect(sections.week.map((s) => s.session_id)).toEqual(["5"]);
		expect(sections.older.map((s) => s.session_id)).toEqual(["6"]);
	});

	it("reads calendar days, so last night is not today", () => {
		// "Today" is the word on screen: a conversation from 11 pm yesterday is not
		// from today at 9 am, whatever a rolling 24 h says.
		const sections = splitSidebarSections(
			[
				session({
					session_id: "late",
					mtime: NOON / 1000 - (15 * HOUR_MS) / 1000,
				}),
				session({
					session_id: "early",
					mtime: NOON / 1000 - (3 * HOUR_MS) / 1000,
				}),
			],
			NOON,
		);
		expect(sections.today.map((s) => s.session_id)).toEqual(["early"]);
		expect(sections.week.map((s) => s.session_id)).toEqual(["late"]);
	});

	it("reads `created_at` before `mtime`, and the seven-day edge is held", () => {
		// The wire's two clocks: `created_at` is the basis when a relay sends it
		// (older relays omit it). At exactly seven days the row is Older — "within
		// seven days" is strict, and a row that flips on a rounding error is worse
		// than one that flips a second early.
		const sixDays = session({
			session_id: "six",
			mtime: NOON / 1000 - (90 * DAY_MS_T) / 1000,
			created_at: NOON / 1000 - (6 * DAY_MS_T) / 1000,
		});
		const sevenDays = session({
			session_id: "seven",
			mtime: NOON / 1000 - (7 * DAY_MS_T) / 1000,
		});
		const sections = splitSidebarSections([sixDays, sevenDays], NOON);
		expect(sections.week.map((s) => s.session_id)).toEqual(["six"]);
		expect(sections.older.map((s) => s.session_id)).toEqual(["seven"]);
	});
});

describe("relativeTimeFor", () => {
	it("spells the units the panel's rows use, and none for a running row", () => {
		// The section says WHEN; the row must say how long ago. Minutes are spelled
		// `min` (the spec's examples), and a running row carries no time at all —
		// "now" is all a running row's time could say, and the section already does.
		const at = (ms: number) => session({ mtime: NOON / 1000 - ms / 1000 });
		expect(relativeTimeFor(at(30 * 1000), NOON)).toBe("now");
		expect(relativeTimeFor(at(5 * MINUTE_MS), NOON)).toBe("5 min");
		expect(relativeTimeFor(at(59 * MINUTE_MS), NOON)).toBe("59 min");
		expect(relativeTimeFor(at(3 * HOUR_MS), NOON)).toBe("3h");
		expect(relativeTimeFor(at(2 * DAY_MS_T), NOON)).toBe("2d");
		expect(relativeTimeFor(at(10 * DAY_MS_T), NOON)).toBe("1w");
		expect(relativeTimeFor(at(400 * DAY_MS_T), NOON)).toBe("1y");
		expect(
			relativeTimeFor(session({ mtime: NOON / 1000, streaming: true }), NOON),
		).toBeNull();
		expect(
			relativeTimeFor(
				session({ mtime: NOON / 1000, needs_attention: true }),
				NOON,
			),
		).toBeNull();
	});
});

describe("staleNote", () => {
	it("carries the age, and says nothing when there is nothing to be stale about", () => {
		// The cold-start rule: the last known list keeps rendering while the stream
		// reconnects, marked as old. "Stale" alone gives a reader no way to judge
		// whether to wait, and a list no frame has ever reached is not stale — it is
		// empty, which is a different screen.
		expect(
			staleNote({ stale: false, lastFrameAt: 1_000, now: 2_000 }),
		).toBeNull();
		expect(
			staleNote({ stale: true, lastFrameAt: null, now: 2_000 }),
		).toBeNull();
		expect(staleNote({ stale: true, lastFrameAt: 1_000, now: 31_000 })).toBe(
			"Last updated 30s ago.",
		);
		expect(
			staleNote({ stale: true, lastFrameAt: 1_000, now: 1_000 + 5 * 60_000 }),
		).toBe("Last updated 5 min ago.");
	});
});

describe("degradedNote", () => {
	it("says which kind of degradation it is", () => {
		// `sessions` means rows may be MISSING and `attention` means the new markers
		// may be out of date. A reader who sees a short list with no explanation will
		// believe it is complete.
		expect(degradedNote([])).toBeNull();
		expect(degradedNote(["sessions"])).toContain("missing rows");
		expect(degradedNote(["attention"])).toContain("out of date");
		expect(degradedNote(["sessions", "attention"])).toContain("incomplete");
	});
});

/**
 * The two short forms, which exist because of a measured line budget rather than
 * for style: at 320 pt with the platform text at 200 % the degraded banner is
 * capped at two lines (about 52 characters) and the stale line beside it at one
 * (about twelve), and the long sentences run 22 to 80. What must hold is that
 * the SHORT form is complete in its own right — the reader gets the whole
 * sentence, not a truncation of it — and that the two forms of one fact never
 * disagree.
 */
describe("the narrow-configuration short forms", () => {
	/** The characters one `body-sm` line holds at 200 % in a 232 dp column,
	 *  MEASURED rather than assumed: the banner's own first line broke after
	 *  `Some rows may be` (16 characters) and the 24-character refusal detail took
	 *  two lines, so a line holds at least 16 and fewer than 25. */
	const LINE_CHARS = 16;
	/** Where the one-line bound is asserted: four characters under the measurement
	 *  above, because a bound that sits exactly on a measurement has no margin for
	 *  a different glyph mix (review round 2, R2-5). */
	const STALE_CHARS = 12;

	it("keeps every degraded kind distinguishable, and inside its two lines", () => {
		expect(degradedShortNote(["sessions"])).toContain("missing");
		expect(degradedShortNote(["attention"])).toContain("stale");
		expect(degradedShortNote(["sessions", "attention"])).toContain(
			"incomplete",
		);
		for (const degraded of [
			["sessions"],
			["attention"],
			["sessions", "attention"],
		]) {
			expect(degradedShortNote(degraded).length).toBeLessThanOrEqual(
				LINE_CHARS * 2,
			);
		}
	});

	it("carries the age in a form one line can hold", () => {
		// The long form is `Last updated 30s ago.` — 22 characters, which one line
		// truncates to `Last updated …` and so hides the only fact this line carries
		// (review round 1, D3).
		expect(staleShortNote({ stale: false, lastFrameAt: 1_000 })).toBeNull();
		expect(staleShortNote({ stale: true, lastFrameAt: null })).toBeNull();
		expect(
			staleShortNote({ stale: true, lastFrameAt: 1_000, now: 2_000 }),
		).toBe("Just now.");
		expect(
			staleShortNote({ stale: true, lastFrameAt: 1_000, now: 31_000 }),
		).toBe("30s ago.");
		expect(
			staleShortNote({
				stale: true,
				lastFrameAt: 1_000,
				now: 1_000 + 5 * 60_000,
			}),
		).toBe("5 min ago.");
	});

	it("stays inside one line at every age a list can be", () => {
		// R2-5: the minutes-only form grew without limit — a week-old list read
		// `10080 min ago.` — so the bound is asserted at the far end of the range,
		// not only at the ages the fixtures happen to sit in.
		const ages = [
			0,
			4_000,
			30_000,
			59_000,
			60_000,
			59 * 60_000,
			60 * 60_000,
			23 * 3_600_000,
			24 * 3_600_000,
			7 * 86_400_000,
			400 * 86_400_000,
		];
		for (const elapsed of ages) {
			const short = staleShortNote({
				stale: true,
				lastFrameAt: 0,
				now: elapsed,
			});
			expect(short).not.toBeNull();
			expect((short ?? "").length).toBeLessThanOrEqual(STALE_CHARS);
		}
		expect(
			staleShortNote({
				stale: true,
				lastFrameAt: 0,
				now: 7 * 86_400_000,
			}),
		).toBe("7d ago.");
	});

	it("never says a different age from the long form it replaces", () => {
		// One phrase behind both: a short form that drifted from the long one would
		// put two ages on the same screen, one in the pill and one beneath it.
		for (const elapsed of [
			0,
			4_000,
			5_000,
			59_000,
			60_000,
			299_000,
			3_600_000,
			86_400_000,
			7 * 86_400_000,
		]) {
			const input = { stale: true, lastFrameAt: 0, now: elapsed };
			const long = staleNote(input) ?? "";
			const short = staleShortNote(input) ?? "";
			expect(long.length).toBeGreaterThan(short.length);
			const age = short.slice(0, -1);
			expect(long.toLowerCase()).toContain(age.toLowerCase());
		}
	});
});

describe("remote rows", () => {
	const at = (ms: number) => NOON / 1000 - ms / 1000;

	it("is decided by `locality` alone — never by a missing cwd or a defaulted flag", () => {
		expect(isRemoteRow(remoteSession())).toBe(true);
		expect(isRemoteRow(session())).toBe(false);
		// A future relay that stamps `"local"` on every row reads exactly like
		// absence, and a row that merely LOOKS incomplete (no cwd, no model) is
		// not remote: the boundary defaults make every local row look complete and
		// every remote row look local. The discriminator is the only reading.
		expect(isRemoteRow(session({ locality: "local", cwd: "" }))).toBe(false);
	});

	it("bins by the transport's own words: approval/answer/busy/wedged are Running", () => {
		// The relay's vocabulary, verbatim. A live but idle row is NOT Running (it
		// is live, not working), and an `attached` row means a terminal is
		// watching — neither invents a third spelling of "running".
		const sections = splitSidebarSections(
			[
				remoteSession({
					session_id: "approval",
					pending: "approval",
					mtime: at(30 * DAY_MS_T),
				}),
				remoteSession({
					session_id: "answer",
					pending: "answer",
					mtime: at(30 * DAY_MS_T),
				}),
				remoteSession({
					/* Round 1, R1-1: the live wire's OTHER gate word — a peer waiting
					 *  on a free-text question. It bins and marks exactly like the
					 *  answer family it belongs to. */
					session_id: "ask",
					pending: "ask",
					mtime: at(30 * DAY_MS_T),
				}),
				remoteSession({
					session_id: "busy",
					live_state: "busy",
					mtime: at(30 * DAY_MS_T),
				}),
				remoteSession({
					session_id: "wedged",
					live_state: "wedged",
					mtime: at(30 * DAY_MS_T),
				}),
				remoteSession({
					session_id: "idle",
					live_state: "idle",
					mtime: at(5 * MINUTE_MS),
				}),
				remoteSession({
					session_id: "attached",
					live_state: "attached",
					mtime: at(5 * MINUTE_MS),
				}),
				remoteSession({
					session_id: "cold",
					live_state: "",
					mtime: at(40 * DAY_MS_T),
				}),
			],
			NOON,
		);
		expect(sections.running.map((s) => s.session_id)).toEqual([
			"approval",
			"answer",
			"ask",
			"busy",
			"wedged",
		]);
		expect(sections.today.map((s) => s.session_id)).toEqual([
			"idle",
			"attached",
		]);
		expect(sections.older.map((s) => s.session_id)).toEqual(["cold"]);
	});

	it("pins a remote row by this device's own pin, before any bin", () => {
		const sections = splitSidebarSections(
			[
				remoteSession({
					session_id: "pinned",
					pinned: true,
					mtime: at(30 * DAY_MS_T),
				}),
			],
			NOON,
		);
		expect(sections.pinned.map((s) => s.session_id)).toEqual(["pinned"]);
		expect(sections.running).toEqual([]);
	});

	it("a <= 0 stamp is a NO CLAIM: no label, Older, and never an ancient date", () => {
		// An old-build peer's non-number birth stamp arrives as `0.0`; the row
		// must paint NO label and file by the time branch (Older) with the relay's
		// own order kept (it ranked the no-claim row last inside its bin).
		const zero = remoteSession({ session_id: "zero", created_at: 0, mtime: 0 });
		const negative = remoteSession({
			session_id: "negative",
			created_at: -5,
			mtime: -5,
		});
		const real = remoteSession({
			session_id: "real",
			created_at: at(40 * DAY_MS_T),
			mtime: at(40 * DAY_MS_T),
		});
		expect(relativeTimeFor(zero, NOON)).toBeNull();
		expect(relativeTimeFor(negative, NOON)).toBeNull();
		expect(relativeTimeFor(real, NOON)).toBe("5w");
		const sections = splitSidebarSections([real, zero, negative], NOON);
		expect(sections.older.map((s) => s.session_id)).toEqual([
			"real",
			"zero",
			"negative",
		]);
	});

	it("a remote row's gate words map onto the two words this surface shows", () => {
		expect(remoteAttention(remoteSession({ pending: "approval" }))).toBe(
			"approval",
		);
		expect(remoteAttention(remoteSession({ pending: "answer" }))).toBe(
			"answer",
		);
		// Round 1, R1-1: the vocabulary is OPEN — `ask` is a real gate word, and
		// only `approval` spells approval; every other non-empty word is the
		// answer family this surface spells "question".
		expect(remoteAttention(remoteSession({ pending: "ask" }))).toBe("answer");
		expect(remoteAttention(remoteSession({ pending: "future_gate" }))).toBe(
			"answer",
		);
		// An empty word is NO gate, not an answer: the relay's boundary turns it
		// into `null`, and the truthiness reading keeps that true if one arrives.
		expect(remoteAttention(remoteSession({ pending: "" }))).toBeNull();
		expect(remoteAttention(remoteSession())).toBeNull();
		expect(attentionWord(remoteSession({ pending: "approval" }))).toBe(
			"approval",
		);
		expect(attentionWord(remoteSession({ pending: "answer" }))).toBe(
			"question",
		);
		expect(attentionWord(remoteSession({ pending: "ask" }))).toBe("question");
		// A local row's reading is untouched.
		expect(attentionWord(session({ pending_kind: "ask" }))).toBe("question");
	});

	it("marks a remote row from the transport's words, with the local ladder untouched", () => {
		expect(rowMark(remoteSession({ pending: "approval" }))).toBe("decision");
		// The answer family — `ask` included — is the same decision mark.
		expect(rowMark(remoteSession({ pending: "ask" }))).toBe("decision");
		expect(rowMark(remoteSession({ pending: "future_gate" }))).toBe("decision");
		expect(rowMark(remoteSession({ live_state: "busy" }))).toBe("running");
		// `wedged` is the owner having STOPPED reporting: the degraded mark, which
		// says a person is needed, not a spinner.
		expect(rowMark(remoteSession({ live_state: "wedged" }))).toBe("degraded");
		expect(rowMark(remoteSession({ live_state: "idle" }))).toBe("idle");
		// The local defaults a remote row carries (streaming false, unseen false)
		// must not be consulted: a busy remote row is running, not idle.
		expect(
			rowMark(remoteSession({ live_state: "busy", streaming: false })),
		).toBe("running");
	});

	it("labels a device by its name, else the id's tail — never the id whole", () => {
		expect(remoteDeviceLabel(remoteSession())).toBe("Studio mini");
		expect(
			remoteDeviceLabel(
				remoteSession({
					owner_device_name: "",
					owner_device: "d_0000a1b2c3d4",
				}),
			),
		).toBe("device …b2c3d4");
		expect(
			remoteDeviceLabel(
				remoteSession({ owner_device_name: "", owner_device: "" }),
			),
		).toBe("another device");
	});

	it("reveals each device once, in first-seen order, and skips rows with no id", () => {
		const peers = visiblePeers([
			session({ session_id: "local" }),
			remoteSession({
				session_id: "a",
				owner_device: "d_a",
				owner_device_name: "Alpha",
			}),
			remoteSession({
				session_id: "b",
				owner_device: "d_b",
				owner_device_name: "Beta",
			}),
			remoteSession({
				session_id: "a2",
				owner_device: "d_a",
				owner_device_name: "Alpha",
			}),
			remoteSession({
				session_id: "anon",
				owner_device: "",
				owner_device_name: "",
			}),
		]);
		expect(peers).toEqual([
			{ deviceId: "d_a", label: "Alpha" },
			{ deviceId: "d_b", label: "Beta" },
		]);
	});
});
