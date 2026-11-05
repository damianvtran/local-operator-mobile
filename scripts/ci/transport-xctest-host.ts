import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
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
	observer: ReturnType<typeof observeTransportRequests>;
	closeListener: () => Promise<void>;
	receipt: Record<string, unknown>;
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
			observer.beginNative();
			result = { ready: 1 };
		} else if (url.pathname === "/close") {
			await closeListener();
			result = { closed: 1 };
		} else if (url.pathname === "/counts") {
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
	const plan = directXCTestPlan(project, udid, root);
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
		assertDirectXCTestResult(events);
		assert(
			observer
				.snapshot()
				.arrivals.filter((a) => a.phase === "native-pair")
				.every(
					(a) =>
						a.method === "GET" &&
						a.endpoint === "sessions" &&
						authorities.some((b) => b.label === a.authority),
				),
			"unexpected native route/method in no-auth paired transport stage",
		);
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

		const events =
			(receipt.directEvents as ReturnType<typeof parseDirectEvents>) ?? [];
		receipt.directCrashObservables = {
			xcresultPresent: existsSync(result),
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
	const negative = (
		receipt.directEvents as ReturnType<typeof parseDirectEvents>
	).find((e) => e.event === "negative")!;
	assertXCTestAttachments(join(root, "frames", "xctest"), [
		"welcome-ready",
		"loopback-ipv4",
		"published-local",
		`negative-${negative.authority}`,
	]);
}

// Field mapping matches xcresulttool export attachments (also consumed by
// Chromium Xcode16LogParser::_extract_attachments). A different image or a JSON
// marker containing the desired name must not substitute for that screenshot.
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
