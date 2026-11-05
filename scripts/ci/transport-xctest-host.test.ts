import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	observeTransportRequests,
	transportAuthorities,
} from "./theme-transport-contract.ts";
import { directTransportTest } from "./transport-xctest-host.ts";

it("real HTTP: HOST401 excluded; begin/count/close supervise same listener and preserve incomplete receipt", async () => {
	const sut = createServer((_req, res) => {
		res.writeHead(401);
		res.end("{}");
	});
	await new Promise<void>((resolve) => sut.listen(0, "127.0.0.1", resolve));
	const port = (sut.address() as { port: number }).port;
	const authorities = transportAuthorities(
		port,
		`http://fixture.local:${port}`,
	);
	const observer = observeTransportRequests(sut, authorities);
	const root = mkdtempSync(join(tmpdir(), "direct-supervisor-"));
	const receipt: Record<string, unknown> = {};
	const closeListener = async () => {
		sut.closeAllConnections();
		await new Promise<void>((resolve) => sut.close(() => resolve()));
	};
	const runs: string[] = [];
	try {
		await expect(
			directTransportTest({
				root,
				udid: "owned",
				appId: "synthetic",
				authorities,
				observer,
				closeListener,
				receipt,
				run: async (name, _command, _args, _cap, _cleanup, env) => {
					runs.push(name);
					if (name === "xctest-generate") {
						mkdirSync(join(root, "carrier"));
						writeFileSync(
							join(root, "carrier", "target-graph.json"),
							JSON.stringify([
								{
									name: "TransportCarrier",
									product_type: "com.apple.product-type.application",
									dependencies: [],
								},
								{
									name: "TransportUITests",
									product_type: "com.apple.product-type.bundle.ui-testing",
									dependencies: ["TransportCarrier"],
								},
							]),
						);
						return "";
					}
					if (name === "xctest-build-feasibility") return ""; // no compiler/Xcode invocation in this module control
					const control = env!.TEST_RUNNER_CONTROL_URL;
					const counts = async () =>
						(await (
							await fetch(control + "/counts?authority=loopback-ipv4")
						).json()) as { arrivals: number; completed401: number };
					expect(
						(await fetch(authorities[0].url + "/api/sessions")).status,
					).toBe(401);
					expect(await counts()).toEqual({ arrivals: 0, completed401: 0 });
					await fetch(control + "/begin");
					// A deliberate MODULE-LEVEL phase transition, NOT an installed-app request.
					expect(
						(await fetch(authorities[0].url + "/api/sessions")).status,
					).toBe(401);
					expect(await counts()).toEqual({ arrivals: 1, completed401: 1 });
					expect(await (await fetch(control + "/close")).json()).toEqual({
						closed: 1,
					});
					await expect(
						fetch(authorities[0].url + "/api/sessions"),
					).rejects.toThrow();
					expect(await counts()).toEqual({ arrivals: 1, completed401: 1 });
					throw new Error("bounded-module-control-stop");
				},
			}),
		).rejects.toThrow("bounded-module-control-stop");
		expect(runs).toEqual([
			"xctest-generate",
			"xctest-build-feasibility",
			"xctest-selected-test",
		]);
		expect(receipt.directCrashObservables).toMatchObject({
			methodEntered: false,
			runnerPID: null,
			xcresultPresent: false,
		});
		expect(observer.snapshot().arrivals.map((a) => a.phase)).toEqual([
			"host-preflight",
			"native-pair",
		]);
	} finally {
		if (sut.listening) await closeListener();
	}
});

it("a different screenshot/JSON marker cannot satisfy named screenshot evidence", async () => {
	const { assertXCTestAttachments } = await import(
		"./transport-xctest-host.ts"
	);
	const root = mkdtempSync(join(tmpdir(), "direct-manifest-"));
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP90AAAAASUVORK5CYII=",
		"base64",
	);
	writeFileSync(join(root, "actual.png"), png);
	writeFileSync(
		join(root, "manifest.json"),
		JSON.stringify([
			{
				attachments: [
					{
						suggestedHumanReadableName: "welcome-ready_0.png",
						exportedFileName: "actual.png",
					},
				],
			},
		]),
	);
	expect(() => assertXCTestAttachments(root)).not.toThrow();
	expect(() => assertXCTestAttachments(root, ["loopback-ipv4"])).toThrow();
	writeFileSync(join(root, "actual.png"), "not an image");
	expect(() => assertXCTestAttachments(root)).toThrow();
});
