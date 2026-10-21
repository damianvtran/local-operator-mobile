/** Remote-CI-only, ONE canonical failed cell. A successful diagnostic means the
 * known original failure reproduced, NOT that U-08 or the application passed. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs, str } from "../lib/args.ts";
import { launchChrome } from "../lib/chrome.ts";
import { freshPage, withDeadline } from "../lib/page.ts";
import { reDriveMismatch } from "../lib/readiness.ts";
import { serveDir } from "../lib/static-server.ts";
import { createRelay, DEFAULT_PASSWORD } from "../mock-relay/relay.ts";
import { type AuditRecord, auditCell } from "./audit.ts";
import { type AuditState, runChecks } from "./checks.ts";
import { floorsFromTokens } from "./color.ts";
import { EXTRACT_PROBE, u08GeometryProbe } from "./probe.ts";

export const ORIGINAL_HEAD = "c8d1d44c6b5bf53381d65c77f209d817d323ba74";
export const ORIGINAL_RUN = "39483683151";
export const RECORD: AuditRecord = {
	screen: "path:/session/{sessionId}?lo-scroll=top",
	state: "condensed",
	device: "iphone-15",
	theme: "dark",
	scale: "150",
	path: "/session/6714def86197?lo-scroll=top",
	viewport: { width: 390, height: 844, dpr: 3 },
	insets: { top: 59, bottom: 34, left: 0, right: 0 },
	pinnedScenario: "long-transcript",
	openers: [],
	ready: true,
};
const EXPECTED = "22x18pt overlap (100% of the smaller painted box)";
const OBSERVER_LINE = /\n\s*state\.onU08Failure\?\.\(a\.index,\s*b\.index\);/;
/** Refuse instrument drift before launch; the observer is not a policy edit. */
export function verifyOriginalInstrument() {
	const sha = (source: string) =>
		createHash("sha256").update(source).digest("hex");
	const source = readFileSync(new URL("./checks.ts", import.meta.url), "utf8");
	const at = source.indexOf("function u08Overlap("),
		end = source.indexOf("\nfunction ", at + 1);
	const hashes = {
		probeSHA256: sha(EXTRACT_PROBE),
		policySHA256: sha(source.slice(at, end).replace(OBSERVER_LINE, "")),
	};
	if (
		hashes.probeSHA256 !==
			"2ef600e4b42640db7b921a3fba9f17b1f380701f92e7546beab07cf424e67c13" ||
		hashes.policySHA256 !==
			"785138818c460fcdeeb2e3fcc4f2ff682b85c0572ab02ebf3fcf9e4f2547000d"
	)
		throw new Error(
			"Original probe/policy changed: refusing noncanonical diagnosis",
		);
	return hashes;
}

export function originalFailure(state: AuditState) {
	const pairs: [number, number][] = [];
	const rows = runChecks(
		{
			...state,
			onU08Failure: (a, b) => {
				pairs.push([a, b]);
			},
		},
		{
			floors: floorsFromTokens(null),
			semantic: new Set(),
			checks: ["U-08"],
			scaleIsLive: true,
		},
	);
	const failed = rows.filter((row) => row.verdict === "FAIL");
	const at = failed.findIndex((row) => row.measured === EXPECTED);
	const pair = pairs[at];
	if (at < 0 || !pair)
		throw new Error(
			"NOT REPRODUCED: original 22x18/100% U-08 candidate absent; no diagnosis claimed",
		);
	return { pair, row: failed[at] };
}
export type Rect = { x: number; y: number; w: number; h: number };
export function fragmentIntersections(a: Rect[], b: Rect[]): Rect[] {
	// Diagnostic data only: never fed into runChecks or used to change its verdict.
	return a.flatMap((x) =>
		b.flatMap((y) => {
			const left = Math.max(x.x, y.x),
				top = Math.max(x.y, y.y),
				right = Math.min(x.x + x.w, y.x + y.w),
				bottom = Math.min(x.y + x.h, y.y + y.h);
			return right > left && bottom > top
				? [{ x: left, y: top, w: right - left, h: bottom - top }]
				: [];
		}),
	);
}
function fingerprint(state: AuditState, indices: number[]) {
	return JSON.stringify(
		indices.map((index) => {
			const n = state.nodes.find((n) => n.index === index);
			return n
				? {
						index,
						ownText: n.ownText,
						path: n.path,
						rect: n.rect,
						visibleRect: n.visibleRect,
						ancestors: n.ancestors,
					}
				: null;
		}),
	);
}
export function assertRemote(env: NodeJS.ProcessEnv) {
	if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux")
		throw new Error(
			"Remote GitHub Linux diagnostic only; no local browser/engine permitted",
		);
}

async function main() {
	assertRemote(process.env);
	const originalInstrument = verifyOriginalInstrument();
	const { flags } = parseArgs(process.argv.slice(2));
	if (Object.keys(flags).some((key) => !["web-dir", "out"].includes(key)))
		throw new Error("Only the fixed single-cell proof is supported");
	const out = resolve(str(flags, "out") ?? "u08-geometry"),
		build = resolve(str(flags, "web-dir") ?? "dist");
	mkdirSync(out, { recursive: true });
	const allowed = new Set([
		".github/workflows/e2e.yml",
		"docs/ci.md",
		"tools/audit/audit.ts",
		"tools/audit/checks.ts",
		"tools/audit/probe.ts",
		"tools/audit/u08-geometry-proof.ts",
		"tools/audit/u08-geometry-proof.test.ts",
		"scripts/ci/account-routing-proof.test.ts",
		"tools/visual/core-audit-only.test.ts",
	]);
	const changed = execFileSync(
		"git",
		["diff", "--name-only", ORIGINAL_HEAD, "HEAD"],
		{ encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.filter(Boolean);
	if (changed.some((path) => !allowed.has(path)))
		throw new Error(
			"Source differs outside the reviewed diagnostic-only scope; refusing approximate proof",
		);
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	execFileSync(
		"git",
		[
			"diff",
			"--exit-code",
			ORIGINAL_HEAD,
			"HEAD",
			"--",
			"app",
			"src",
			"assets",
			"design",
			"package.json",
			"pnpm-lock.yaml",
			"app.config.ts",
			"metro.config.js",
			"babel.config.js",
			"tailwind.config.js",
		],
		{ stdio: "pipe" },
	);
	const relay = createRelay({ scenario: "long-transcript" });
	let server: Awaited<ReturnType<typeof serveDir>> | undefined,
		chrome: Awaited<ReturnType<typeof launchChrome>> | undefined;
	let cleanupPromise: Promise<void> | undefined;
	const cleanup = () =>
		(cleanupPromise ??= (async () => {
			try {
				await chrome?.close();
			} finally {
				try {
					await server?.close();
				} finally {
					await relay.shutdown();
				}
			}
		})());
	const onSignal = () => {
		void Promise.race([
			cleanup(),
			new Promise((resolve) => setTimeout(resolve, 10000)),
		]).finally(() => process.exit(2));
	};
	const watchdog = setTimeout(onSignal, 270000);
	process.once("SIGTERM", onSignal);
	process.once("SIGINT", onSignal);
	try {
		const listening = await relay.listen();
		server = await serveDir(build, { proxy: listening.url });
		chrome = await launchChrome();
		const fresh = await freshPage(chrome, null, 30000);
		if (!fresh.ok) throw new Error(fresh.reason);
		const page = fresh.page;
		await page.send("Accessibility.enable");
		const attempted = await withDeadline(
			auditCell(page, RECORD, {
				origin: server.url,
				settleMs: 1200,
				seed: { route: server.url, password: DEFAULT_PASSWORD },
				relay: listening.url,
				cellTimeoutMs: 45000,
			}),
			45000,
			"canonical failed cell",
		);
		if (!attempted.ok) throw new Error(attempted.reason);
		const state = attempted.value;
		if (!state.insetsOverride.applied)
			throw new Error(
				`Canonical env() inset override unavailable: ${state.insetsOverride.reason}`,
			);
		const mismatch = reDriveMismatch({
			screen: RECORD.screen,
			state: RECORD.state,
			askedPath: RECORD.path,
			root: undefined,
			reading: state.reading ?? null,
		});
		if (mismatch)
			throw new Error(
				`Canonical readiness mismatch: ${JSON.stringify(mismatch)}`,
			);
		if (
			state.viewport.width !== 390 ||
			state.viewport.height !== 844 ||
			state.viewport.dpr !== 3 ||
			state.insets.top !== 59 ||
			state.insets.bottom !== 34 ||
			Number(state.textScale) !== 1.5 ||
			state.theme !== "dark"
		)
			throw new Error("Exact failed-cell viewport/insets not reproduced");
		const first = originalFailure(state);
		type Geometry = {
			index: number;
			textFragments: { clipped: Rect | null }[];
			clientRects: { clipped: Rect | null }[];
			[key: string]: unknown;
		};
		const second = (await page.evaluate(
			u08GeometryProbe(first.pair),
		)) as AuditState & { u08Geometry: Geometry[] };
		const next = originalFailure(second);
		if (
			JSON.stringify(first.pair) !== JSON.stringify(next.pair) ||
			fingerprint(state, first.pair) !== fingerprint(second, next.pair)
		)
			throw new Error(
				"Pair changed between original probe and atomic fragment collection",
			);
		const png = await page.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		if (typeof png.data !== "string")
			throw new Error("No associated screenshot");
		const after = (await page.evaluate(EXTRACT_PROBE)) as AuditState;
		originalFailure(after);
		if (fingerprint(second, next.pair) !== fingerprint(after, next.pair))
			throw new Error(
				"Pair changed around screenshot; not coherent diagnostic evidence",
			);
		const geometries = second.u08Geometry;
		if (geometries.length !== 2)
			throw new Error("Missing actual pair telemetry");
		const fragments = geometries.map((g) =>
			g.textFragments.flatMap((f) => (f.clipped ? [f.clipped] : [])),
		);
		const intersections = fragmentIntersections(
			fragments[0] ?? [],
			fragments[1] ?? [],
		);
		const receipt = {
			kind: "EXPECTED ORIGINAL FAILURE REPRODUCED — diagnosis data, NOT audit PASS",
			head,
			originalHead: ORIGINAL_HEAD,
			originalRun: ORIGINAL_RUN,
			record: RECORD,
			insetsOverride: state.insetsOverride,
			pair: next,
			geometry: geometries,
			clippedTextFragmentIntersections: intersections,
			clippedClientRectIntersections: fragmentIntersections(
				geometries[0]?.clientRects.flatMap((f) =>
					f.clipped ? [f.clipped] : [],
				) ?? [],
				geometries[1]?.clientRects.flatMap((f) =>
					f.clipped ? [f.clipped] : [],
				) ?? [],
			),
			policyUnchanged: true,
			...originalInstrument,
			screenshot: "settled.png",
		};
		const json = Buffer.from(JSON.stringify(receipt, null, 2)),
			image = Buffer.from(png.data, "base64");
		if (json.length + image.length > 5 * 1024 * 1024)
			throw new Error("Geometry/screenshot exceeds 5MB artifact budget");
		writeFileSync(resolve(out, "geometry.json"), json);
		writeFileSync(resolve(out, "settled.png"), image);
		console.log(
			"Expected original U-08 failure reproduced; one-cell geometry proof saved, underlying finding remains OPEN",
		);
	} catch (error) {
		writeFileSync(
			resolve(out, "NOT-REPRODUCED.json"),
			JSON.stringify({
				head,
				originalHead: ORIGINAL_HEAD,
				originalRun: ORIGINAL_RUN,
				error: error instanceof Error ? error.message : String(error),
				diagnosed: false,
			}),
		);
		throw error;
	} finally {
		clearTimeout(watchdog);
		process.removeListener("SIGTERM", onSignal);
		process.removeListener("SIGINT", onSignal);
		await cleanup();
	}
}
if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
