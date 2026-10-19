// biome-ignore-all lint/style/noNonNullAssertion: each assertion follows an
// explicit length/index read; a longhand local would obscure the wire check.
/**
 * The tag routes over a REAL socket, against the corpus captures.
 *
 * The fixture relay models `GET /api/tags` and `PUT /api/sessions/{id}/tags` by
 * hand (rather than through `replay`) because these tests need two things the
 * generic replay cannot give them: any session id, and the EXACT body the client
 * put on the wire. A body key added to the client — or `primary` omitted when it
 * is null — is a silent re-primary the relay refuses with a 422, so it must fail
 * here rather than in the field.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createRelayClient } from "../../connection";
import { parsePayload } from "../../contracts";
import { RelayError } from "../../relay";
import { createCookieJarFetch } from "../cookie-jar-fetch";
import { type FixtureRelay, startFixtureRelay } from "../fixture-relay";
import { loadFixture } from "../fixtures";

const relays: FixtureRelay[] = [];
afterEach(async () => {
	for (const relay of relays.splice(0)) await relay.close();
});

const SESSION_ID = "6714def86197";
const RESEARCH = "cb65004501";
const WORK = "d28b35a273";

async function relayWith(
	options: Parameters<typeof startFixtureRelay>[0],
): Promise<FixtureRelay> {
	const relay = await startFixtureRelay(options);
	relays.push(relay);
	return relay;
}

async function clientFor(relay: FixtureRelay) {
	const jar = createCookieJarFetch();
	const client = createRelayClient({
		route: { mode: "custom", baseUrl: relay.baseUrl, allowInsecure: true },
		fetchImpl: jar.fetch,
	});
	await client.login("correct horse");
	return client;
}

describe("the tag routes over the fixture relay", () => {
	it("reads the catalogue over GET /api/tags and returns the captured answer", async () => {
		const relay = await relayWith({ auth: { mode: "custom" } });
		const client = await clientFor(relay);
		const expected = loadFixture<{ body: unknown }>(
			"http/tags-populated.json",
		).body;

		await expect(client.tags()).resolves.toEqual(expected);
		expect(relay.requests.at(-1)).toMatchObject({
			method: "GET",
			path: "/api/tags",
		});
	});

	it("serves the empty catalogue capture when a test names it", async () => {
		const relay = await relayWith({
			auth: { mode: "custom" },
			tags: { catalogue: "http/tags-empty.json" },
		});
		const client = await clientFor(relay);

		await expect(client.tags()).resolves.toEqual({ tags: [] });
	});

	it("PUTs exactly `{tags, primary}` and returns the canonical read-back", async () => {
		const relay = await relayWith({ auth: { mode: "custom" } });
		const client = await clientFor(relay);
		const expected = loadFixture<{ body: unknown }>(
			"http/session-tags-assigned.json",
		).body;

		await expect(
			client.setSessionTags(SESSION_ID, [RESEARCH, WORK], WORK),
		).resolves.toEqual(expected);

		const sent = relay.requests.at(-1);
		expect(sent).toMatchObject({
			method: "PUT",
			path: `/api/sessions/${SESSION_ID}/tags`,
		});
		expect(sent?.body).toEqual({
			tags: [RESEARCH, WORK],
			primary: WORK,
		});
		/* EXACTLY the route's two keys: an extra key is a 422, and a missing
		 * `primary` silently re-primaries on a relay that defaulted it. */
		expect(Object.keys(sent?.body as object).sort()).toEqual([
			"primary",
			"tags",
		]);
	});

	it("sends `primary: null` rather than omitting it when clearing", async () => {
		const relay = await relayWith({ auth: { mode: "custom" } });
		const client = await clientFor(relay);

		await client.setSessionTags(SESSION_ID, [], null);
		expect(relay.requests.at(-1)?.body).toEqual({ tags: [], primary: null });
	});

	it("classifies the store's 422 body through the relay's error shape", async () => {
		const fixture = loadFixture<{ status: number; body: unknown }>(
			"http/session-tags-unknown-tag.json",
		);
		const relay = await relayWith({
			auth: { mode: "custom" },
			tags: { assignment: "http/session-tags-unknown-tag.json" },
		});
		const client = await clientFor(relay);

		const error = await client
			.setSessionTags(SESSION_ID, ["ffffffffff"], null)
			.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(RelayError);
		expect((error as RelayError).status).toBe(fixture.status);
		/* The corpus body IS the api error this boundary parses. */
		expect(parsePayload("apiError", fixture.body).error).toBe(
			"Unknown category id",
		);
	});

	it("classifies the unknown-session 404 body through the relay's error shape", async () => {
		const fixture = loadFixture<{ status: number; body: unknown }>(
			"http/session-tags-unknown-session.json",
		);
		const relay = await relayWith({
			auth: { mode: "custom" },
			tags: { assignment: "http/session-tags-unknown-session.json" },
		});
		const client = await clientFor(relay);

		const error = await client
			.setSessionTags("ffffffffffff", [], null)
			.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(RelayError);
		expect((error as RelayError).status).toBe(fixture.status);
		expect(parsePayload("apiError", fixture.body).error).toBe(
			"unknown session",
		);
	});

	it("offers no catalogue write: identity stays in the desktop/agent surfaces", () => {
		const client = createRelayClient({
			route: {
				mode: "custom",
				baseUrl: "http://127.0.0.1:1",
				allowInsecure: true,
			},
		});
		const methods = Object.getOwnPropertyNames(
			Object.getPrototypeOf(client) as object,
		);
		for (const absent of [
			"createTag",
			"renameTag",
			"deleteTag",
			"setTagCatalogue",
		]) {
			expect(methods).not.toContain(absent);
		}
	});
});
