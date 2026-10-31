import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parsePayload } from "@/contracts";
import {
	AVATAR_CACHE_LIMIT,
	avatarRefOf,
	createAvatarCache,
} from "@/features/agent-avatar/agent-avatar";
import { CATALOGUES, renderFor, SHIPPED_LOCALES } from "@/i18n";
import { RelayError } from "@/relay/errors";

/**
 * The agent picture on the phone: when a row has one, how it is fetched and
 * cached by digest, and the "change it on the desktop" hint.
 *
 * The React halves (the header button, the row's corner badge) reach `uniwind`
 * through `@/ui`, which the Node host cannot import, so their WIRING is
 * asserted over the source (the `tags-wiring.test.ts` pattern) and their pixels
 * are the design round's frames.
 */

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const ref = (sha256 = SHA_A, agentId = "researcher") => ({ agentId, sha256 });

/** A relay's own 404 (`kind: rejected`), as `isRelayMissing` classifies it. */
const relayMissing = () =>
	new RelayError("rejected", "no avatar", { status: 404 });

describe("avatarRefOf: which rows draw a picture (fallback to the glyph)", () => {
	it("names a picture only when both agent_id and a sha256 digest are present", () => {
		expect(
			avatarRefOf({ agent_id: "researcher", avatar_sha256: SHA_A }),
		).toEqual({ agentId: "researcher", sha256: SHA_A });
	});

	it("an older relay that omits both fields keeps the glyph", () => {
		expect(avatarRefOf({})).toBeNull();
	});

	it.each([
		["no agent bound", { agent_id: null, avatar_sha256: SHA_A }],
		[
			"agent without a picture",
			{ agent_id: "researcher", avatar_sha256: null },
		],
		["empty agent id", { agent_id: "  ", avatar_sha256: SHA_A }],
		["not a digest", { agent_id: "researcher", avatar_sha256: "abc" }],
	])("%s keeps the glyph", (_name, row) => {
		expect(avatarRefOf(row)).toBeNull();
	});

	it("a remote (other device's) row never fetches a picture from this relay", () => {
		expect(
			avatarRefOf({
				agent_id: "researcher",
				avatar_sha256: SHA_A,
				locality: "remote",
			}),
		).toBeNull();
	});

	it("normalises an upper-case digest so one picture has one cache key", () => {
		expect(
			avatarRefOf({ agent_id: "r", avatar_sha256: SHA_A.toUpperCase() })
				?.sha256,
		).toBe(SHA_A);
	});

	it("the list frame's schema accepts the pair, and an older frame without it", () => {
		const base = {
			session_id: "9ed9e2f534cd",
			section: "active",
			conversation_name: "x",
			mtime: 1,
		};
		const frame = (row: object) =>
			parsePayload("sessionListFrame", {
				sessions: [row],
				degraded: [],
				capabilities: {},
			});
		const withPicture = frame({
			...base,
			agent_id: "researcher",
			avatar_sha256: SHA_A,
		});
		expect(avatarRefOf(withPicture.sessions[0] as object)).toEqual(ref());
		const older = frame(base);
		expect(avatarRefOf(older.sessions[0] as object)).toBeNull();
	});
});

describe("createAvatarCache: one fetch per digest", () => {
	it("fetches a digest once, and serves every later caller from the cache", async () => {
		const cache = createAvatarCache();
		let calls = 0;
		const load = async () => {
			calls += 1;
			return "data:image/png;base64,AAAA";
		};
		await expect(cache.get(ref(), load)).resolves.toBe(
			"data:image/png;base64,AAAA",
		);
		await expect(cache.get(ref(), load)).resolves.toBe(
			"data:image/png;base64,AAAA",
		);
		/* Two agents sharing one picture share its bytes: the key is the digest. */
		await cache.get(ref(SHA_A, "other-agent"), load);
		expect(calls).toBe(1);
		expect(cache.peek(ref())).toBe("data:image/png;base64,AAAA");
	});

	it("concurrent callers for one digest share a single request", async () => {
		const cache = createAvatarCache();
		let calls = 0;
		let release: (value: string) => void = () => {};
		const load = () => {
			calls += 1;
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		};
		const first = cache.get(ref(), load);
		const second = cache.get(ref(), load);
		expect(cache.peek(ref())).toBeUndefined();
		release("uri");
		await expect(Promise.all([first, second])).resolves.toEqual(["uri", "uri"]);
		expect(calls).toBe(1);
	});

	it("a new digest (the picture changed) is a miss and fetches again", async () => {
		const cache = createAvatarCache();
		const seen: string[] = [];
		const load = async (target: { sha256: string }) => {
			seen.push(target.sha256);
			return `uri-${target.sha256.slice(0, 1)}`;
		};
		await cache.get(ref(SHA_A), load);
		await expect(cache.get(ref(SHA_B), load)).resolves.toBe("uri-b");
		expect(seen).toEqual([SHA_A, SHA_B]);
	});

	it("the relay's own 404 settles to null (glyph) and is not re-fetched", async () => {
		const cache = createAvatarCache();
		let calls = 0;
		const load = async () => {
			calls += 1;
			throw relayMissing();
		};
		await expect(cache.get(ref(), load)).resolves.toBeNull();
		await expect(cache.get(ref(), load)).resolves.toBeNull();
		expect(calls).toBe(1);
		expect(cache.peek(ref())).toBeNull();
	});

	it("a transport failure rejects and is NOT cached, so the next render retries", async () => {
		const cache = createAvatarCache();
		let calls = 0;
		const load = async () => {
			calls += 1;
			if (calls === 1) throw new RelayError("transport", "offline");
			return "uri";
		};
		await expect(cache.get(ref(), load)).rejects.toBeInstanceOf(RelayError);
		expect(cache.peek(ref())).toBeUndefined();
		await expect(cache.get(ref(), load)).resolves.toBe("uri");
		expect(calls).toBe(2);
	});

	it("is bounded: the least recently used digest is evicted", async () => {
		const cache = createAvatarCache(2);
		const load = async (target: { sha256: string }) => target.sha256;
		const c = "c".repeat(64);
		await cache.get(ref(SHA_A), load);
		await cache.get(ref(SHA_B), load);
		await cache.get(ref(SHA_A), load); // touch A, so B is the oldest
		await cache.get(ref(c), load);
		expect(cache.size()).toBe(2);
		expect(cache.peek(ref(SHA_B))).toBeUndefined();
		expect(cache.peek(ref(SHA_A))).toBe(SHA_A);
		expect(AVATAR_CACHE_LIMIT).toBeGreaterThan(0);
	});
});

describe("the desktop hint", () => {
	it("is the agreed English sentence", () => {
		expect(renderFor("mobile.agent_avatar.edit_hint", {}, "en")).toBe(
			"Change this picture in the desktop app",
		);
	});

	it("is translated in every shipped locale, not English stand-in", () => {
		for (const locale of SHIPPED_LOCALES) {
			if (locale === "en") continue;
			const catalogue = CATALOGUES[locale] as Record<string, string>;
			const hint = catalogue["mobile.agent_avatar.edit_hint"];
			expect(hint, locale).toBeTruthy();
			expect(hint, locale).not.toBe("Change this picture in the desktop app");
		}
	});
});

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/* The wiring patterns, top-level so each is compiled once (biome). */
const PRESS_SHOWS_HINT =
	/onPress=\{\(\) => showToast\(hint\)\}\s*onLongPress=\{\(\) => showToast\(hint\)\}/;
const HINT_KEY = /const hint = t\("mobile\.agent_avatar\.edit_hint"\)/;
const HINT_SPOKEN = /accessibilityHint=\{hint\}/;
const NOTHING_WITHOUT_PICTURE = /if \(uri === null\) return null;/;
const BUDGET_CHARGE =
	/^\s*(?:\{ dot: true, menu: ended, )?avatar: headerAvatarRef !== null/gm;
const ROW_REF = /<AgentListRow\s+avatarRef=\{avatarRefOf\(session\)\}/;
const CORNER_DEFAULT =
	/LIST_ROW_STATUS_PLACEMENT = "corner" as ListRowStatusPlacement/;
const PLAIN_SLOT =
	/leading === undefined \? \(\s*<Indicator attention=\{attention\} \/>/;
const BADGED =
	/<LeadingWithBadge attention=\{attention\}>\{leading\}<\/LeadingWithBadge>/;

describe("wiring (asserted over the source; frames are the design round's)", () => {
	const VIEW = read("./agent-avatar-view.tsx");
	const SCREEN = read("../../../app/(app)/session/[id].tsx");
	const PANE = read("../sessions/conversations-pane.tsx");
	const ROW = read("../../ui/components/list-row.tsx");

	it("a tap AND a long press on the header picture show the desktop hint", () => {
		expect(VIEW).toMatch(PRESS_SHOWS_HINT);
		expect(VIEW).toMatch(HINT_KEY);
		expect(VIEW).toMatch(HINT_SPOKEN);
	});

	it("the header draws nothing without a picture (the glyph stays as today)", () => {
		expect(VIEW).toMatch(NOTHING_WITHOUT_PICTURE);
	});

	it("the header picture sits in the leading cluster, before the title control", () => {
		const leading = SCREEN.indexOf("<NavigationMark />");
		const avatar = SCREEN.indexOf("<HeaderAgentAvatar");
		const title = SCREEN.indexOf("<SessionHealthControl");
		expect(leading).toBeGreaterThan(0);
		expect(avatar).toBeGreaterThan(leading);
		expect(title).toBeGreaterThan(avatar);
	});

	it("the title budget charges the picture only when the row names one", () => {
		/* Both inline budgets (regular and compact); the third match is the
		 *  comment beside the picture naming the same expression. */
		expect(SCREEN.match(BUDGET_CHARGE)?.length).toBe(2);
	});

	it("the list rows resolve their picture from the row's own fields", () => {
		expect(PANE).toMatch(ROW_REF);
	});

	it("a pictured row keeps its status: corner badge by default, never replaced", () => {
		expect(ROW).toMatch(CORNER_DEFAULT);
		expect(ROW).toMatch(PLAIN_SLOT);
		expect(ROW).toMatch(BADGED);
	});
});
