/** Corrected-instrument verification, never a claim to replay the old policy.
 * Four original matrix cells + one existing genuine collision, not a full audit. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CdpPage } from "../lib/cdp.ts";
import type { launchChrome } from "../lib/chrome.ts";
import { freshPage, withDeadline } from "../lib/page.ts";
import { reDriveMismatch } from "../lib/readiness.ts";
import { serveDir } from "../lib/static-server.ts";
import { DEFAULT_PASSWORD } from "../mock-relay/relay.ts";
import { type AuditRecord, auditCell } from "./audit.ts";
import { type AuditState, runChecks, U08_SUPPRESSION } from "./checks.ts";
import { floorsFromTokens } from "./color.ts";
import { type PaintRect, paintOverlap } from "./paint-fragments.ts";
import { EXTRACT_PROBE, u08GeometryProbe } from "./probe.ts";

export const POSITIVE_IDS = ["modal-collide-a", "modal-collide-b"] as const;
export const ARTIFACT_LIMIT_BYTES = 5 * 1024 * 1024;
export const FAILURE_RESERVE_BYTES = 16384;
export function nextArtifactBytes(current: number, next: number) {
	if (
		!Number.isSafeInteger(current) ||
		!Number.isSafeInteger(next) ||
		current < 0 ||
		next < 0 ||
		current + next > ARTIFACT_LIMIT_BYTES - FAILURE_RESERVE_BYTES
	)
		throw new Error("Corrected verification artifact budget exceeded");
	return current + next;
}

export function verificationRecords(base: AuditRecord): AuditRecord[] {
	// Canonical derivation from the original matrix's two explicit route hooks.
	// Historical reports contain no fragment sets; each record must be re-driven.
	return ["dark", "light"].flatMap((theme) =>
		[false, true].map((expanded) => ({
			...base,
			theme,
			state: expanded ? "expanded" : "condensed",
			screen: `path:/session/{sessionId}?lo-scroll=top${expanded ? "&lo-expand=tc-conv-00-user" : ""}`,
			path: `/session/6714def86197?lo-scroll=top${expanded ? "&lo-expand=tc-conv-00-user" : ""}`,
			openers: [],
		})),
	);
}
const CONTROL = /^turn-bar-tc-conv-(?:0[0-9]|1[0-2])-user$/;
export function evaluateRepairedCell(state: AuditState, nodePath: string) {
	if (state.u08GeometryVersion !== 1)
		throw new Error("Missing corrected fragment schema");
	const decisions: {
		pair: [number, number];
		verdict: string;
		reason: string;
	}[] = [];
	const rows = runChecks(
		{
			...state,
			onU08Decision: (a, b, verdict, reason) =>
				decisions.push({ pair: [a, b], verdict, reason }),
		},
		{
			floors: floorsFromTokens(null),
			semantic: new Set(),
			checks: ["U-08"],
			scaleIsLive: true,
		},
	);
	const candidates = decisions.filter(({ pair }) => {
		const a = state.nodes.find((n) => n.index === pair[0]),
			b = state.nodes.find((n) => n.index === pair[1]);
		if (!a || !b || a.path !== nodePath || b.path !== nodePath) return false;
		const legacy = paintOverlap(
			{ visibleRect: a.visibleRect },
			{ visibleRect: b.visibleRect },
		);
		return (
			legacy.pct === 1 &&
			legacy.intersections.some((r) => r.w === 22 && r.h === 18)
		);
	});
	if (candidates.length !== 1)
		throw new Error("Missing/ambiguous original envelope-family candidate");
	const candidate = candidates[0];
	if (!candidate) throw new Error("Missing candidate");
	const nodes = candidate.pair.map((index) =>
		state.nodes.find((n) => n.index === index),
	);
	for (const node of nodes) {
		if (
			!node ||
			!Array.isArray(node.u08PaintFragments) ||
			!node.u08PaintFragments.some((r) => r.w > 0 && r.h > 0)
		)
			throw new Error("Missing actual own-text fragment measurement");
		const control = node.ancestors
			.map((index) => state.nodes.find((n) => n.index === index))
			.find((n) => n?.tag === "button");
		if (!control || !control.interactive || !CONTROL.test(control.testId ?? ""))
			throw new Error("Wrong actual fixture control scope");
	}
	const a = nodes[0],
		b = nodes[1];
	if (!a || !b) throw new Error("Missing pair nodes");
	const overlap = paintOverlap(a, b);
	if (
		candidate.verdict !== "EXCEPTION" ||
		candidate.reason !== U08_SUPPRESSION.DISJOINT ||
		overlap.intersections.length !== 0 ||
		rows.some((row) => row.verdict === "FAIL")
	)
		throw new Error(
			"Unexpected residual U-08 collision or wrong policy outcome",
		);
	return { ...candidate, geometry: overlap, nodes };
}
function fingerprint(state: AuditState, pair: readonly number[]) {
	return JSON.stringify(
		pair
			.map((index) => state.nodes.find((n) => n.index === index))
			.map((n) =>
				n
					? {
							index: n.index,
							path: n.path,
							ownText: n.ownText,
							rect: n.rect,
							visibleRect: n.visibleRect,
							fragments: n.u08PaintFragments,
							ancestors: n.ancestors,
						}
					: null,
			),
	);
}
export function assertCoverage(cells: { key: string }[], positive: boolean) {
	const keys = new Set(cells.map((c) => c.key));
	if (
		cells.length !== 4 ||
		keys.size !== 4 ||
		![
			"dark-condensed",
			"dark-expanded",
			"light-condensed",
			"light-expanded",
		].every((k) => keys.has(k)) ||
		!positive
	)
		throw new Error("Incomplete four-cell/positive-control coverage");
}

interface Context {
	chrome: Awaited<ReturnType<typeof launchChrome>>;
	origin: string;
	relay: string;
	out: string;
	head: string;
	baseRecord: AuditRecord;
	nodePath: string;
	historical: {
		head: string;
		run: string;
		probeSHA256: string;
		policySHA256: string;
	};
}
export async function verifyFragments(ctx: Context) {
	let page: CdpPage | null = null,
		bytes = 0;
	// Reserve space for a bounded failure receipt, even after a partial capture.
	const put = (name: string, data: Buffer) => {
		const total = nextArtifactBytes(bytes, data.length);
		writeFileSync(resolve(ctx.out, name), data);
		bytes = total;
	};
	const cells: Record<string, unknown>[] = [];
	async function observe(
		record: AuditRecord,
		origin: string,
		relay: string | null,
	) {
		const fresh = await freshPage(ctx.chrome, page, 30000);
		if (!fresh.ok) throw new Error(fresh.reason);
		page = fresh.page;
		await page.send("Accessibility.enable");
		const attempted = await withDeadline(
			auditCell(page, record, {
				origin,
				relay,
				seed: relay ? { route: origin, password: DEFAULT_PASSWORD } : null,
				settleMs: 1200,
				cellTimeoutMs: 45000,
			}),
			45000,
			"corrected verification cell",
		);
		if (!attempted.ok) throw new Error(attempted.reason);
		const state = {
			...attempted.value,
			...((await page.evaluate(EXTRACT_PROBE)) as AuditState),
		};
		if (!state.insetsOverride.applied)
			throw new Error("Canonical env() override unavailable");
		if (
			state.viewport.width !== 390 ||
			state.viewport.height !== 844 ||
			state.viewport.dpr !== 3 ||
			state.insets.top !== 59 ||
			state.insets.bottom !== 34 ||
			Number(state.textScale) !== 1.5 ||
			state.theme !== record.theme
		)
			throw new Error("Canonical viewport/scale/insets mismatch");
		const mismatch = reDriveMismatch({
			screen: record.screen,
			state: record.state,
			askedPath: record.path,
			root: undefined,
			reading: state.reading ?? null,
		});
		if (mismatch) throw new Error("Canonical state not reproduced");
		if (relay) {
			const expanded = await page.evaluate(
				`document.querySelector('[data-testid="turn-bar-tc-conv-00-user"]')?.getAttribute('aria-expanded')`,
			);
			if (expanded !== String(record.state === "expanded"))
				throw new Error(
					"Canonical expanded/condensed control state not reproduced",
				);
		}
		return { page, state };
	}
	for (const record of verificationRecords(ctx.baseRecord)) {
		const observed = await observe(record, ctx.origin, ctx.relay),
			first = evaluateRepairedCell(observed.state, ctx.nodePath);
		const raw = (await observed.page.evaluate(
			u08GeometryProbe(first.pair),
		)) as AuditState & {
			u08Geometry: {
				index: number;
				pressable: { index: number; testId: string } | null;
				textFragments: { clipped: PaintRect | null }[];
			}[];
		};
		const state = { ...observed.state, ...raw };
		if (
			state.theme !== record.theme ||
			Number(state.textScale) !== 1.5 ||
			state.viewport.dpr !== 3
		)
			throw new Error("Actual cell environment drift");
		const current = evaluateRepairedCell(state, ctx.nodePath);
		if (
			JSON.stringify(first.pair) !== JSON.stringify(current.pair) ||
			fingerprint(observed.state, first.pair) !==
				fingerprint(state, current.pair)
		)
			throw new Error("Pair drift during geometry capture");
		if (
			JSON.stringify(raw.u08Geometry.map((g) => g.index)) !==
			JSON.stringify(current.pair)
		)
			throw new Error("Missing/duplicate actual pair telemetry");
		for (const g of raw.u08Geometry) {
			const node = state.nodes.find((n) => n.index === g.index);
			if (
				JSON.stringify(
					g.textFragments.flatMap((f) => (f.clipped ? [f.clipped] : [])),
				) !== JSON.stringify(node?.u08PaintFragments)
			)
				throw new Error(
					"Diagnostic text fragments disagree with actual policy input",
				);
			const control = node?.ancestors
				.map((i) => state.nodes.find((n) => n.index === i))
				.find((n) => n?.tag === "button");
			if (
				!g.pressable ||
				g.pressable.index !== control?.index ||
				g.pressable.testId !== control?.testId
			)
				throw new Error("Actual DOM control identity mismatch");
		}
		if (raw.u08Geometry.length !== 2)
			throw new Error("Missing actual pair telemetry");
		const screenshot = await observed.page.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		if (typeof screenshot.data !== "string")
			throw new Error("Missing corrected cell PNG");
		const after = {
			...observed.state,
			...((await observed.page.evaluate(EXTRACT_PROBE)) as AuditState),
		};
		if (
			after.theme !== record.theme ||
			Number(after.textScale) !== 1.5 ||
			after.viewport.dpr !== 3
		)
			throw new Error("Actual cell environment drift around screenshot");
		evaluateRepairedCell(after, ctx.nodePath);
		if (fingerprint(state, current.pair) !== fingerprint(after, current.pair))
			throw new Error("Pair drift around screenshot");
		const key = `${record.theme}-${record.state}`;
		put(`${key}.png`, Buffer.from(screenshot.data, "base64"));
		cells.push({
			key,
			record,
			actualEnvironment: {
				viewport: state.viewport,
				insets: state.insets,
				theme: state.theme,
				textScale: state.textScale,
				insetsOverride: state.insetsOverride,
			},
			pair: current.pair,
			decision: current.verdict,
			reason: current.reason,
			overlap: current.geometry,
			geometry: raw.u08Geometry,
			screenshot: `${key}.png`,
		});
	}
	// Reuse the existing canary's genuine two-control collision. Scroll that exact
	// fixture into view; do not inject a collision into the product or run a matrix.
	const canary = await serveDir(resolve("e2e/fixtures/audit-canary"));
	let positive: Record<string, unknown> | undefined;
	try {
		const record: AuditRecord = {
			...ctx.baseRecord,
			screen: "path:/defects",
			path: "/defects",
			state: "defects",
			pinnedScenario: null,
			openers: [],
		};
		const observed = await observe(record, canary.url, null);
		const pair = (await observed.page.evaluate(
			`(()=>{const a=document.getElementById('modal-collide-a'),b=document.getElementById('modal-collide-b');if(!a||!b)throw new Error('Missing existing positive fixture');a.scrollIntoView({block:'center'});const all=[...document.querySelectorAll('body *')];return [all.indexOf(a),all.indexOf(b)];})()`,
		)) as number[];
		if (pair.length !== 2 || pair.some((i) => !Number.isInteger(i) || i < 0))
			throw new Error("Invalid positive fixture identity");
		const state = {
			...observed.state,
			...((await observed.page.evaluate(EXTRACT_PROBE)) as AuditState),
		};
		const events: { pair: number[]; verdict: string }[] = [];
		runChecks(
			{
				...state,
				onU08Decision: (a, b, verdict) =>
					events.push({ pair: [a, b], verdict }),
			},
			{
				floors: floorsFromTokens(null),
				semantic: new Set(),
				checks: ["U-08"],
				scaleIsLive: true,
			},
		);
		const event = events.find(
			(e) =>
				e.verdict === "FAIL" &&
				e.pair.includes(pair[0] ?? -1) &&
				e.pair.includes(pair[1] ?? -1),
		);
		if (!event) throw new Error("Specific genuine collision no longer FAILS");
		const geometry = await observed.page.evaluate(u08GeometryProbe(pair));
		const image = await observed.page.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		if (typeof image.data !== "string") throw new Error("Missing positive PNG");
		put("positive-control.png", Buffer.from(image.data, "base64"));
		const after = {
			...observed.state,
			...((await observed.page.evaluate(EXTRACT_PROBE)) as AuditState),
		};
		if (fingerprint(state, pair) !== fingerprint(after, pair))
			throw new Error("Positive control drift");
		positive = {
			fixture: "e2e/fixtures/audit-canary/index.html",
			ids: POSITIVE_IDS,
			pair,
			verdict: event.verdict,
			nodes: state.nodes.filter((n) => pair.includes(n.index)),
			geometry: (geometry as { u08Geometry: unknown }).u08Geometry,
			screenshot: "positive-control.png",
		};
	} finally {
		await canary.close();
	}
	assertCoverage(cells as { key: string }[], positive !== undefined);
	const sha = (source: string) =>
		createHash("sha256").update(source).digest("hex");
	const receipt = {
		kind: "CORRECTED FRAGMENT VERIFICATION — NOT HISTORICAL REPRODUCTION OR FULL AUDIT",
		head: ctx.head,
		schema: 1,
		historicalIncident: ctx.historical,
		hostedBeforeProofRun: "39544082930",
		recordDerivation:
			"original canonical matrix: light/dark x condensed/expanded explicit route hooks; not recovered historical DOM fragments",
		currentProbeSHA256: sha(EXTRACT_PROBE),
		currentChecksSHA256: sha(
			readFileSync(new URL("./checks.ts", import.meta.url), "utf8"),
		),
		currentMathSHA256: sha(
			readFileSync(new URL("./paint-fragments.ts", import.meta.url), "utf8"),
		),
		cells,
		positive,
	};
	put("verification.json", Buffer.from(JSON.stringify(receipt, null, 2)));
	console.log(
		"Corrected verification: four original-family cells disjoint; specific genuine collision remains FAIL. Not full audit PASS.",
	);
}
