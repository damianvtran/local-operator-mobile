import { describe, expect, it } from "vitest";
import {
	createRelayClient,
	signInToCustomRoute,
} from "@/connection/client-factory";
import { validateCustomBaseUrl } from "@/connection/profile";
import { createCookieJarFetch } from "@/testing/cookie-jar-fetch";
import { createRelay } from "../../../tools/mock-relay/relay";
import {
	createSavedRouteDiagnostics,
	parseSavedRouteDiagnostics,
	type SavedRouteDiagnostic,
} from "./saved-route-diagnostics";

describe("saved-route native diagnostic boundary", () => {
	it("admits the fixture .local route, then traces actual authenticated peer-list HTTP", async () => {
		const password = "synthetic-native-secret-not-for-logs";
		const relay = createRelay({ scenario: "idle", password, quiet: true });
		const listener = await relay.listen();
		try {
			const origin = `http://fixture-native.local:${listener.port}`;
			relay.state.allowedOrigins = [
				...(relay.state.allowedOrigins ?? []),
				origin,
			];
			const validated = validateCustomBaseUrl(origin, { allowInsecure: true });
			if (!validated.ok) throw new Error("fixture address admission failed");
			const events: SavedRouteDiagnostic[] = [];
			const trace = createSavedRouteDiagnostics((event) => events.push(event));
			// Node has no native cookie jar or ATS. Map only this synthetic .local
			// fixture to its real loopback listener; this is NOT device transport proof.
			const jar = createCookieJarFetch((input, init) => {
				const url = new URL(String(input));
				if (url.origin !== origin) throw new Error("unexpected origin");
				return fetch(
					`http://127.0.0.1:${listener.port}${url.pathname}${url.search}`,
					init,
				);
			});
			const fetchImpl = trace.fetch(jar.fetch);
			expect(
				(await signInToCustomRoute(validated.route, password, { fetchImpl }))
					.signedIn,
			).toBe(true);
			const client = createRelayClient({ route: validated.route, fetchImpl });
			const frame = await client.sessions({ includePeers: true });
			expect(frame.sessions.length).toBeGreaterThan(0);
			expect(events).toContainEqual({
				event: "response",
				requestClass: "peer-list",
				status: 200,
			});
			jar.clear();
			try {
				await client.sessions({ includePeers: true });
			} catch (error) {
				trace.stage("provider.failed", error);
			}
			expect(events).toContainEqual({
				event: "response",
				requestClass: "peer-list",
				status: 401,
			});
			expect(
				events.some((event) => event.causeClass === "relay-unauthorized"),
			).toBe(true);
			const text = JSON.stringify(events);
			expect(text).not.toContain(password);
			expect(text).not.toContain("fixture-native.local");
			expect(text).not.toContain("lop_mobile");
		} finally {
			await relay.shutdown();
		}
	});

	it("never serializes native rejection text/names, input URLs or auth headers", async () => {
		const events: SavedRouteDiagnostic[] = [];
		const trace = createSavedRouteDiagnostics((event) => events.push(event));
		const error = new TypeError(
			"https://private.invalid/?token=secret cookie=secret",
		);
		const failing = trace.fetch(async () => {
			throw error;
		});
		await expect(
			failing(
				"https://private.invalid/api/sessions?include_peers=true&token=secret",
				{
					headers: { authorization: "secret", cookie: "secret" },
				},
			),
		).rejects.toBe(error);
		expect(events.at(-1)).toEqual({
			event: "rejected",
			requestClass: "peer-list",
			errorClass: "TypeError",
			causeClass: "transport",
		});
		error.name = "credential-in-error-name";
		trace.stage("provider.failed", error);
		expect(events.at(-1)?.errorClass).toBe("Error");
		expect(JSON.stringify(events)).not.toMatch(/secret|private|credential/);
	});

	it("sanitizes native log evidence before disk and ignores unrelated messages", () => {
		const text =
			"unrelated raw URL https://private.invalid/secret\n" +
			'[saved-route] {"event":"rejected","requestClass":"peer-list","errorClass":"TypeError","causeClass":"transport","url":"https://private.invalid/secret","cookie":"secret"}\n' +
			'[saved-route] {"event":"stage","stage":"secret","errorClass":"secret","status":-1022}';
		const parsed = parseSavedRouteDiagnostics(text);
		expect(parsed).toEqual([
			{
				event: "rejected",
				requestClass: "peer-list",
				errorClass: "TypeError",
				causeClass: "transport",
			},
			{ event: "stage", stage: "unknown", errorClass: "Error" },
		]);
		expect(JSON.stringify(parsed)).not.toMatch(/secret|private|cookie/);
	});

	it("does not change a request result when the native logging sink fails", async () => {
		const trace = createSavedRouteDiagnostics(() => {
			throw new Error("sink unavailable");
		});
		trace.stage("privacy.wait");
		const response = new Response("ok", { status: 200 });
		await expect(
			trace.fetch(async () => response)("http://fixture.local/api/sessions"),
		).resolves.toBe(response);
	});

	it("caps a connect attempt so reconnect/stream loops cannot flood logs", () => {
		const events: SavedRouteDiagnostic[] = [];
		const trace = createSavedRouteDiagnostics((event) => events.push(event));
		for (let i = 0; i < 100; i++) trace.stage("admission.superseded");
		expect(events).toHaveLength(32);
	});
});
