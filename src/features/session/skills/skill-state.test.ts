import { describe, expect, it } from "vitest";
import type { SkillEntry } from "@/contracts";
import {
	dismissSkillDraft,
	editSkillDraft,
	initialSkillDraft,
	parseKey,
	pickSkill,
	type SkillDraft,
	shouldRevealSkillTray,
	skillView,
	trayHeightCanChange,
} from "./skill-state";

const SKILLS: SkillEntry[] = [
	{ name: "ape-agent", description: "Drive an agent", hidden: false },
	{ name: "architect", description: "Design first", hidden: false },
	{ name: "research", description: "Look it up", hidden: false },
	{ name: "secret", description: "By name only", hidden: true },
];

/** A draft the user typed into: armed, caret at the end of `text`. */
const typed = (text: string): SkillDraft =>
	editSkillDraft(initialSkillDraft(""), text);
const names = (draft: SkillDraft, enabled = true) =>
	skillView(draft, SKILLS, enabled)?.rows.map((row) => row.name) ?? null;

describe("skillView", () => {
	it("a bare leading $ lists the whole catalogue, in catalogue order", () => {
		expect(names(typed("$"))).toEqual([
			"ape-agent",
			"architect",
			"research",
			"secret",
		]);
	});
	it("narrows by case-insensitive prefix without re-sorting", () => {
		expect(names(typed("$a"))).toEqual(["ape-agent", "architect"]);
		expect(names(typed("$AR"))).toEqual(["architect"]);
	});
	it("an inline $ needs lowercase evidence: a bare one and $PATH stay closed", () => {
		expect(names(typed("fix $"))).toBeNull();
		expect(names(typed("costs $PATH"))).toBeNull();
		expect(names(typed("use $re"))).toEqual(["research"]);
	});
	it("a $ glued to a word is punctuation, never a sigil", () => {
		expect(names(typed("costs$re"))).toBeNull();
	});
	it("hidden skills are offered: being typed is the case `hide` leaves open", () => {
		expect(names(typed("$sec"))).toEqual(["secret"]);
	});
	it("closes when the catalogue says no, or the caller disables it", () => {
		expect(names(typed("$zzz"))).toBeNull();
		expect(names(typed("$a"), false)).toBeNull();
	});
	it("a restored draft is closed until the user acts on it", () => {
		const restored = initialSkillDraft("$re");
		expect(skillView(restored, SKILLS, true)).toBeNull();
		// A passive selection report alone (not armed) must not open it either.
		expect(skillView({ ...restored, caret: 3 }, SKILLS, true)).toBeNull();
		expect(names({ ...restored, caret: 3, armed: true })).toEqual(["research"]);
	});
	it("an unknown caret or a selected range reads as closed, not end-of-text", () => {
		expect(names({ ...typed("$re"), caret: null })).toBeNull();
	});
	it("follows the caret: inside the token opens, past it closes", () => {
		const draft = typed("a $re b");
		expect(names({ ...draft, caret: 5 })).toEqual(["research"]);
		expect(names({ ...draft, caret: 6 })).toBeNull();
		expect(names({ ...draft, caret: 1 })).toBeNull();
	});
});

describe("editSkillDraft", () => {
	it("estimates the caret at the end of the inserted span", () => {
		expect(typed("hello").caret).toBe(5);
		const mid = editSkillDraft(typed("hello world"), "hello $world");
		expect(mid.caret).toBe(7);
		expect(mid.armed).toBe(true);
	});
	it("typing past the token closes the tray with no dismissal needed", () => {
		const open = typed("$re");
		expect(names(open)).toEqual(["research"]);
		expect(names(editSkillDraft(open, "$re "))).toBeNull();
	});
	it("an edit invalidates a dismissal: the tray may open again", () => {
		const closed = dismissSkillDraft(typed("$re"));
		expect(names(closed)).toBeNull();
		expect(names(editSkillDraft(closed, "$res"))).toEqual(["research"]);
	});
	it("returns the same draft for an identical value", () => {
		const draft = typed("$re");
		expect(editSkillDraft(draft, "$re")).toBe(draft);
	});
});

describe("dismissal", () => {
	it("stays closed for the same caret and token, reopens for a different parse", () => {
		const closed = dismissSkillDraft(typed("$re and $ar"));
		// Caret still at the end of `$ar`: the dismissed parse.
		expect(names(closed)).toBeNull();
		// A move to the other token is a fresh decision.
		expect(names({ ...closed, caret: 3 })).toEqual(["research"]);
		// ...and so is a move within the same token.
		expect(names({ ...closed, caret: 10 })).toEqual(["architect"]);
	});
	it("has nothing to remember when no token is open", () => {
		const draft = typed("plain");
		expect(dismissSkillDraft(draft)).toBe(draft);
		expect(parseKey("plain", 5)).toBeNull();
	});
});

describe("pickSkill", () => {
	const pick = (text: string, caret: number, name: string) => {
		const draft = { ...typed(text), caret };
		const view = skillView(draft, SKILLS, true);
		if (view === null) throw new Error("tray closed");
		return pickSkill(draft, view, name);
	};
	it("replaces ONLY the token with $name and one space, caret after it", () => {
		const out = pick("fix $re now", 7, "research");
		expect(out.text).toBe("fix $research now");
		// `now` was already separated by a space: no second one is added.
		expect(out.selection).toBe("fix $research ".length);
		expect(out.caret).toBe(out.selection);
	});
	it("adds the terminator at the end of the draft and parks the caret past it", () => {
		const out = pick("$", 1, "ape-agent");
		expect(out.text).toBe("$ape-agent ");
		expect(out.selection).toBe(11);
		// The caret is past the token, so the tray is closed after the pick.
		expect(
			skillView({ ...out, text: out.text, caret: out.caret }, SKILLS, true),
		).toBeNull();
	});
	it("leaves prose before and after, and later lines, byte for byte", () => {
		const text = "line one\nuse $re\nlast line";
		const out = pick(text, 16, "research");
		expect(out.text).toBe("line one\nuse $research\nlast line");
		// A newline terminates the token without being a place to park the caret.
		expect(out.selection).toBe("line one\nuse $research".length);
	});
	it("tapping the name already typed (same buffer) still moves the caret out", () => {
		const out = pick("$research ", 9, "research");
		expect(out.text).toBe("$research ");
		expect(out.selection).toBe(10);
	});
});

describe("shouldRevealSkillTray", () => {
	const frame = (rows: number, capped: boolean) => ({ rows, capped });

	it("scrolls when the tray opens in a capped scroller", () => {
		expect(shouldRevealSkillTray(frame(0, true), frame(3, true))).toBe(true);
	});
	it("scrolls when the tray gains rows", () => {
		expect(shouldRevealSkillTray(frame(2, true), frame(5, true))).toBe(true);
	});
	it("scrolls when the cap arrives while the tray is already open", () => {
		expect(shouldRevealSkillTray(frame(3, false), frame(3, true))).toBe(true);
	});
	it("never scrolls an uncapped scroller", () => {
		expect(shouldRevealSkillTray(frame(0, false), frame(3, false))).toBe(false);
		expect(shouldRevealSkillTray(frame(0, true), frame(3, false))).toBe(false);
	});
	it("does not scroll when the tray is closed, shrinks or merely stays open", () => {
		expect(shouldRevealSkillTray(frame(3, true), frame(0, true))).toBe(false);
		expect(shouldRevealSkillTray(frame(5, true), frame(2, true))).toBe(false);
		expect(shouldRevealSkillTray(frame(3, true), frame(3, true))).toBe(false);
		expect(shouldRevealSkillTray(frame(0, true), frame(0, true))).toBe(false);
	});
});

describe("trayHeightCanChange", () => {
	it("is true while the tray is still growing toward its cap", () => {
		expect(trayHeightCanChange(0, 2)).toBe(true);
		expect(trayHeightCanChange(1, 3)).toBe(true);
		expect(trayHeightCanChange(3, 8)).toBe(true);
	});
	it("is false once the tray is full: more rows scroll inside it", () => {
		expect(trayHeightCanChange(4, 5)).toBe(false);
		expect(trayHeightCanChange(10, 40)).toBe(false);
	});
	it("is false when rows do not grow", () => {
		expect(trayHeightCanChange(2, 2)).toBe(false);
		expect(trayHeightCanChange(3, 1)).toBe(false);
	});
});
