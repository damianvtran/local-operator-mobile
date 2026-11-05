import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import { themeProofPlan } from "./theme-proof-contract.ts";
import {
	assertTransportPair,
	observeTransportRequests,
	parseNativeTransportCodes,
	parseTransportObservations,
	transportAuthorities,
	transportOutcome,
} from "./theme-transport-contract.ts";

describe("transport-only paired authority probe", () => {
	it("admits both exact authorities on the real same-port mock without login", async () => {
		const relay = createRelay({
			scenario: "idle",
			password: "synthetic-only",
			quiet: true,
		});
		const listener = await relay.listen();
		const pair = transportAuthorities(
			listener.port,
			`http://fixture.local:${listener.port}`,
		);
		relay.state.allowedOrigins = pair.map((a) => a.url);
		const observer = observeTransportRequests(relay.handler, pair);
		observer.beginNative(); // HOST fixture test of the ledger phase, not device proof.
		try {
			for (const authority of pair) {
				// Node fetch ignores a custom Host header. A real HTTP request with
				// a loopback socket preserves the synthetic authority for this HOST
				// fixture control; it is not native DNS/ATS evidence.
				const status = await new Promise<number | undefined>(
					(resolve, reject) => {
						const req = request(
							{
								hostname: "127.0.0.1",
								port: listener.port,
								path: "/api/sessions",
								headers: {
									Host: new URL(authority.url).host,
									Origin: authority.url,
								},
							},
							(res) => {
								res.resume();
								res.on("end", () => resolve(res.statusCode));
							},
						);
						req.on("error", reject);
						req.end();
					},
				);
				expect(status).toBe(401);
			}
			expect(observer.snapshot().arrivals.map((r) => r.authority)).toEqual([
				"loopback-ipv4",
				"published-local",
			]);
			expect(observer.snapshot().completions.map((r) => r.status)).toEqual([
				401, 401,
			]);
		} finally {
			await relay.shutdown();
		}
	});
	it("routes only the transport stage through safe logs and its two-frame inventory", () => {
		const plan = themeProofPlan("transport");
		expect(plan.budgetSeconds).toBe(900);
		expect(plan.flow).toBe("transport-pair.yaml");
		expect(plan.frames).toEqual([
			"transport-loopback-ipv4",
			"transport-published-local",
		]);
		const runner = readFileSync(
			new URL("./theme-ios-proof.ts", import.meta.url),
			"utf8",
		);
		expect(runner).toContain('process == "${executable}"');
		expect(runner).toContain(
			"parseNativeTransportCodes(pending.slice(0, end))",
		);
		expect(runner).toContain("relay.transportObserver?.beginNative()");
		expect(runner).toContain("relay-${language}-transport.json");
		expect(runner).toContain(
			"No app-process NSError code observed; RN JS TypeError is NOT substituted",
		);
	});

	it("keeps both UI attempts in one app process, password blank and no Save", () => {
		const pair = readFileSync(
			new URL(
				"../../e2e/maestro/theme-proof/transport-pair.yaml",
				import.meta.url,
			),
			"utf8",
		);
		const attempt = readFileSync(
			new URL(
				"../../e2e/maestro/theme-proof/transport-attempt.yaml",
				import.meta.url,
			),
			"utf8",
		);
		expect(pair.match(/- launchApp:/g)).toHaveLength(1);
		expect(pair.match(/file: transport-attempt.yaml/g)).toHaveLength(2);
		expect(pair).toContain("AUTHORITY_LABEL: loopback-ipv4");
		expect(pair).toContain("AUTHORITY_LABEL: published-local");
		expect(pair + attempt).not.toMatch(
			/RELAY_PASSWORD|inputText:.*password|id: "custom-connect"|theme-card|session-row/,
		);
		const script = readFileSync(
			new URL(
				"../../e2e/maestro/theme-proof/transport-observation.js",
				import.meta.url,
			),
			"utf8",
		);
		const output: string[] = [];
		runInNewContext(script, {
			maestro: { copiedText: "That password was not accepted. secret body" },
			output: { transportStarted: 1 },
			AUTHORITY_LABEL: "loopback-ipv4",
			Date: { now: () => 10 },
			console: { log: (v: string) => output.push(v) },
		});
		expect(parseTransportObservations(output.join("\n"))).toEqual([
			{
				authority: "loopback-ipv4",
				uiVerdict: "password-refused",
				elapsedMs: 9,
			},
		]);
		expect(output.join("")).not.toContain("secret");
	});
	it("never mistakes host-preflight401 for native transport or removes a failing authority", () => {
		const rows = [
			{
				authority: "loopback-ipv4",
				uiVerdict: "password-refused",
				elapsedMs: 10,
			},
			{ authority: "published-local", uiVerdict: "timeout", elapsedMs: 8000 },
		] as const;
		const host = [
			{
				phase: "host-preflight",
				authority: "loopback-ipv4",
				endpoint: "sessions",
				status: 401,
			},
		];
		expect(transportOutcome(rows, host)).toBe("neither-401");
		expect(transportOutcome(rows, [{ ...host[0], phase: "native-pair" }])).toBe(
			"loopback-only-401",
		);
	});

	it("uses the same port for exact IPv4-loopback and published-local authorities", () => {
		const pair = transportAuthorities(12345, "http://fixture.local:12345");
		expect(pair.map((x) => x.label)).toEqual([
			"loopback-ipv4",
			"published-local",
		]);
		expect(pair.map((x) => new URL(x.url).port)).toEqual(["12345", "12345"]);
		expect(() =>
			transportAuthorities(12345, "http://fixture.local:9999"),
		).toThrow();
	});
	it("records real HTTP arrival even when the response never completes, without raw request data", async () => {
		const server = createServer(() => {});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const port = (server.address() as { port: number }).port;
		const observer = observeTransportRequests(
			server,
			transportAuthorities(port, `http://fixture.local:${port}`),
		);
		try {
			await fetch(`http://127.0.0.1:${port}/api/sessions?token=secret`, {
				signal: AbortSignal.timeout(200),
				headers: { authorization: "secret" },
			}).catch(() => {});
			expect(observer.snapshot().arrivals).toHaveLength(1);
			expect(observer.snapshot().completions).toHaveLength(0);
			expect(JSON.stringify(observer.snapshot())).not.toMatch(
				/secret|fixture\.local|127\.0\.0\.1|authorization/,
			);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
	it("requires both observations, allows401 versus timeout to remain a discriminator, and never logs error text", () => {
		const rows = parseTransportObservations(
			'TRANSPORT_PROBE {"authority":"loopback-ipv4","uiVerdict":"password-refused","elapsedMs":10,"url":"secret"}\nTRANSPORT_PROBE {"authority":"published-local","uiVerdict":"timeout","elapsedMs":8000}',
		);
		expect(() => assertTransportPair(rows)).not.toThrow();
		expect(() => assertTransportPair(rows.slice(0, 1))).toThrow();
		expect(JSON.stringify(rows)).not.toContain("secret");
	});
	it("keeps only native numeric domain/code observations, not request URLs or arbitrary errors", () => {
		expect(
			parseNativeTransportCodes(
				"NSURLErrorDomain Code=-1022 URL=http://secret.invalid token=secret\nJS TypeError Network request failed",
			),
		).toEqual([{ domain: "NSURLErrorDomain", code: -1022 }]);
		expect(
			parseNativeTransportCodes("JS TypeError Network request failed"),
		).toEqual([]);
	});
});
