import { describe, expect, it, vi } from "vitest";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import {
	nativeConnectionPrerequisiteFailed,
	probeNativeRelay,
} from "./native-relay-preflight.ts";

describe("native proof's authenticated handoff prerequisite (Q163-2)", () => {
	it("stops the historical setup failures, not unrelated content assertions", () => {
		expect(
			nativeConnectionPrerequisiteFailed(
				"Assertion is false: id: session-row-6714def86197 is visible",
			),
		).toBe(true);
		expect(
			nativeConnectionPrerequisiteFailed(
				'No visible element found: "Connected"',
			),
		).toBe(true);
		expect(
			nativeConnectionPrerequisiteFailed(
				"Assertion is false: id: composer-input is visible",
			),
		).toBe(false);
	});
	it("journals live SSE before finish and keeps host/native admissions distinct", async () => {
		const password = "synthetic-journal-password";
		const relay = createRelay({
			scenario: "subagent-running",
			password,
			quiet: true,
		});
		relay.state.journalAll = true;
		const handle = await relay.listen();
		const controller = new AbortController();
		try {
			const origin = `http://127.0.0.1:${handle.port}`;
			const id = Object.keys(relay.state.world.projections ?? {})[0];
			await probeNativeRelay(origin, password, id);
			expect(relay.state.wireEvents.some((event) => event.status === 401)).toBe(
				true,
			);
			const login = await fetch(`${origin}/login`, {
				method: "POST",
				redirect: "manual",
				headers: {
					origin,
					"content-type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({ password }),
			});
			await login.arrayBuffer();
			const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
			relay.state.wirePhase = "native-flow";
			const response = await fetch(
				`${origin}/api/sessions/events?include_peers=true`,
				{
					headers: { cookie, origin },
					signal: controller.signal,
				},
			);
			if (!response.body) throw new Error("stream body absent");
			const reader = response.body.getReader();
			const chunk = await reader.read();
			expect(new TextDecoder().decode(chunk.value)).toContain(
				"event: sessions",
			);
			const admitted = relay.state.wireEvents.find(
				(event) => event.phase === "native-flow" && event.event === "start",
			);
			if (!admitted) throw new Error("native admission missing");
			expect(admitted.path).toBe("/api/sessions/events");
			expect(
				relay.state.wireEvents
					.filter((event) => event.id === admitted.id)
					.map((event) => [event.event, event.status]),
			).toEqual([
				["start", null],
				["headers", 200],
			]);
			// This is the discriminating proof missing from the finish-only ledger.
			console.log(
				"journal preflight: unauth=401 authenticated lists=2 schema-valid SSE=200 seed received; open native stream events=start,headers (no finish)",
			);
			relay.state.wirePhase = "after-native";
			controller.abort();
			await reader.cancel().catch(() => undefined);
			await expect
				.poll(() =>
					relay.state.wireEvents.some(
						(event) => event.id === admitted.id && event.event === "close",
					),
				)
				.toBe(true);
			expect(
				relay.state.wireEvents
					.filter((event) => event.id === admitted.id)
					.every((event) => event.phase === "native-flow"),
			).toBe(true);
			const serialized = JSON.stringify(relay.state.wireEvents);
			expect(serialized).not.toContain(password);
			expect(serialized).not.toContain(cookie);
			expect(serialized).not.toContain("include_peers");
		} finally {
			controller.abort();
			await relay.shutdown();
		}
	});
	for (const broken of [
		"/api/sessions",
		"/api/sessions?include_peers=true",
		"/api/sessions/events?include_peers=true",
	]) {
		it(`rejects schema-invalid fixture on ${broken}`, async () => {
			const password = "synthetic-invalid-schema-password";
			const relay = createRelay({ scenario: "idle", password, quiet: true });
			const handle = await relay.listen();
			const original = globalThis.fetch;
			const spy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (input, init) => {
					const response = await original(input, init);
					if (
						response.status !== 200 ||
						new URL(String(input)).pathname + new URL(String(input)).search !==
							broken
					)
						return response;
					await response.body?.cancel();
					const malformed = { sessions: [], degraded: 42 };
					return broken.includes("/events")
						? new Response(
								`event: sessions\ndata: ${JSON.stringify(malformed)}\n\n`,
							)
						: Response.json(malformed);
				});
			try {
				await expect(
					probeNativeRelay(`http://127.0.0.1:${handle.port}`, password),
				).rejects.toThrow();
			} finally {
				spy.mockRestore();
				await relay.shutdown();
			}
		});
	}
	for (const scenario of ["idle", "subagent-running"]) {
		it(`checks ${scenario} through login, saved-route list and SSE`, async () => {
			const password = "synthetic-native-proof-password";
			const relay = createRelay({ scenario, password, quiet: true });
			const handle = await relay.listen();
			try {
				const origin = `http://127.0.0.1:${handle.port}`;
				const id = Object.keys(relay.state.world.projections ?? {})[0];
				await expect(probeNativeRelay(origin, password, id)).resolves.toEqual({
					authenticatedLists: 2,
					streamSeed: true,
				});
				// A health/auth handshake must never admit a nonexistent fixture row.
				await expect(
					probeNativeRelay(origin, password, "not-in-this-world"),
				).rejects.toThrow("expected session absent");
			} finally {
				await relay.shutdown();
			}
		});
	}
});
