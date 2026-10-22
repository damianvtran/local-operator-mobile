/** Corrected-instrument verification, never a claim to replay the old policy.
 * Four original matrix cells + one existing genuine collision, not a full audit. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export const TURN_CONTROL_ID = "turn-bar-tc-conv-00-user";
/** RNW does not forward accessibilityState.expanded. The visible caret is
 * rendered from the same open prop as the transcript plan; missing ARIA is
 * recorded, never interpreted as false. Do not read private React internals. */
/** A client-rect entry proves layout, not readable paint. Inspect the target
 * and each glyph through the complete style ancestry; parent opacity multiplies
 * rather than inherits. Only the target/glyph need their own positive-area box:
 * display:contents and zero-box overflow-visible ancestors can have visible
 * descendants. Canonical audit geometry still owns clipping/collision verdicts. */
export const TURN_CONTROL_SOURCE = `(() => {
 const controlId=${JSON.stringify(TURN_CONTROL_ID)};
 const matches=document.querySelectorAll('[data-testid="'+controlId+'"]');
 const control=matches.length===1?matches[0]:null;
 const inspect=(element,requireTarget)=>{
  const trace=[],rects=[];let failure=null,effectiveOpacity=1,tiedToTarget=false;
  const fail=(property,depth,value)=>{if(!failure)failure={property,depth,value:String(value).slice(0,160)};};
  try {
   for(const r of element.getClientRects())if(Number.isFinite(r.width)&&Number.isFinite(r.height)&&r.width>0&&r.height>0)
    rects.push({x:r.x,y:r.y,width:r.width,height:r.height});
   if(!rects.length)fail('rect-area',0,'no positive-area client rect');
  }catch(error){fail('client-rects',0,error instanceof Error?error.message:error);}
  let node=element,depth=0;
  for(;node&&depth<64;node=node.parentElement,depth++){
   if(node===control)tiedToTarget=true;
   try {
    const style=getComputedStyle(node),opacity=Number(style.opacity);
    effectiveOpacity*=opacity;
    trace.push({depth,tag:node.tagName,display:style.display,visibility:style.visibility,opacity:style.opacity,effectiveOpacity});
    if(typeof style.display!=='string'||!style.display||style.display==='none')fail('display',depth,style.display);
    if(style.visibility!=='visible')fail('visibility',depth,style.visibility);
    if(typeof style.opacity!=='string'||!style.opacity.trim()||!Number.isFinite(opacity)||opacity<=0||opacity>1)fail('opacity',depth,style.opacity);
    if(!Number.isFinite(effectiveOpacity)||effectiveOpacity<=0)fail('effective-opacity',depth,effectiveOpacity);
    if(style.contentVisibility==='hidden')fail('content-visibility',depth,style.contentVisibility);
   }catch(error){fail('computed-style',depth,error instanceof Error?error.message:error);}
  }
  if(node)fail('ancestor-proof',depth,'ancestry exceeds bounded inspection');
  if(requireTarget&&!tiedToTarget)fail('control-ancestry',0,'glyph is not inside target');
  return {readable:failure===null,failure,rects:rects.slice(0,8),trace,effectiveOpacity};
 };
 const controlVisibility=control?inspect(control,false):null;
 const candidates=control?Array.from(control.querySelectorAll('*')).filter(el=>el.childElementCount===0)
  .map(el=>({element:el,glyph:el.textContent.trim()})).filter(c=>c.glyph==='▸'||c.glyph==='▾'):[];
 const caretVisibility=candidates.slice(0,16).map(c=>({glyph:c.glyph,visibility:inspect(c.element,true)}));
 const carets=controlVisibility?.readable&&candidates.length<=16?caretVisibility.filter(c=>c.visibility.readable).map(c=>c.glyph):[];
 return {controlId,count:matches.length,ariaExpanded:control?control.getAttribute('aria-expanded'):null,
  caretCount:carets.length,carets,controlVisibility,caretVisibility,candidateCount:candidates.length};
})()`;
interface ControlVisibility {
	readable: boolean;
	failure: { property: string; depth: number; value: string } | null;
	trace: Record<string, unknown>[];
}

export interface TurnControlReading {
	controlId: string;
	count: number;
	ariaExpanded: string | null;
	caretCount: number;
	carets: string[];
	controlVisibility: ControlVisibility | null;
	caretVisibility: { glyph: string; visibility: ControlVisibility }[];
	candidateCount: number;
}
function controlFailure(reading: unknown) {
	const r = reading as Partial<TurnControlReading> | null;
	const witness = r?.controlVisibility?.failure
		? r.controlVisibility
		: Array.isArray(r?.caretVisibility)
			? r.caretVisibility.find((c) => c?.visibility?.failure)?.visibility
			: null;
	return witness?.failure
		? {
				...witness.failure,
				style: witness.trace?.find((t) => t.depth === witness.failure?.depth),
			}
		: null;
}
type CellIdentity = Pick<AuditRecord, "theme" | "state" | "path">;
export function assertTurnControl(
	record: CellIdentity,
	reading: unknown,
): asserts reading is TurnControlReading {
	const r = reading as Partial<TurnControlReading> | null;
	const expected = record.state === "expanded",
		caret = expected ? "▾" : "▸";
	const visibleWitnesses = Array.isArray(r?.caretVisibility)
		? r.caretVisibility.filter((c) => c?.visibility?.readable === true)
		: [];
	if (
		!["expanded", "condensed"].includes(record.state) ||
		!r ||
		r.controlId !== TURN_CONTROL_ID ||
		r.count !== 1 ||
		r.controlVisibility?.readable !== true ||
		!Number.isInteger(r.candidateCount) ||
		r.candidateCount === undefined ||
		r.candidateCount < 1 ||
		r.candidateCount > 16 ||
		!Array.isArray(r.caretVisibility) ||
		r.caretVisibility.length !== r.candidateCount ||
		visibleWitnesses.length !== 1 ||
		visibleWitnesses[0]?.glyph !== caret ||
		r.caretCount !== 1 ||
		!Array.isArray(r.carets) ||
		r.carets.length !== 1 ||
		r.carets[0] !== caret ||
		!(r.ariaExpanded === null || r.ariaExpanded === String(expected))
	)
		throw new Error(
			`control-state theme=${record.theme} state=${record.state} path=${record.path} control=${TURN_CONTROL_ID} expected aria=${expected} caret=${caret}; unreadable=${JSON.stringify(controlFailure(reading))}; observed=${String(JSON.stringify(reading)).slice(0, 512)}`,
		);
}
export interface FailureContext {
	head: string;
	phase: string;
	cell: CellIdentity | null;
	completedKeys: string[];
	readiness: Record<string, unknown> | null;
	environment: Record<string, unknown> | null;
	control: unknown;
	error: string;
}
/** Failure evidence belongs inside the live-page lifetime. Keep normal outputs
 * below the existing reserve, and use at most half of it for this context so
 * the outer NOT-REPRODUCED receipt still fits. Screenshot failure never becomes
 * a PASS, and never replaces the original cell failure. */
export async function writeFailureEvidence(
	out: string,
	knownBytes: number,
	context: FailureContext,
	capture: (() => Promise<unknown>) | null,
) {
	let bytes = Math.max(
		knownBytes,
		readdirSync(out).reduce(
			(n, name) => n + statSync(resolve(out, name)).size,
			0,
		),
	);
	let screenshot: { status: string; reason?: string } = {
		status: "unavailable",
		reason: "no live page",
	};
	if (capture) {
		const result = await withDeadline(
			Promise.resolve().then(capture),
			1500,
			"failure PNG",
		);
		if (!result.ok)
			screenshot = {
				status: "unavailable",
				reason: result.reason.slice(0, 256),
			};
		else {
			const data = (result.value as { data?: unknown } | null)?.data;
			const image =
				typeof data === "string"
					? Buffer.from(data, "base64")
					: Buffer.alloc(0);
			if (
				!image
					.subarray(0, 8)
					.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
			)
				screenshot = {
					status: "unavailable",
					reason: "invalid/missing PNG reply",
				};
			else if (
				bytes + image.length >
				ARTIFACT_LIMIT_BYTES - FAILURE_RESERVE_BYTES
			)
				screenshot = {
					status: "unavailable",
					reason: "aggregate artifact budget",
				};
			else {
				writeFileSync(resolve(out, "failure.png"), image);
				bytes += image.length;
				screenshot = { status: "saved" };
			}
		}
	}
	const expectedControl =
		context.cell && ["condensed", "expanded"].includes(context.cell.state)
			? {
					controlId: TURN_CONTROL_ID,
					count: 1,
					ariaExpanded: String(context.cell.state === "expanded"),
					ariaMayBeAbsent: true,
					caret: context.cell.state === "expanded" ? "▾" : "▸",
				}
			: null;
	const receipt = {
		...context,
		kind: "FAILED CORRECTED VERIFICATION — NOT A GEOMETRY VERDICT",
		schema: 1,
		expectedControl,
		readabilityFailure: controlFailure(context.control),
		diagnosed: false,
		screenshot,
	};
	let json = Buffer.from(JSON.stringify(receipt, null, 2));
	if (json.length > FAILURE_RESERVE_BYTES / 2) {
		// Oversized protocol errors must not crowd out the cell/control identity.
		receipt.error = context.error.slice(0, 256);
		receipt.readiness = {
			omitted: "context budget",
			path: context.readiness?.path,
		};
		receipt.control = {
			summary: String(JSON.stringify(context.control)).slice(0, 1024),
		};
		receipt.environment = { omitted: "context budget" };
		json = Buffer.from(JSON.stringify(receipt, null, 2));
	}
	if (
		json.length > FAILURE_RESERVE_BYTES / 2 ||
		bytes + json.length > ARTIFACT_LIMIT_BYTES - 2048
	)
		throw new Error("Failure context exceeds reserved artifact budget");
	writeFileSync(resolve(out, "failure.json"), json);
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
	const failure: FailureContext = {
		head: ctx.head,
		phase: "initializing",
		cell: null,
		completedKeys: [],
		readiness: null,
		environment: null,
		control: null,
		error: "",
	};
	async function observe(
		record: AuditRecord,
		origin: string,
		relay: string | null,
	) {
		failure.cell = {
			theme: record.theme,
			state: record.state,
			path: record.path,
		};
		failure.phase = "page-setup";
		failure.readiness = null;
		failure.environment = null;
		failure.control = null;
		const previous = page;
		page = null; // Never label the previous cell's page as the failed fresh cell.
		const fresh = await freshPage(ctx.chrome, previous, 30000);
		if (!fresh.ok) throw new Error(fresh.reason);
		page = fresh.page;
		await page.send("Accessibility.enable");
		failure.phase = "canonical-redrive";
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
		const reading = state.reading as
			| { path?: unknown; testIds?: unknown; visibleTestIds?: unknown }
			| undefined;
		const ids = (value: unknown) =>
			Array.isArray(value)
				? value
						.filter((v): v is string => typeof v === "string")
						.slice(0, 8)
						.map((v) => v.slice(0, 96))
				: [];
		failure.readiness = reading
			? {
					path:
						typeof reading.path === "string"
							? reading.path.split("?")[0]
							: null,
					testIds: ids(reading.testIds),
					visibleTestIds: ids(reading.visibleTestIds),
				}
			: null;
		failure.environment = {
			viewport: state.viewport,
			insets: state.insets,
			theme: state.theme,
			textScale: state.textScale,
			insetsOverride: state.insetsOverride,
		};
		// Preserve actual target-subtree measurements even if the first geometry
		// admission fails. These are observed candidates, never guessed old pair IDs.
		const target = state.nodes.find((n) => n.testId === TURN_CONTROL_ID);
		failure.environment.targetTextGeometry = target
			? state.nodes
					.filter((n) => n.ancestors.includes(target.index) && n.ownText)
					.slice(0, 8)
					.map((n) => ({
						index: n.index,
						ownText: n.ownText.slice(0, 80),
						rect: n.rect,
						visibleRect: n.visibleRect,
						fragmentStatus:
							n.u08PaintFragments === undefined
								? "conservative/unobserved"
								: "measured",
						fragments: n.u08PaintFragments,
					}))
			: [];
		failure.phase = "environment";
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
		failure.phase = "readiness";
		const mismatch = reDriveMismatch({
			screen: record.screen,
			state: record.state,
			askedPath: record.path,
			root: undefined,
			reading: state.reading ?? null,
		});
		if (mismatch) throw new Error("Canonical state not reproduced");
		if (relay) {
			failure.phase = "control-state";
			failure.control = await page.evaluate(TURN_CONTROL_SOURCE);
			assertTurnControl(record, failure.control);
			// Persist readiness separately before geometry adjudication can fail. This
			// is evidence of control readiness, explicitly not a geometry PASS.
			put(
				`${record.theme}-${record.state}-ready.json`,
				Buffer.from(
					JSON.stringify(
						{
							...failure,
							error: undefined,
							phase: "control-verified-not-geometry",
						},
						null,
						2,
					),
				),
			);
		}
		return { page, state };
	}
	try {
		for (const record of verificationRecords(ctx.baseRecord)) {
			const observed = await observe(record, ctx.origin, ctx.relay);
			failure.phase = "geometry";
			const first = evaluateRepairedCell(observed.state, ctx.nodePath);
			failure.phase = "geometry-telemetry";
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
			failure.phase = "settled-png";
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
				control: failure.control,
				readiness: failure.readiness,
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
			put(
				`${key}.json`,
				Buffer.from(
					JSON.stringify(
						{
							kind: "PARTIAL CORRECTED CELL — NOT COMPLETE VERIFICATION",
							head: ctx.head,
							...cells.at(-1),
						},
						null,
						2,
					),
				),
			);
			failure.completedKeys.push(key);
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
			failure.phase = "positive-control";
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
			if (typeof image.data !== "string")
				throw new Error("Missing positive PNG");
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
		failure.phase = "coverage";
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
		failure.phase = "manifest-write";
		put("verification.json", Buffer.from(JSON.stringify(receipt, null, 2)));
		console.log(
			"Corrected verification: four original-family cells disjoint; specific genuine collision remains FAIL. Not full audit PASS.",
		);
	} catch (error) {
		const message = `${failure.phase} theme=${failure.cell?.theme ?? "unknown"} state=${failure.cell?.state ?? "unknown"} path=${failure.cell?.path ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`;
		failure.error = message.slice(0, 1024);
		const livePage = page as CdpPage | null;
		try {
			await writeFailureEvidence(
				ctx.out,
				bytes,
				failure,
				livePage
					? () =>
							livePage.send("Page.captureScreenshot", {
								format: "png",
								captureBeyondViewport: false,
							})
					: null,
			);
		} catch (evidenceError) {
			console.error(
				`Failure evidence unavailable: ${evidenceError instanceof Error ? evidenceError.message : String(evidenceError)}`,
			);
		}
		throw new Error(message, { cause: error });
	}
}
