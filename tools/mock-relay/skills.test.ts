/**
 * The `$skill` surface of the mock relay, over a real socket: the TOP-LEVEL
 * capability, the catalogue route, the `expand_skills` flag and its receipt.
 *
 * The app's tests prove the phone's half; this pins the mock's half, so a mock
 * that quietly served the picker on an older relay (or dropped the receipt) cannot
 * make a flow look green for the wrong reason. Rules mirrored from the relay
 * (`daemon.py` `api_skills`, `api_command`): only a literal `true` expands, the
 * receipt's `skills` block is present whenever expansion ran, an unknown session
 * is `404 unknown_session`, and the capability is absent from every scenario that
 * does not serve the picker.
 */

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createRelay, DEFAULT_PASSWORD } from "./relay.ts";
import { syntheticSessionId } from "./wire.ts";

const ROW = syntheticSessionId("skills-row");

interface Rig {
	base: string;
	cookie: string | null;
	stop: () => Promise<void>;
}
const rigs: Rig[] = [];

async function start(scenario: string): Promise<Rig> {
	const relay = createRelay({
		scenario,
		password: DEFAULT_PASSWORD,
		quiet: true,
	});
	const { url } = await relay.listen({ port: 0 });
	const login = await fetch(new URL("/login", url), {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const cookie =
		(login.headers.getSetCookie?.() ?? [])[0]?.split(";")[0] ?? null;
	const rig = { base: url, cookie, stop: () => relay.shutdown() };
	rigs.push(rig);
	return rig;
}

const headers = (rig: Rig, json = false) => {
	const h = new Headers({ origin: rig.base });
	if (json) h.set("content-type", "application/json");
	if (rig.cookie !== null) h.set("cookie", rig.cookie);
	return h;
};

const get = (rig: Rig, path: string) =>
	fetch(new URL(path, rig.base), { headers: headers(rig) });

const prompt = (rig: Rig, body: Record<string, unknown>, session = ROW) =>
	fetch(new URL(`/api/sessions/${session}/command`, rig.base), {
		method: "POST",
		headers: headers(rig, true),
		body: JSON.stringify({
			op: "prompt",
			command_id: randomUUID(),
			...body,
		}),
	});

afterEach(async () => {
	await Promise.all(rigs.splice(0).map((rig) => rig.stop()));
});

describe("the capability", () => {
	it("is a TOP-LEVEL key, present only in a scenario that serves the picker", async () => {
		const rig = await start("skills");
		const list = (await (await get(rig, "/api/sessions")).json()) as {
			capabilities: Record<string, unknown>;
		};
		expect(list.capabilities.skill_invocation).toEqual({ available: true });

		const older = await start("empty");
		const olderList = (await (await get(older, "/api/sessions")).json()) as {
			capabilities: Record<string, unknown>;
		};
		expect("skill_invocation" in olderList.capabilities).toBe(false);
		// ...and an older relay has no route at all.
		expect((await get(older, `/api/skills?session_id=${ROW}`)).status).toBe(
			404,
		);
	});
});

describe("GET /api/skills", () => {
	it("answers the catalogue in served order, hidden skills included", async () => {
		const rig = await start("skills");
		const res = await get(rig, `/api/skills?session_id=${ROW}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			skills: Array<{ name: string; hidden: boolean }>;
		};
		expect(body.skills.map((row) => row.name)).toEqual([
			"ape-agent",
			"architect",
			"research",
			"secret-sauce",
			"empty-skill",
		]);
		expect(body.skills.find((row) => row.name === "secret-sauce")?.hidden).toBe(
			true,
		);
	});

	it("an unknown session is 404 unknown_session, not an empty list", async () => {
		const rig = await start("skills");
		const res = await get(rig, "/api/skills?session_id=ffffffffffffffffffff");
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ code: "unknown_session" });
	});

	it("skills-error refuses the read", async () => {
		const rig = await start("skills-error");
		expect((await get(rig, `/api/skills?session_id=${ROW}`)).status).toBe(500);
	});
});

describe("expand_skills on a prompt", () => {
	it("attaches known mentions and reports the skipped ones", async () => {
		const rig = await start("skills");
		const res = await prompt(rig, {
			text: "use $research and $empty-skill and $nope",
			expand_skills: true,
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			ok: true,
			skills: { attached: ["research"], skipped: ["empty-skill"] },
		});
	});

	it("carries the block even when nothing matched", async () => {
		const rig = await start("skills");
		const res = await prompt(rig, { text: "no mention", expand_skills: true });
		expect(await res.json()).toMatchObject({
			skills: { attached: [], skipped: [] },
		});
	});

	it("only a literal true expands: no flag, no block", async () => {
		const rig = await start("skills");
		const res = await prompt(rig, {
			text: "use $research",
			expand_skills: "yes",
		});
		expect("skills" in ((await res.json()) as object)).toBe(false);
	});

	it("an older relay drops the flag silently: a 200 with no block", async () => {
		// `tags-toggled` has live rows and no picker: an older relay.
		const rig = await start("tags-toggled");
		const res = await prompt(
			rig,
			{ text: "use $research", expand_skills: true },
			syntheticSessionId("tag-one-row"),
		);
		expect(res.status).toBe(200);
		expect((await res.json()) as object).not.toHaveProperty("skills");
	});

	it("skills-too-large refuses with the typed code", async () => {
		const rig = await start("skills-too-large");
		const res = await prompt(rig, {
			text: "use $research",
			expand_skills: true,
		});
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ code: "skills_too_large" });
	});
});
