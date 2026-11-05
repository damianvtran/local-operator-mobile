import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
	assertPrivateCredentialActivities,
	type observeAuthRequests,
} from "./auth-save-contract.ts";
import type {
	observeTransportRequests,
	transportAuthorities,
} from "./theme-transport-contract.ts";
import {
	assertDirectXCTestResult,
	directXCTestPlan,
	parseDirectEvents,
} from "./transport-xctest-contract.ts";

type Run = (
	name: string,
	command: string,
	args: string[],
	cap: number,
	cleanup?: boolean,
	extra?: Record<string, string>,
) => Promise<string>;
export async function directTransportTest(options: {
	root: string;
	udid: string;
	appId: string;
	run: Run;
	authorities: ReturnType<typeof transportAuthorities>;
	observer?: ReturnType<typeof observeTransportRequests>;
	closeListener: () => Promise<void>;
	receipt: Record<string, unknown>;
	negativeOnly?: boolean;
	authSave?: {
		password: string;
		observer: ReturnType<typeof observeAuthRequests>;
	};
}) {
	const {
		root,
		udid,
		appId,
		run,
		authorities,
		observer,
		closeListener,
		receipt,
	} = options;
	const control = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://control.invalid");
		if (req.method !== "GET") {
			res.writeHead(405);
			res.end();
			return;
		}
		let result: Record<string, number>;
		if (url.pathname === "/begin") {
			observer?.beginNative();
			options.authSave?.observer.beginNative();
			result = { ready: 1 };
		} else if (options.authSave && url.pathname === "/fixture-password") {
			// No CLI/env/URL carries this value; only the private control response.
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			});
			res.end(JSON.stringify({ password: options.authSave.password }));
			return;
		} else if (options.authSave && url.pathname === "/save-phase") {
			options.authSave.observer.beginSave();
			result = { ready: 1 };
		} else if (url.pathname === "/close") {
			await closeListener();
			result = { closed: 1 };
		} else if (url.pathname === "/counts" && observer) {
			const label = url.searchParams.get("authority");
			if (!authorities.some((a) => a.label === label)) {
				res.writeHead(400);
				res.end();
				return;
			}
			const snapshot = observer.snapshot();
			const arrivals = snapshot.arrivals.filter(
				(a) =>
					a.phase === "native-pair" &&
					a.authority === label &&
					a.endpoint === "sessions" &&
					a.method === "GET",
			);
			result = {
				arrivals: arrivals.length,
				completed401: snapshot.completions.filter(
					(c) =>
						c.phase === "native-pair" &&
						c.authority === label &&
						c.endpoint === "sessions" &&
						c.status === 401 &&
						arrivals.some((a) => a.id === c.id),
				).length,
			};
		} else {
			res.writeHead(404);
			res.end();
			return;
		}
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		res.end(JSON.stringify(result));
	});
	await new Promise<void>((resolve, reject) => {
		control.once("error", reject);
		control.listen(0, "127.0.0.1", resolve);
	});
	const port = (control.address() as { port: number }).port;
	const project = join(root, "carrier", "TransportCarrier.xcodeproj");
	const negativeOnly = options.negativeOnly === true;
	receipt.directScope = options.authSave
		? "one published-local authenticated Test/Save/Home/sidebar existing-row prerequisite"
		: negativeOnly
			? "current loopback401 -> close SAME listener -> fresh negative; prior A/B retained separately"
			: "paired authorities + closed-listener control";
	const plan = directXCTestPlan(
		project,
		udid,
		root,
		negativeOnly,
		!!options.authSave,
	);
	try {
		receipt.directPhase = "generate-isolated-target-graph";
		await run(
			"xctest-generate",
			"ruby",
			["scripts/ci/transport-xctest/generate.rb", join(root, "carrier")],
			30,
		);
		receipt.directTargetGraph = JSON.parse(
			readFileSync(join(root, "carrier", "target-graph.json"), "utf8"),
		);
		assertDirectTargetGraph(receipt.directTargetGraph);
		receipt.directPhase = "single-build-for-testing-feasibility";
		// Exactly ONE build attempt. A failure propagates; never fall back to the
		// product scheme, an app build, dependencies, Metro or alternate entry point.
		await run("xctest-build-feasibility", "xcodebuild", plan.build, 240);
		receipt.directPhase = "selected-serial-test";
		const output = await run(
			"xctest-selected-test",
			"xcodebuild",
			plan.test,
			700,
			false,
			{
				TEST_RUNNER_REAL_APP_ID: appId,
				TEST_RUNNER_IP_URL: authorities[0].url,
				TEST_RUNNER_LOCAL_URL: authorities[1].url,
				TEST_RUNNER_CONTROL_URL: `http://127.0.0.1:${port}`,
			},
		);
		const events = parseDirectEvents(output);
		receipt.directEvents = events;
		if (!options.authSave) {
			assertDirectXCTestResult(events, negativeOnly);
			assert(
				observer!
					.snapshot()
					.arrivals.filter((a) => a.phase === "native-pair")
					.every(
						(a) =>
							a.method === "GET" &&
							a.endpoint === "sessions" &&
							authorities
								.slice(0, negativeOnly ? 1 : 2)
								.some((b) => b.label === a.authority),
					),
				"unexpected native route/method in no-auth paired transport stage",
			);
		}
		receipt.directPhase = "observations-complete";
	} finally {
		// Even a crashed/zero-tests runner keeps its xcresult and partial attachments.
		const result = join(root, "transport.xcresult");
		receipt.xcresultPresent = existsSync(result);
		if (existsSync(result)) {
			try {
				await run(
					"xctest-export-attachments",
					"xcrun",
					[
						"xcresulttool",
						"export",
						"attachments",
						"--path",
						result,
						"--output-path",
						join(root, "frames", "xctest"),
					],
					60,
					true,
				);
			} catch {
				receipt.attachmentExportFailed = true;
			}
		}

		if (options.authSave && existsSync(result)) {
			try {
				await inspectCredentialResult(result, run, options.authSave.password);
				assert(
					receipt.credentialActivityMasked === true,
					"secure native activity mask unproved",
				);
				renameSync(result, join(root, "safe-auth.xcresult"));
				const exported = join(root, "frames", "xctest");
				if (existsSync(exported))
					renameSync(exported, join(root, "frames", "auth-verified"));
				receipt.privateXcresultProven = true;
				receipt.authVerifiedResult = "safe-auth.xcresult";
				receipt.authVerifiedFrames = "frames/auth-verified";
			} catch {
				// Reversible quarantine is outside the upload root. Never rewrite a
				// structured xcresult or let a privacy error mask the first UI failure.
				receipt.privateXcresultProven = false;
				if (existsSync(result))
					renameSync(
						result,
						join(root, "..", "auth-credential-result-quarantine.xcresult"),
					);
				receipt.xcresultQuarantined = true;
				const exported = join(root, "frames", "xctest");
				if (existsSync(exported)) {
					const quarantine = join(
						root,
						"..",
						"auth-credential-attachments-quarantine",
					);
					// Filename shape and secure-field masking do not prove image
					// privacy. Keep EVERY exported attachment outside upload roots
					// when the credential audit fails; salvage requires independent
					// proof that the capture predates credential entry.
					renameSync(exported, quarantine);
				}
			}
		}
		const events =
			(receipt.directEvents as ReturnType<typeof parseDirectEvents>) ?? [];
		receipt.directCrashObservables = {
			xcresultPresent:
				existsSync(result) ||
				receipt.xcresultQuarantined === true ||
				receipt.privateXcresultProven === true,
			methodEntered: events.some((e) => e.event === "method-entered"),
			runnerPID:
				events.find((e) => e.event === "method-entered")?.runnerPID ?? null,
			runnerPIDGap: events.some((e) => e.runnerPID)
				? null
				: "runner did not report a method PID; inspect supervised exit/xcresult, not a fabricated PID",
		};
		control.closeAllConnections();
		await new Promise<void>((resolve) => control.close(() => resolve()));
	}
	assert(
		receipt.attachmentExportFailed !== true,
		"actual xcresult attachment export failed",
	);
	if (options.authSave) {
		assert(
			receipt.privateXcresultProven === true,
			"credential privacy prerequisite failed; raw result quarantined, no pass",
		);
		assertXCTestAttachments(join(root, "frames", "auth-verified"), [
			"welcome-ready",
			"auth-connected",
			"auth-home",
			"auth-sidebar",
		]);
		return;
	}
	const negative = (
		receipt.directEvents as ReturnType<typeof parseDirectEvents>
	).find((e) => e.event === "negative")!;
	assertXCTestAttachments(join(root, "frames", "xctest"), [
		"welcome-ready",
		"loopback-ipv4",
		...(negativeOnly ? [] : ["published-local"]),
		`negative-${negative.authority}`,
	]);
}

// Field mapping matches xcresulttool export attachments (also consumed by
// Chromium Xcode16LogParser::_extract_attachments). A different image or a JSON
// marker containing the desired name must not substitute for that screenshot.
async function inspectCredentialResult(
	result: string,
	run: Run,
	secret: string,
) {
	const objects: unknown[] = [],
		queue: (string | undefined)[] = [undefined],
		seen = new Set<string>();
	// Published xcresulttool object reads are used; hosted feasibility remains a gate. Only test/
	// summary refs are followed. Bounded metadata reads, never another test run.
	while (queue.length) {
		assert(
			objects.length < 8,
			"credential activity graph exceeds bounded inspection",
		);
		const id = queue.shift();
		const text = await run(
			`xctest-auth-privacy-${objects.length}`,
			"xcrun",
			[
				"xcresulttool",
				"get",
				"object",
				"--legacy",
				"--path",
				result,
				"--format",
				"json",
				...(id ? ["--id", id] : []),
			],
			15,
			true,
		);
		const object = JSON.parse(text);
		objects.push(object);
		const refs = (node: any) => {
			if (!node || typeof node !== "object") return;
			for (const [key, value] of Object.entries(node)) {
				if (
					(key === "testsRef" || key === "summaryRef") &&
					(value as any)?.id?._value
				) {
					const next = (value as any).id._value as string;
					if (!seen.has(next)) {
						seen.add(next);
						queue.push(next);
					}
				} else refs(value);
			}
		};
		refs(object);
	}
	assertPrivateCredentialActivities(objects, secret);
	const scan = (path: string) => {
		for (const file of readdirSync(path, { withFileTypes: true })) {
			const name = join(path, file.name);
			if (file.isDirectory()) scan(name);
			else if (file.isFile()) {
				const data = readFileSync(name);
				assert(
					!data.includes(Buffer.from(secret)) &&
						!data.includes(Buffer.from(secret, "utf16le")),
					"raw result credential privacy prerequisite failed",
				);
			}
		}
	};
	scan(result);
}

export function assertXCTestAttachments(
	root: string,
	names: readonly string[] = ["welcome-ready"],
) {
	const manifest = JSON.parse(
		readFileSync(join(root, "manifest.json"), "utf8"),
	);
	assert(Array.isArray(manifest), "missing xcresult exporter manifest");
	const attachments = manifest.flatMap(
		(group: {
			attachments?: {
				suggestedHumanReadableName: string;
				exportedFileName: string;
			}[];
		}) => group.attachments ?? [],
	);
	for (const name of names) {
		const row = attachments.find(
			(a) =>
				typeof a.suggestedHumanReadableName === "string" &&
				(a.suggestedHumanReadableName === name ||
					a.suggestedHumanReadableName.startsWith(name + "_") ||
					a.suggestedHumanReadableName.startsWith(name + ".")),
		);
		assert(
			row &&
				typeof row.exportedFileName === "string" &&
				!row.exportedFileName.includes("/") &&
				!row.exportedFileName.includes("\\"),
			"missing named screenshot in actual attachment manifest",
		);
		const image = readFileSync(join(root, row.exportedFileName));
		assert(
			image.length >= 24 &&
				image
					.subarray(0, 8)
					.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
				image.toString("ascii", 12, 16) === "IHDR" &&
				image.readUInt32BE(16) > 0 &&
				image.readUInt32BE(20) > 0,
			"named attachment is not nonempty PNG screenshot bytes",
		);
	}
}

export function assertDirectTargetGraph(graph: unknown) {
	assert(Array.isArray(graph), "missing materialized target graph");
	assert.deepEqual(
		graph.map((t) => ({
			name: t.name,
			product_type: t.product_type,
			dependencies: t.dependencies,
		})),
		[
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
		],
		"runner graph must contain ONLY network-free carrier + UItest; no product target/dependency",
	);
}
