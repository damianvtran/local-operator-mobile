import { describe, expect, it } from "vitest";
import {
	findMentionQuery,
	type MentionCandidate,
	matchTier,
	rankMentionCandidates,
} from "./matcher";
import {
	deleteAcrossToken,
	insertMention,
	rebaseTokens,
	serializeMentions,
} from "./tokens";

/*
 * Ported from desktop's case list (local-operator-ui
 * `scripts/team-bridge-mentions-model.test.mjs` @ 3786d6e8fb), so a name the
 * desktop composer finds is found the same way here. Desktop-only cases
 * (caret clamping for arrow keys, highlight segments, received-message
 * rendering) are not ported because mobile does not ship those parts.
 */

const ben: MentionCandidate = {
	kind: "human",
	accountId: "a_ben",
	label: "Ben Tran",
	member: true,
	bridgeOff: false,
};
const sherman: MentionCandidate = {
	kind: "human",
	accountId: "a_sherman",
	label: "Sherman Tsui",
	member: false,
	bridgeOff: false,
};
const ada: MentionCandidate = {
	kind: "human",
	accountId: "a_ada",
	label: "Ada Lovelace",
	member: true,
	bridgeOff: false,
};
const tara: MentionCandidate = {
	kind: "human",
	accountId: "a_tara",
	label: "Tara Bentley",
	member: false,
	bridgeOff: true,
};
const aida: MentionCandidate = {
	kind: "agent",
	accountId: "a_ben",
	endpointId: "bep_aida",
	label: "Aida (Ben Tran)",
	aliases: ["Aida", "Ben Tran"],
	member: true,
	bridgeOff: false,
};
const shermanChief: MentionCandidate = {
	kind: "agent",
	accountId: "a_sherman",
	endpointId: "bep_cos",
	label: "Chief of staff (Sherman Tsui)",
	member: false,
	bridgeOff: false,
};
const people = [ben, sherman, ada, tara, aida, shermanChief];

describe("findMentionQuery: the word boundary", () => {
	it("opens at the start, after whitespace or opening punctuation", () => {
		expect(findMentionQuery("@be", 3)).toEqual({
			start: 0,
			end: 3,
			query: "be",
		});
		expect(findMentionQuery("hi @be", 6)).toEqual({
			start: 3,
			end: 6,
			query: "be",
		});
		expect(findMentionQuery("(@be", 4)).toEqual({
			start: 1,
			end: 4,
			query: "be",
		});
		expect(findMentionQuery("hi @", 4)).toEqual({
			start: 3,
			end: 4,
			query: "",
		});
	});
	it("never opens inside an email or handle", () => {
		expect(findMentionQuery("ben@minerva", 11)).toBeNull();
		expect(findMentionQuery("mail a.b@x", 10)).toBeNull();
		expect(findMentionQuery("ben@x.com", 9)).toBeNull();
	});
	it("a space right after @ is prose, and a newline ends the query", () => {
		expect(findMentionQuery("@ ben", 5)).toBeNull();
		expect(findMentionQuery("@ben\nhi", 7)).toBeNull();
		expect(findMentionQuery("hi\n@", 4)).toEqual({
			start: 3,
			end: 4,
			query: "",
		});
	});
	it("a query may hold spaces, because names do", () => {
		expect(findMentionQuery("@Ben Tr", 7)).toEqual({
			start: 0,
			end: 7,
			query: "Ben Tr",
		});
	});
	it("an overlong run is prose, not a name", () => {
		const long = `@${"a".repeat(60)}`;
		expect(findMentionQuery(long, long.length)).toBeNull();
	});
	it("opens after Arabic-script punctuation (Urdu is shipped)", () => {
		for (const mark of ["،", "؛", "؟"])
			expect(findMentionQuery(`سلام${mark}@b`, 7)?.query).toBe("b");
	});
});

describe("matchTier", () => {
	it("full-name prefix, then word prefix, then substring, then fuzzy", () => {
		expect(matchTier("ben", { label: "Ben Tran" })).toBe(0);
		expect(matchTier("tran", { label: "Ben Tran" })).toBe(1);
		expect(matchTier("en tr", { label: "Ben Tran" })).toBe(2);
		expect(matchTier("btn", { label: "Ben Tran" })).toBe(3);
		expect(matchTier("zzz", { label: "Ben Tran" })).toBeNull();
	});
	it("no fuzzy below three letters: @ai finds Aida by prefix only", () => {
		expect(matchTier("bt", { label: "Ben Tran" })).toBeNull();
		expect(matchTier("ai", { label: "Ben Tran" })).toBeNull();
		// Fuzzy is an in-order subsequence (desktop's rule): "ada" is in
		// "Aida" in order, "adi" is not (the brief's "@adi" example was wrong).
		expect(matchTier("ada", { label: "Aida" })).toBe(3);
		expect(matchTier("adi", { label: "Aida" })).toBeNull();
	});
	it("ignores case and accents", () => {
		expect(matchTier("jose", { label: "José Núñez" })).toBe(0);
		expect(matchTier("élo", { label: "Elodie" })).toBe(0);
	});
	it("searches an agent by its own name and its owner's", () => {
		expect(matchTier("aida", aida)).toBe(0);
		expect(matchTier("ben", aida)).toBe(0);
	});
	it("an empty query matches everyone", () => {
		expect(matchTier("", { label: "Anyone" })).toBe(0);
	});
});

describe("rankMentionCandidates", () => {
	it("members before the org, people before agents, tiers inside a section", () => {
		const { sections, flat } = rankMentionCandidates("ben", people);
		expect(sections.map((s) => s.id)).toEqual([
			"member-human",
			"member-agent",
			"org-human",
		]);
		expect(flat.map((c) => `${c.kind}:${c.label}`)).toEqual([
			"human:Ben Tran",
			"agent:Aida (Ben Tran)",
			"human:Tara Bentley",
		]);
	});
	it("an empty query lists every section in order; ties keep directory order", () => {
		const all = rankMentionCandidates("", people);
		expect(all.sections.map((s) => s.id)).toEqual([
			"member-human",
			"member-agent",
			"org-human",
			"org-agent",
		]);
		expect(all.sections[0]?.rows.map((c) => c.label)).toEqual([
			"Ben Tran",
			"Ada Lovelace",
		]);
	});
	it("a word prefix in a later section never outranks section order", () => {
		const { flat } = rankMentionCandidates("t", people);
		expect(flat[0]?.label).toBe("Ben Tran");
		expect(flat.findIndex((c) => c.label === "Tara Bentley")).toBeGreaterThan(
			flat.findIndex((c) => c.label === "Aida (Ben Tran)"),
		);
	});
	it("nothing matching is an empty list", () => {
		expect(rankMentionCandidates("qqq", people).flat).toEqual([]);
	});
});

describe("tokens", () => {
	it("insert replaces @query with @Label and one space, and records the token", () => {
		const r = insertMention("hi @be", [], { start: 3, end: 6 }, ben);
		expect(r.text).toBe("hi @Ben Tran ");
		expect(r.caret).toBe(13);
		expect(r.tokens).toEqual([
			{
				start: 3,
				end: 12,
				kind: "human",
				accountId: "a_ben",
				label: "Ben Tran",
				notify: true,
			},
		]);
		expect(insertMention("@be there", [], { start: 0, end: 3 }, ben).text).toBe(
			"@Ben Tran there",
		);
	});
	it("rebase: edits before shift, inside drop, after keep", () => {
		const { text, tokens } = insertMention(
			"x @a",
			[],
			{ start: 2, end: 4 },
			ben,
		);
		expect(rebaseTokens(text, `yy${text}`, tokens)[0]?.start).toBe(4);
		expect(rebaseTokens(text, text.replace("Ben", "Bon"), tokens)).toEqual([]);
		expect(rebaseTokens(text, `${text}ok`, tokens)[0]?.start).toBe(2);
		expect(rebaseTokens(text, "", tokens)).toEqual([]);
	});
	it("a deletion touching a token removes it whole", () => {
		const { text, tokens } = insertMention(
			"hi @b",
			[],
			{ start: 3, end: 5 },
			ben,
		);
		const back = deleteAcrossToken(
			text,
			tokens,
			{ start: 12, end: 12 },
			"Backspace",
		);
		expect(back).toMatchObject({ text: "hi  ", caret: 3, tokens: [] });
		expect(
			deleteAcrossToken(text, tokens, { start: 13, end: 13 }, "Backspace"),
		).toBeNull();
		expect(
			deleteAcrossToken(text, tokens, { start: 1, end: 6 }, "Backspace")?.text,
		).toBe("h ");
	});
	it("serialize: active members only, notifying only, deduped, agents need an endpoint", () => {
		let s = insertMention("@b", [], { start: 0, end: 2 }, ben);
		s = insertMention(
			`${s.text}@a`,
			s.tokens,
			{ start: s.text.length, end: s.text.length + 2 },
			aida,
		);
		s = insertMention(
			`${s.text}@b`,
			s.tokens,
			{ start: s.text.length, end: s.text.length + 2 },
			ben,
		);
		s = insertMention(
			`${s.text}@s`,
			s.tokens,
			{ start: s.text.length, end: s.text.length + 2 },
			sherman,
			false,
		);
		expect(s.text).toBe("@Ben Tran @Aida (Ben Tran) @Ben Tran @Sherman Tsui ");
		expect(
			serializeMentions(s.tokens, new Set(["human:a_ben", "agent:a_ben"])),
		).toEqual([
			{ kind: "human", account_id: "a_ben" },
			{ kind: "agent", account_id: "a_ben", endpoint_id: "bep_aida" },
		]);
		// A member who left after the pick is dropped at send.
		expect(serializeMentions(s.tokens, new Set(["agent:a_ben"]))).toEqual([
			{ kind: "agent", account_id: "a_ben", endpoint_id: "bep_aida" },
		]);
		expect(
			serializeMentions([
				{
					start: 0,
					end: 1,
					kind: "agent",
					accountId: "x",
					label: "",
					notify: true,
				},
			]),
		).toEqual([]);
	});
});
