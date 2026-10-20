/**
 * The `tags-cap` world and the mock's cap rule, over a real socket.
 *
 * The Maestro flow is the real-device proof, but it cannot distinguish "the
 * sheet refused before sending" from "the relay refused": it only sees the
 * sentence. This test pins the wire half — eight accepted, nine refused, a
 * duplicate refused with the store's own identity sentence — so a mock that
 * quietly accepts the ninth cannot make the flow look green for the wrong
 * reason.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createRelay, DEFAULT_PASSWORD } from "./relay.ts";
import { syntheticSessionId } from "./wire.ts";

const ROW = syntheticSessionId("tag-cap-row");
const EIGHT = [
	"d28b35a273",
	"cb65004501",
	"a1b2c3d4e5",
	"c0de000004",
	"c0de000005",
	"c0de000006",
	"c0de000007",
	"c0de000008",
];
const NINE = [...EIGHT, "c0de000009"];

interface Rig {
	base: string;
	authHeader: string | null;
	stop: () => Promise<void>;
}

const rigs: Rig[] = [];

async function start(): Promise<Rig> {
	const relay = createRelay({
		scenario: "tags-cap",
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
	const authHeader =
		(login.headers.getSetCookie?.() ?? [])[0]?.split(";")[0] ?? null;
	const rig = { base: url, authHeader, stop: () => relay.shutdown() };
	rigs.push(rig);
	return rig;
}

async function putTags(
	rig: Rig,
	tags: string[],
	primary: string | null = tags[0] ?? null,
): Promise<Response> {
	const headers = new Headers({ "content-type": "application/json" });
	if (rig.authHeader !== null) headers.set("cookie", rig.authHeader);
	return fetch(new URL(`/api/sessions/${ROW}/tags`, rig.base), {
		method: "PUT",
		headers,
		body: JSON.stringify({ tags, primary }),
	});
}

afterEach(async () => {
	await Promise.all(rigs.splice(0).map((rig) => rig.stop()));
});

describe("the tag cap the mock shares with the store", () => {
	it("accepts eight distinct categories", async () => {
		const rig = await start();
		const res = await putTags(rig, EIGHT);
		expect(res.status).toBe(200);
	});

	it("refuses a ninth with the store's sentence", async () => {
		const rig = await start();
		const res = await putTags(rig, NINE);
		expect(res.status).toBe(422);
		expect(await res.text()).toContain("At most 8 distinct tags are allowed");
	});

	it("refuses a duplicate with the same identity sentence", async () => {
		const rig = await start();
		const res = await putTags(rig, [EIGHT[0] as string, EIGHT[0] as string]);
		expect(res.status).toBe(422);
		expect(await res.text()).toContain("At most 8 distinct tags are allowed");
	});
});
