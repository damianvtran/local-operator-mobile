import { describe, expect, it } from "vitest";
import type { DirectoryMember, Participant } from "@/team-bridge/contract";
import { buildMentionCandidates, notifiable } from "./candidates";
import {
	editDraft,
	type MentionDraft,
	mentionView,
	nextDismissed,
	pickMention,
} from "./mention-state";
import { serializeMentions } from "./tokens";

/** A lookup the test needs to have found something; fails loudly if not. */
const must = <T>(value: T | null | undefined): T => {
	if (value == null) throw new Error("expected a value");
	return value;
};

const person = (
	account_id: string,
	display_label: string,
	extra: Partial<DirectoryMember> = {},
): DirectoryMember =>
	({
		account_id,
		display_label,
		bridge_enabled: true,
		bridge_state: "active",
		...extra,
	}) as DirectoryMember;

const member = (
	account_id: string,
	kind: "human" | "agent",
	state: Participant["state"],
	display_label = "",
): Participant => ({ account_id, kind, display_label, role: "member", state });

const people = [
	person("a_me", "Me Myself", {
		agent: { endpoint_id: "bep_mine", name: "Robo", state: "active" },
	} as Partial<DirectoryMember>),
	person("a_ben", "Ben Tran", {
		agent: { endpoint_id: "bep_aida", name: "Aida", state: "active" },
	} as Partial<DirectoryMember>),
	person("a_sherman", "Sherman Tsui"),
	person("a_jose", "José Núñez", {
		bridge_enabled: false,
		bridge_state: "none",
	}),
];
const conversation = {
	members: [
		member("a_me", "human", "active", "Me Myself"),
		member("a_ben", "human", "active", "Ben Tran"),
		member("a_ben", "agent", "active", "Aida"),
		member("a_sherman", "human", "invited", "Sherman Tsui"),
		member("a_guest", "human", "active", "Guest Person"),
	],
};

describe("buildMentionCandidates", () => {
	const rows = buildMentionCandidates({
		conversation,
		people,
		selfAccountId: "a_me",
	});
	const by = (kind: string, id: string) =>
		rows.find((r) => r.kind === kind && r.accountId === id);

	it("leaves out the reader's own person but keeps their own agent", () => {
		expect(by("human", "a_me")).toBeUndefined();
		expect(by("agent", "a_me")?.label).toBe("Robo (Me Myself)");
	});
	it("labels an agent with its owner and finds it by either name", () => {
		const aida = by("agent", "a_ben");
		expect(aida).toMatchObject({
			label: "Aida (Ben Tran)",
			endpointId: "bep_aida",
			aliases: ["Aida", "Ben Tran"],
			member: true,
		});
	});
	it("an invited member is not a member", () => {
		expect(by("human", "a_sherman")).toMatchObject({
			member: false,
			invited: true,
		});
		expect(notifiable(must(by("human", "a_sherman")))).toBe(false);
	});
	it("a bridge-off person is offered but marked", () => {
		expect(by("human", "a_jose")?.bridgeOff).toBe(true);
	});
	it("members the directory does not list are offered by participant label", () => {
		expect(by("human", "a_guest")).toMatchObject({
			label: "Guest Person",
			member: true,
		});
	});
	it("with no directory, only conversation members are offered; agents can't notify", () => {
		const fallback = buildMentionCandidates({
			conversation,
			people: [],
			selfAccountId: "a_me",
		});
		expect(fallback.map((r) => `${r.kind}:${r.label}`)).toEqual([
			"human:Ben Tran",
			"agent:Aida",
			"human:Sherman Tsui",
			"human:Guest Person",
		]);
		const agent = must(fallback.find((r) => r.kind === "agent"));
		expect(notifiable(agent)).toBe(false);
	});
});

const candidates = buildMentionCandidates({
	conversation,
	people,
	selfAccountId: "a_me",
});
const draft = (text: string, caret = text.length): MentionDraft => ({
	text,
	tokens: [],
	caret,
	queryEnabled: true,
	dismissedAt: null,
});
const type = (from: MentionDraft, next: string) => {
	const r = editDraft(from, next);
	return { ...r, dismissedAt: nextDismissed(r, candidates) };
};

describe("the strip opens and closes like desktop", () => {
	it("ignores a passive caret update after restore until the text changes", () => {
		const restored = { ...draft("hi @be", 0), queryEnabled: false };
		expect(mentionView({ ...restored, caret: 6 }, candidates)).toBeNull();
		expect(mentionView(type(restored, restored.text), candidates)).toBeNull();
		expect(
			mentionView(type(restored, "hi @ben"), candidates)?.query.query,
		).toBe("ben");
	});
	it("@ in an empty composer and after a space opens it, everyone listed", () => {
		expect(mentionView(type(draft(""), "@"), candidates)?.flat.length).toBe(
			candidates.length,
		);
		expect(mentionView(type(draft("hi "), "hi @"), candidates)).not.toBeNull();
	});
	it("email, '@ ' and @ before a newline stay closed", () => {
		expect(mentionView(draft("ben@x.com"), candidates)).toBeNull();
		expect(mentionView(draft("@ "), candidates)).toBeNull();
		expect(mentionView(draft("@\n", 2), candidates)).toBeNull();
	});
	it("typed text before the caret event arrives already filters (Android order)", () => {
		// onChangeText first: the caret is estimated at the end of the insert.
		const d = type(draft("hi @b", 5), "hi @be");
		expect(d.caret).toBe(6);
		expect(mentionView(d, candidates)?.query.query).toBe("be");
	});
	it("a typed space that leaves zero matches closes it for that @ only", () => {
		let d = type(draft("@ben"), "@ben ");
		expect(mentionView(d, candidates)).not.toBeNull(); // "ben " still matches
		d = type(d, "@ben x");
		expect(d.dismissedAt).toBe(0);
		expect(mentionView(d, candidates)).toBeNull();
		d = type(d, "@ben xa");
		expect(mentionView(d, candidates)).toBeNull(); // stays closed
		d = type(d, "@ben xa @");
		expect(mentionView(d, candidates)).not.toBeNull(); // a new @ opens
	});
	it("no matches with a missing directory keeps the strip open to say why", () => {
		const fallback = buildMentionCandidates({
			conversation,
			people: [],
			selfAccountId: "a_me",
		});
		expect(mentionView(draft("@zz"), fallback, false)).toBeNull();
		expect(mentionView(draft("@zz"), fallback, true)?.flat).toEqual([]);
	});
});

describe("picking and editing", () => {
	const ben = must(
		candidates.find((c) => c.kind === "human" && c.accountId === "a_ben"),
	);
	const sherman = must(candidates.find((c) => c.accountId === "a_sherman"));
	const active = new Set(
		conversation.members
			.filter((m) => m.state === "active")
			.map((m) => `${m.kind}:${m.account_id}`),
	);

	it("a pick inserts '@Ben Tran ', places the caret after the space, and closes", () => {
		const d = type(draft("hi @be"), "hi @be");
		const view = must(mentionView(d, candidates));
		const picked = pickMention(d, view.query, ben, notifiable(ben));
		expect(picked.text).toBe("hi @Ben Tran ");
		expect(picked.selection).toBe(13);
		expect(mentionView(picked, candidates)).toBeNull();
		expect(serializeMentions(picked.tokens, active)).toEqual([
			{ kind: "human", account_id: "a_ben" },
		]);
	});
	it("an invited member inserts as text and sends no row", () => {
		const d = draft("@sh");
		const picked = pickMention(
			d,
			must(mentionView(d, candidates)).query,
			sherman,
			notifiable(sherman),
		);
		expect(picked.text).toBe("@Sherman Tsui ");
		expect(serializeMentions(picked.tokens, active)).toEqual([]);
	});
	it("backspace at the end of a mention removes the whole mention", () => {
		const d = draft("hi @be");
		const picked = pickMention(
			d,
			must(mentionView(d, candidates)).query,
			ben,
			true,
		);
		// "hi @Ben Tran " -> delete the space, then one more: into the token.
		const spaceGone = type(picked, "hi @Ben Tran");
		expect(spaceGone.tokens).toHaveLength(1);
		const whole = type(spaceGone, "hi @Ben Tra");
		expect(whole.text).toBe("hi ");
		expect(whole.selection).toBe(3);
		expect(whole.tokens).toEqual([]);
	});
	it("editing inside a mention turns it into plain text with no wire row", () => {
		const d = draft("@be");
		const picked = pickMention(
			d,
			must(mentionView(d, candidates)).query,
			ben,
			true,
		);
		const edited = type(picked, "@Bon Tran ");
		expect(edited.tokens).toEqual([]);
		expect(serializeMentions(edited.tokens, active)).toEqual([]);
	});
	it("the caret right after a placed mention does not reopen the strip on it", () => {
		const d = draft("@be");
		const picked = pickMention(
			d,
			must(mentionView(d, candidates)).query,
			ben,
			true,
		);
		expect(mentionView({ ...picked, caret: 9 }, candidates)).toBeNull();
	});
});
