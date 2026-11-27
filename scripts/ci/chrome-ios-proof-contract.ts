/**
 * The chrome proof's fixed plan, as data: which simulator lanes run, and the
 * frames every lane must produce. Kept out of `chrome-ios-proof.ts` so it can be
 * unit-tested in Node (that driver refuses to run off a hosted macOS dispatch).
 *
 * THE LANES are the decision record's §7 device classes that a hosted iOS
 * runner can give (D1–D4, D7) in the two Local Operator themes, plus the
 * Reduce Transparency fallback. Android (D5/D6) is NOT here: it needs the KVM
 * emulator lane in a different workflow job, and is reported as not run.
 *
 * `before` lanes run main's own simulator build first with the same flows, so
 * each changed screen gets a before/after pair from one runner, one runtime and
 * one device — the only comparison in which a pixel difference is the change.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { decodePng } from "./rail-paint-proof.ts";

export type Lane = {
	id: string;
	/** A device-type NAME as `simctl list devicetypes` prints it. */
	device: string;
	os: 26 | 18;
	theme: "dark" | "light";
	reduceTransparency?: boolean;
	before?: boolean;
};

export const LANES: readonly Lane[] = [
	// D1: home-button phone, R = 0 → r_b = 16, inner padding 2.
	{
		id: "d1-se-dark",
		device: "iPhone SE (3rd generation)",
		os: 26,
		theme: "dark",
	},
	// D2: 393 pt, R = 55 → r_b = 47.
	{
		id: "d2-16-dark",
		device: "iPhone 16",
		os: 26,
		theme: "dark",
		before: true,
	},
	// D3: the operator's class, 402 pt, R ≈ 62 → r_b = 54; both themes.
	{
		id: "d3-17pro-dark",
		device: "iPhone 17 Pro",
		os: 26,
		theme: "dark",
		before: true,
	},
	{
		id: "d3-17pro-light",
		device: "iPhone 17 Pro",
		os: 26,
		theme: "light",
		before: true,
	},
	// D4: 440 pt Pro Max.
	{
		id: "d4-17promax-light",
		device: "iPhone 17 Pro Max",
		os: 26,
		theme: "light",
	},
	// The fallback on iOS 26: Reduce Transparency on → solid fill, same boxes.
	{
		id: "d3-17pro-dark-rt",
		device: "iPhone 17 Pro",
		os: 26,
		theme: "dark",
		reduceTransparency: true,
	},
	// D7: iOS 18 → no Liquid Glass → solid fill. Skipped if the image lacks the runtime.
	{ id: "d7-16-ios18-dark", device: "iPhone 16", os: 18, theme: "dark" },
];

/** The frames each build in a lane must produce, in the order taken. */
export const LANE_FRAMES = [
	"session",
	"session-keyboard",
	"home",
	"sidebar",
] as const;

/** Assert a lane's frame set is complete for every build it ran, and list it.
 *  Sampled drag frames live in `<build>/drag/`; they are listed, never required:
 *  only lanes with a baseline sample, and the required set above is unchanged. */
export function collectChromeFrames(laneDir: string): string[] {
	const found: string[] = [];
	for (const build of readdirSync(laneDir, { withFileTypes: true })) {
		if (!build.isDirectory()) continue;
		const entries = readdirSync(join(laneDir, build.name), {
			withFileTypes: true,
		});
		const names = entries.map((entry) => entry.name);
		for (const frame of LANE_FRAMES)
			assert(
				names.includes(`${frame}.png`),
				`missing ${build.name}/${frame}.png`,
			);
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				found.push(`${build.name}/${entry.name}`);
				continue;
			}
			for (const inner of readdirSync(join(laneDir, build.name, entry.name)))
				found.push(`${build.name}/${entry.name}/${inner}`);
		}
	}
	assert(found.length > 0, "no frames collected");
	return found.sort();
}

/**
 * `PROOF_LANES` (comma-separated lane ids): run only those lanes.
 *
 * INVARIANT: the knob can only REDUCE coverage. It never turns a narrowed run
 * into a full-proof claim — `narrowed` is true whenever fewer lanes ran than the
 * plan holds, and the driver leads its verdict with `NARROWED to <ids>` — and
 * `collectChromeFrames` still asserts every lane that DID run produced its
 * required frames. An unknown id throws rather than running nothing: a typo
 * that silently selected zero lanes would read as a clean (empty) proof.
 */
export function selectLanes(
	raw: string | undefined,
	lanes: readonly Lane[] = LANES,
): { lanes: readonly Lane[]; requested: string[]; narrowed: boolean } {
	const requested = (raw ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
	if (requested.length === 0) return { lanes, requested: [], narrowed: false };
	const unknown = requested.filter((id) => !lanes.some((l) => l.id === id));
	assert(
		unknown.length === 0,
		`PROOF_LANES names unknown lane(s): ${unknown.join(",")}`,
	);
	const picked = lanes.filter((lane) => requested.includes(lane.id));
	return {
		lanes: picked,
		requested,
		narrowed: picked.length < lanes.length,
	};
}

/**
 * The finger-driven keyboard flows, run (sampled) only on lanes that have a
 * baseline. `cap` is the Maestro budget in seconds; `rule` names the verdict
 * that reads the flow's frames: `follow` is `dragVerdict` + `pairVerdict`,
 * `recovery` is `shortpullVerdict` + `shortpullPair`.
 *
 * ORDER MATTERS: the short pull runs FIRST. Its verdict compares the run's
 * first and last usable samples, so it must start from `session-keyboard.yaml`'s
 * keyboard-up end state; run after the full drag it would start with the
 * keyboard dismissed and its "first" sample would be the wrong resting place.
 * The pull ends with the keyboard up (the driver asserts it), which is the
 * state the drag flow's own first tap expects.
 */
export const DRAG_FLOWS = [
	{ file: "session-keyboard-shortpull.yaml", cap: 300, rule: "recovery" },
	{ file: "session-keyboard-drag.yaml", cap: 300, rule: "follow" },
] as const;

/**
 * The UNSAMPLED prepare step shared by both measured flows: scroll the
 * transcript to its top, then re-focus the composer. The driver samples
 * screenshots over the whole of a Maestro invocation, so any motion in the same
 * invocation as the gesture (ten prepare swipes, the re-tap's keyboard
 * animation) would sit inside the compared samples and could fake engagement.
 * It therefore runs as its OWN invocation, through `flow` (no screenshots), and
 * the sampled flows hold the single measured swipe.
 */
export const KEYBOARD_READY_FLOW = "session-keyboard-ready.yaml";

// ---------------------------------------------------------------------------
// Finger-driven keyboard: measurement and verdict (pure; no I/O).
//
// WHAT IS CLAIMED. The composer rides the keyboard DURING a drag. Once the
// finger lifts, the keyboard is gone and the composer sits at the bottom in
// BOTH builds, so only frames sampled while the finger is down can tell them
// apart. The instrument therefore needs a BEFORE measurement showing the
// composer stay put (main) before an AFTER measurement showing it follow means
// anything.
//
// UNITS. Screenshots are 3x on every lane that has a baseline (iPhone 16 is
// 1179 px for 393 pt, iPhone 17 Pro 1206 px for 402 pt); distances below are in
// points so the thresholds read against the device's own geometry.
//
// DERIVATION OF THE THRESHOLDS (none is tuned to a result):
//  - The composer's lift equals the keyboard's height (~336 pt on the 402 pt
//    class), so a full drag moves the composer by the same amount as the
//    keyboard. FOLLOW_TOLERANCE_PT = 8 is ~2.4 % of that travel and well above
//    the 3-6 px (1-2 pt) noise of a 3x screenshot.
//  - KEYBOARD_MIN_TRAVEL_PT = 60 is ~18 % of the travel: the smallest motion
//    that cannot be a bounce. Less means the drag did not engage and the
//    instrument can say nothing.
//  - The follow tolerance applies to the SEPARATION (keyboardEdge − composerEdge)
//    over EVERY compared frame, not only the first and last: a composer that
//    lags mid-drag and catches up has the right endpoints and the wrong
//    behaviour. A rigidly attached composer keeps a constant separation, so its
//    spread (max − min, in pt) must stay within the same 8 pt (≥ 24 px at 3x).
//  - RECOVERY_TOLERANCE_PT = 4 (short pull): ~12 px at 3x, the smallest return
//    to the starting position that is not screenshot noise (1-2 pt). The pull
//    must also have displaced the keyboard by MORE than this in at least two
//    samples, else "it came back" is true of a keyboard that never moved.
//  - STATIC_TOLERANCE_PT = 12: with the keyboard having moved >= 60 pt, a
//    follower's composer has moved >= 52 pt, so 12 pt separates "stayed put"
//    from "followed" by a wide margin while absorbing measurement noise.
//  - MONOTONE_NOISE_PT = 2 is the 1-2 pt screenshot noise above: a dragged
//    keyboard only descends, so a rise larger than noise is not the drag.
// The remaining constants are ESTIMATES, not measurements of a real frame
// (none existed when written); they only ever make the verdict MORE
// inconclusive, never turn a miss into a pass:
//  - EDGE_FLOOR: a row-mean luminance step under 2/255 is anti-aliasing, not a
//    panel boundary; a flat image yields no edge at all.
//  - AMBIGUITY_RATIO: a third edge as strong as 80 % of the second makes "which
//    two are the composer and the keyboard" a guess, so the frame is dropped.
//  - MOTION_FLOOR: a blinking caret (~3 x 60 px at contrast ~200 over a
//    1.2 Mpx band) moves the band's mean by ~0.03; 0.1 sits above it, while a
//    keyboard edge shifting even 10 px at contrast >= 10 moves it by ~0.1.
// ---------------------------------------------------------------------------

export const DEFAULT_PX_PER_PT = 3;
export const EDGE_MIN_SEPARATION_PT = 20;
export const EDGE_FLOOR = 2;
export const AMBIGUITY_RATIO = 0.8;
export const MOTION_FLOOR = 0.1;
export const MIN_WINDOW_SAMPLES = 3;
export const KEYBOARD_MIN_TRAVEL_PT = 60;
export const FOLLOW_TOLERANCE_PT = 8;
export const STATIC_TOLERANCE_PT = 12;
export const RECOVERY_TOLERANCE_PT = 4;
export const MONOTONE_NOISE_PT = 2;
/** R3-1: the clean, non-rising run must hold at least this share of the frames
 *  in the motion window, else too many bad frames were dropped to say the run
 *  is "the drag". An ESTIMATE, not a measurement; it only ever adds
 *  inconclusive results. */
export const SEGMENT_COVERAGE_MIN = 0.9;
/** Edges are searched in the lower part of the frame (composer + keyboard); the
 *  motion energy is read from the bottom part. Both are fractions of height. */
const EDGE_REGION_FROM = 0.55;
const MOTION_REGION_FROM = 0.6;

export type FrameMeasure = {
	width: number;
	height: number;
	/** Row indices (px), upper = the composer's edge, lower = the keyboard's;
	 *  null with a `reason` when the pair cannot be read unambiguously. */
	edges: { composerEdge: number; keyboardEdge: number } | null;
	reason?: string;
	/** Luminance of the bottom 40 % (row-major, width wide), for motion. */
	bottom: Uint8Array;
};

/** One frame: its luminance row profile -> the two edges, and its bottom band. */
export function measureFrame(
	bytes: Uint8Array,
	label: string,
	pxPerPt = DEFAULT_PX_PER_PT,
): FrameMeasure {
	const png = decodePng(bytes, label);
	const { width, height, channels, pixels } = png;
	const bandTop = Math.floor(height * MOTION_REGION_FROM);
	const bottom = new Uint8Array(width * (height - bandTop));
	const profile = new Float64Array(height);
	for (let y = 0; y < height; y += 1) {
		let sum = 0;
		let index = y * width * channels;
		for (let x = 0; x < width; x += 1) {
			const lum =
				channels === 1
					? (pixels[index] ?? 0)
					: 0.299 * (pixels[index] ?? 0) +
						0.587 * (pixels[index + 1] ?? 0) +
						0.114 * (pixels[index + 2] ?? 0);
			index += channels;
			sum += lum;
			if (y >= bandTop) bottom[(y - bandTop) * width + x] = Math.round(lum);
		}
		profile[y] = sum / width;
	}
	// |delta row| at y is the step between row y and y + 1; peaks are its local
	// maxima, so a boundary smeared over two rows counts once.
	const from = Math.floor(height * EDGE_REGION_FROM);
	const peaks: { y: number; strength: number }[] = [];
	const step = (y: number) =>
		Math.abs((profile[y + 1] ?? 0) - (profile[y] ?? 0));
	for (let y = from; y < height - 1; y += 1) {
		const here = step(y);
		if (
			here >= EDGE_FLOOR &&
			(y === from || here > step(y - 1)) &&
			(y === height - 2 || here >= step(y + 1))
		)
			peaks.push({ y, strength: here });
	}
	peaks.sort((a, b) => b.strength - a.strength);
	const minSeparation = EDGE_MIN_SEPARATION_PT * pxPerPt;
	const first = peaks[0];
	const second = first
		? peaks.find((p) => Math.abs(p.y - first.y) >= minSeparation)
		: undefined;
	if (!first || !second)
		return {
			width,
			height,
			edges: null,
			reason: `${label}: fewer than two edges >= ${EDGE_MIN_SEPARATION_PT} pt apart`,
			bottom,
		};
	const third = peaks.find(
		(p) =>
			Math.abs(p.y - first.y) >= minSeparation &&
			Math.abs(p.y - second.y) >= minSeparation &&
			p !== first &&
			p !== second,
	);
	if (third && third.strength >= AMBIGUITY_RATIO * second.strength)
		return {
			width,
			height,
			edges: null,
			reason: `${label}: ambiguous edges (a third edge is ${((100 * third.strength) / second.strength).toFixed(0)} % as strong as the second)`,
			bottom,
		};
	return {
		width,
		height,
		edges: {
			composerEdge: Math.min(first.y, second.y),
			keyboardEdge: Math.max(first.y, second.y),
		},
		bottom,
	};
}

/** Mean |difference| of two same-size luminance bands. */
const bandMotion = (a: Uint8Array, b: Uint8Array): number => {
	let sum = 0;
	for (let i = 0; i < a.length; i += 1)
		sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
	return sum / a.length;
};

export type DragBuild = "before" | "after";
export type DragStatus = "ok" | "fail" | "inconclusive";
export type DragVerdict = {
	status: DragStatus;
	reason: string;
	/** pt, positive = descending; present once a drag segment was measured. */
	deltaKeyboard?: number;
	deltaComposer?: number;
	/** pt; max − min of (keyboardEdge − composerEdge) over the compared frames. */
	gapSpread?: number;
	/** Frames inside the motion window / frames in the measured drag segment. */
	windowSamples?: number;
	segmentSamples?: number;
};

/** Every sample decoded and measured, or the reason none can be trusted. */
function measureSamples(
	pngs: readonly Uint8Array[],
	pxPerPt: number,
): { frames: FrameMeasure[] } | { reason: string } {
	if (pngs.length < MIN_WINDOW_SAMPLES)
		return {
			reason: `${pngs.length} sample(s); need at least ${MIN_WINDOW_SAMPLES}`,
		};
	let frames: FrameMeasure[];
	try {
		frames = pngs.map((bytes, i) =>
			measureFrame(bytes, `sample ${i}`, pxPerPt),
		);
	} catch (error) {
		return { reason: `unreadable PNG: ${String(error)}` };
	}
	const size = `${frames[0]?.width}x${frames[0]?.height}`;
	if (frames.some((f) => `${f.width}x${f.height}` !== size))
		return { reason: "samples differ in size" };
	return { frames };
}

/**
 * The verdict for ONE build's sampled drag, from its PNGs in capture order.
 *
 * FAIL-CLOSED: `ok` is returned on exactly two paths — `after` where the
 * composer followed, `before` where it did not. An unreadable PNG, mixed frame
 * sizes, no motion, too few samples, a missing or ambiguous edge pair, a drag
 * that did not engage, or a BEFORE that also follows is `inconclusive` with a
 * reason, never `ok`. `fail` is reserved for an AFTER that was measured well
 * and did not follow.
 *
 * The measured segment is the run of consecutive frames inside the motion
 * window, whose edge pair reads cleanly and whose keyboard edge never rises (a
 * drag only descends), that the keyboard travelled furthest in. That keeps the frames after the finger lifts —
 * the keyboard gone, or springing back, the composer dropping in main — out of
 * the first-vs-last comparison, where main and the branch look the same.
 *
 * Following needs the endpoints to agree AND the separation to hold across the
 * whole segment (`gapSpread`): a composer that lags mid-drag and catches up is
 * not attached to the finger.
 */
export function dragVerdict(
	build: DragBuild,
	pngs: readonly Uint8Array[],
	pxPerPt = DEFAULT_PX_PER_PT,
): DragVerdict {
	const inconclusive = (
		reason: string,
		extra: Partial<DragVerdict> = {},
	): DragVerdict => ({ status: "inconclusive", reason, ...extra });
	const read = measureSamples(pngs, pxPerPt);
	if ("reason" in read) return inconclusive(read.reason);
	const { frames } = read;

	// The motion window: first to last frame touched by above-floor motion.
	let start = -1;
	let end = -1;
	for (let i = 1; i < frames.length; i += 1) {
		const motion = bandMotion(
			(frames[i - 1] as FrameMeasure).bottom,
			(frames[i] as FrameMeasure).bottom,
		);
		if (motion > MOTION_FLOOR) {
			if (start < 0) start = i - 1;
			end = i;
		}
	}
	if (start < 0)
		return inconclusive(
			`no motion above the floor (${MOTION_FLOOR}) in the bottom 40 %`,
		);
	const windowSamples = end - start + 1;
	if (windowSamples < MIN_WINDOW_SAMPLES)
		return inconclusive(
			`${windowSamples} sample(s) inside the motion window; need at least ${MIN_WINDOW_SAMPLES}`,
			{ windowSamples },
		);

	// Clean, non-rising runs inside the window; the drag is the run the keyboard
	// travelled furthest in (scrolling the transcript to the top before the drag
	// can split the run with frames whose edges read ambiguously, and a run of
	// frames with a static keyboard must not outvote the drag).
	const noise = MONOTONE_NOISE_PT * pxPerPt;
	type Run = { from: number; to: number };
	const edgesAt = (i: number) =>
		(frames[i] as FrameMeasure).edges as NonNullable<FrameMeasure["edges"]>;
	const travel = (r: Run) =>
		edgesAt(r.to).keyboardEdge - edgesAt(r.from).keyboardEdge;
	let best: Run | null = null;
	let current: Run | null = null;
	const close = () => {
		if (!current) return;
		const closed: Run = current;
		current = null;
		if (
			closed.to - closed.from + 1 >= MIN_WINDOW_SAMPLES &&
			(!best || travel(closed) > travel(best))
		)
			best = closed;
	};
	for (let i = start; i <= end; i += 1) {
		if (!(frames[i] as FrameMeasure).edges) {
			close();
			continue;
		}
		if (current) {
			const tail: Run = current;
			if (edgesAt(i).keyboardEdge < edgesAt(tail.to).keyboardEdge - noise)
				close();
		}
		if (current) (current as Run).to = i;
		else current = { from: i, to: i };
	}
	close();
	const run = best as Run | null;
	const segmentSamples = run ? run.to - run.from + 1 : 0;
	if (!run || segmentSamples < MIN_WINDOW_SAMPLES) {
		const firstReason = frames
			.slice(start, end + 1)
			.find((f) => f.reason)?.reason;
		return inconclusive(
			`${segmentSamples} clean sample(s) in the drag segment; need at least ${MIN_WINDOW_SAMPLES}${firstReason ? ` (${firstReason})` : ""}`,
			{ windowSamples, segmentSamples },
		);
	}
	// R3-1 (and U5): a segment that is a minority of the window may have
	// dropped the very frames that disagree with it.
	if (segmentSamples / windowSamples < SEGMENT_COVERAGE_MIN)
		return inconclusive(
			`the clean drag segment holds ${segmentSamples} of ${windowSamples} motion-window samples (${((100 * segmentSamples) / windowSamples).toFixed(0)} %); need at least ${(100 * SEGMENT_COVERAGE_MIN).toFixed(0)} %`,
			{ windowSamples, segmentSamples },
		);
	const a = (frames[run.from] as FrameMeasure).edges as NonNullable<
		FrameMeasure["edges"]
	>;
	const b = (frames[run.to] as FrameMeasure).edges as NonNullable<
		FrameMeasure["edges"]
	>;
	const deltaKeyboard = (b.keyboardEdge - a.keyboardEdge) / pxPerPt;
	const deltaComposer = (b.composerEdge - a.composerEdge) / pxPerPt;
	// Continuous attachment: the separation must not drift anywhere in the
	// segment, not just between its endpoints (U1).
	const gaps: number[] = [];
	for (let i = run.from; i <= run.to; i += 1)
		gaps.push(edgesAt(i).keyboardEdge - edgesAt(i).composerEdge);
	const gapSpread = (Math.max(...gaps) - Math.min(...gaps)) / pxPerPt;
	const numbers = `Δkeyboard=${deltaKeyboard.toFixed(1)} pt, Δcomposer=${deltaComposer.toFixed(1)} pt, separation spread=${gapSpread.toFixed(1)} pt over ${segmentSamples} samples`;
	const measured = {
		deltaKeyboard,
		deltaComposer,
		gapSpread,
		windowSamples,
		segmentSamples,
	};
	if (deltaKeyboard < KEYBOARD_MIN_TRAVEL_PT)
		return inconclusive(
			`the drag did not engage: ${numbers} (need Δkeyboard >= ${KEYBOARD_MIN_TRAVEL_PT} pt)`,
			measured,
		);
	const followed =
		Math.abs(deltaComposer - deltaKeyboard) <= FOLLOW_TOLERANCE_PT &&
		deltaComposer > 0 &&
		gapSpread <= FOLLOW_TOLERANCE_PT;
	if (build === "after")
		return followed
			? {
					status: "ok",
					reason: `the composer followed the keyboard: ${numbers}`,
					...measured,
				}
			: {
					status: "fail",
					reason: `the composer did not follow the keyboard: ${numbers} (need |Δcomposer − Δkeyboard| <= ${FOLLOW_TOLERANCE_PT} pt, Δcomposer > 0 and a separation spread <= ${FOLLOW_TOLERANCE_PT} pt)`,
					...measured,
				};
	if (deltaComposer <= STATIC_TOLERANCE_PT)
		return {
			status: "ok",
			reason: `baseline: the composer did not follow the keyboard: ${numbers}`,
			...measured,
		};
	return inconclusive(
		followed
			? `the BEFORE build also shows the composer following: ${numbers}`
			: `the BEFORE composer moved but not with the keyboard: ${numbers}`,
		measured,
	);
}

/**
 * One flow's verdict across the pair. `ok` needs a baseline that did not follow
 * AND an after that did; an after FAIL stays a fail (its numbers are real
 * whatever the baseline did); everything else is inconclusive.
 */
export function pairVerdict(
	before: DragVerdict,
	after: DragVerdict,
): DragVerdict {
	if (after.status === "fail") return after;
	if (before.status === "ok" && after.status === "ok")
		return { ...after, reason: `${before.reason}; ${after.reason}` };
	return {
		status: "inconclusive",
		reason: `before ${before.status}: ${before.reason}; after ${after.status}: ${after.reason}`,
	};
}

/**
 * The short pull's verdict: RECOVERY, not following. A pull too short to
 * dismiss the keyboard must leave both edges where they started: the keyboard
 * sprang back and the composer with it (never stranded at the dragged position).
 * No travel floor applies — the keyboard barely moves by design — so the rule
 * instead demands evidence that the pull DID move it (more than the recovery
 * tolerance, in at least two samples), else a keyboard that never moved would
 * "recover" vacuously.
 *
 * FAIL-CLOSED: `ok` only for >= 3 readable samples, a keyboard displaced by the
 * pull, and the LAST sample's two edges each within RECOVERY_TOLERANCE_PT of the
 * FIRST's. Unreadable/mixed PNGs, too few usable samples and a pull that never
 * moved the keyboard are `inconclusive`; a measured non-return is `fail`.
 */
export function shortpullVerdict(
	pngs: readonly Uint8Array[],
	pxPerPt = DEFAULT_PX_PER_PT,
): DragVerdict {
	const inconclusive = (reason: string): DragVerdict => ({
		status: "inconclusive",
		reason,
	});
	const read = measureSamples(pngs, pxPerPt);
	if ("reason" in read) return inconclusive(read.reason);
	const usable = read.frames.flatMap((f) => (f.edges ? [f.edges] : []));
	if (usable.length < MIN_WINDOW_SAMPLES) {
		const why = read.frames.find((f) => f.reason)?.reason;
		return inconclusive(
			`${usable.length} usable sample(s); need at least ${MIN_WINDOW_SAMPLES}${why ? ` (${why})` : ""}`,
		);
	}
	// Recovery needs the observed starting position, not a later usable frame.
	const initial = read.frames[0] as FrameMeasure;
	if (!initial.edges)
		return inconclusive(
			`the first sampled frame has no readable edges, so the run's start is unobserved${initial.reason ? ` (${initial.reason})` : ""}`,
		);
	// R3-2: the last USABLE frame is not necessarily the last SAMPLED one, and
	// "it came back" must be read from where the run ended, so a final frame
	// that cannot be read leaves the run's end unobserved.
	const final = read.frames[read.frames.length - 1] as FrameMeasure;
	if (!final.edges)
		return inconclusive(
			`the final sampled frame has no readable edges, so the run's end is unobserved${final.reason ? ` (${final.reason})` : ""}`,
		);
	const first = usable[0] as NonNullable<FrameMeasure["edges"]>;
	const last = usable[usable.length - 1] as NonNullable<FrameMeasure["edges"]>;
	const deltaKeyboard = (last.keyboardEdge - first.keyboardEdge) / pxPerPt;
	const deltaComposer = (last.composerEdge - first.composerEdge) / pxPerPt;
	const displaced = usable.filter(
		(e) =>
			Math.abs(e.keyboardEdge - first.keyboardEdge) / pxPerPt >
			RECOVERY_TOLERANCE_PT,
	).length;
	const numbers = `last − first: Δkeyboard=${deltaKeyboard.toFixed(1)} pt, Δcomposer=${deltaComposer.toFixed(1)} pt over ${usable.length} usable samples`;
	const measured = {
		deltaKeyboard,
		deltaComposer,
		segmentSamples: usable.length,
	};
	if (displaced < 2)
		return {
			...inconclusive(
				`the pull did not move the keyboard (${displaced} sample(s) displaced > ${RECOVERY_TOLERANCE_PT} pt): ${numbers}`,
			),
			...measured,
		};
	const recovered =
		Math.abs(deltaKeyboard) <= RECOVERY_TOLERANCE_PT &&
		Math.abs(deltaComposer) <= RECOVERY_TOLERANCE_PT;
	return recovered
		? {
				status: "ok",
				reason: `both edges returned to their start: ${numbers}`,
				...measured,
			}
		: {
				status: "fail",
				reason: `the keyboard and composer did not return to their start: ${numbers} (need each within ${RECOVERY_TOLERANCE_PT} pt)`,
				...measured,
			};
}

/**
 * The short-pull flow's lane verdict. Recovery is a property of the AFTER
 * build alone (main's behaviour proves nothing about it), so the after verdict
 * decides and the baseline's is reported beside it; nothing but an `ok` after
 * is ok.
 */
export function shortpullPair(
	before: DragVerdict,
	after: DragVerdict,
): DragVerdict {
	return {
		...after,
		reason: `after ${after.status}: ${after.reason} (baseline ${before.status}: ${before.reason})`,
	};
}

/**
 * Whether the software keyboard is up again with the composer's input in the
 * tree, from a `maestro hierarchy` dump taken right after the short pull. A
 * pull that dismissed the keyboard is not a short pull: the flow is then wrong
 * and says nothing about recovery, so this FAILS rather than skips. Uses the
 * same `space` key detector as `sendAboveKeyboard`.
 */
export function keyboardRestored(
	tree: HierarchyNode,
	inputId = "composer-input",
): { ok: boolean; reason: string } {
	const nodes: HierarchyNode[] = [];
	const walk = (node: HierarchyNode) => {
		nodes.push(node);
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	const input = nodes.find(
		(n) =>
			n.attributes?.["resource-id"] === inputId &&
			boxOf(n.attributes?.bounds) !== null,
	);
	if (!input) return { ok: false, reason: `no ${inputId} in the hierarchy` };
	const hasSpace = nodes.some(
		(n) =>
			SPACE_KEY.test(
				(n.attributes?.accessibilityText || n.attributes?.text || "").trim(),
			) && boxOf(n.attributes?.bounds) !== null,
	);
	return hasSpace
		? { ok: true, reason: `software keyboard up and ${inputId} visible` }
		: {
				ok: false,
				reason: "no software keyboard (no space key) after the short pull",
			};
}

/**
 * Whether Send sits above the software keyboard, from a `maestro hierarchy`
 * dump (TestFlight 753: "it pushes the composer send buttons below the bottom
 * of the keyboard"). `session-keyboard.yaml` types a long draft with the
 * keyboard up; the driver dumps the hierarchy after it and the AFTER build
 * must pass this. The BEFORE build is not held to it — showing main's defect
 * is what its frame is for.
 *
 * Maestro's iOS hierarchy is a tree of `{ attributes, children }`, with
 * `attributes["resource-id"]` (the testID) and `attributes.bounds` as
 * "[x1,y1][x2,y2]" in points. The keyboard is found by its keys, not an
 * element type the dump does not carry: the `space` key proves a SOFTWARE
 * keyboard is up (a simulator defaulting to the hardware keyboard shows none,
 * and that is a FAIL, never a pass), and the keyboard's top is the highest key
 * within one keyboard's height of it. That is the top KEY row, so a Send
 * hidden behind the predictive bar alone would pass: the check is a floor,
 * stated so a green row is not read as more.
 */
export type HierarchyNode = {
	attributes?: Record<string, string | undefined>;
	children?: HierarchyNode[];
};
/** The JSON tree out of `maestro hierarchy`'s output, which the driver
 *  captures with stderr folded in, so log lines may surround it. */
export function parseHierarchy(output: string): HierarchyNode {
	const start = output.indexOf("{");
	const end = output.lastIndexOf("}");
	assert(start >= 0 && end > start, "no JSON in the hierarchy output");
	return JSON.parse(output.slice(start, end + 1)) as HierarchyNode;
}
type Box = { top: number; bottom: number };
const BOUNDS = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;
const SPACE_KEY = /^space$/i;
const boxOf = (bounds: string | undefined): Box | null => {
	const m = bounds?.match(BOUNDS);
	return m ? { top: Number(m[2]), bottom: Number(m[4]) } : null;
};
const KEY_LABEL = /^(space|return|shift|delete|[a-z])$/i;
const LETTER_KEY = /^[a-z]$/i;
/** The tallest iOS software keyboard's key area, in pt, above the space row. */
const KEYBOARD_SPAN = 300;

export function sendAboveKeyboard(
	tree: HierarchyNode,
	sendId = "composer-send",
): { ok: boolean; reason: string; send?: Box; keyboardTop?: number } {
	const nodes: HierarchyNode[] = [];
	const parent = new Map<HierarchyNode, HierarchyNode>();
	const walk = (node: HierarchyNode) => {
		nodes.push(node);
		for (const child of node.children ?? []) {
			parent.set(child, node);
			walk(child);
		}
	};
	walk(tree);
	const subtree = (root: HierarchyNode): HierarchyNode[] => {
		const out: HierarchyNode[] = [];
		const visit = (node: HierarchyNode) => {
			out.push(node);
			for (const child of node.children ?? []) visit(child);
		};
		visit(root);
		return out;
	};
	const ancestors = (node: HierarchyNode): HierarchyNode[] => {
		const out: HierarchyNode[] = [];
		for (let at = parent.get(node); at; at = parent.get(at)) out.push(at);
		return out;
	};
	const label = (n: HierarchyNode) =>
		(n.attributes?.accessibilityText || n.attributes?.text || "").trim();
	const sendNode = nodes.find(
		(n) =>
			n.attributes?.["resource-id"] === sendId &&
			boxOf(n.attributes?.bounds) !== null,
	);
	const send = sendNode ? boxOf(sendNode.attributes?.bounds) : null;
	if (!sendNode || !send)
		return { ok: false, reason: `no ${sendId} in the hierarchy` };
	const spaceNode = nodes.find(
		(n) => SPACE_KEY.test(label(n)) && boxOf(n.attributes?.bounds) !== null,
	);
	const space = spaceNode ? boxOf(spaceNode.attributes?.bounds) : null;
	if (!spaceNode || !space)
		return {
			ok: false,
			send,
			reason: "no software keyboard (no space key) in the hierarchy",
		};
	/* ONLY THE KEYBOARD'S KEYS (PR #216 review m3). Maestro's iOS hierarchy
	 *  carries no element type (`IOSDriver.mapViewHierarchy` maps label, title,
	 *  value, identifier, frame and state only), so a key is known by its label
	 *  — and app content shares labels: an avatar initial or a one-letter chip
	 *  within the span above the space key would have set the keyboard's top
	 *  too high and FAILED a correct build. The keyboard is its own subtree in
	 *  XCUITest's tree (a separate window from the app's), so keys are read
	 *  from the HIGHEST ancestor of the space key that does not also hold Send:
	 *  the keyboard's container, never the app's. A tree where no such
	 *  container holds a letter key (everything flattened under one root) falls
	 *  back to the label band, minus nodes carrying an app testID, and says so
	 *  in its reason. */
	const sendLine = new Set([sendNode, ...ancestors(sendNode)]);
	const container = [spaceNode, ...ancestors(spaceNode)]
		.filter((n) => !sendLine.has(n))
		.at(-1);
	const inContainer = container ? subtree(container) : [];
	const scoped = inContainer.some((n) => LETTER_KEY.test(label(n)));
	const candidates = scoped
		? inContainer
		: nodes.filter((n) => !n.attributes?.["resource-id"]);
	const keyboardTop = Math.min(
		...candidates
			.filter((n) => KEY_LABEL.test(label(n)))
			.map((n) => boxOf(n.attributes?.bounds))
			.filter(
				(b): b is Box =>
					b !== null &&
					b.top >= space.top - KEYBOARD_SPAN &&
					b.top <= space.top,
			)
			.map((b) => b.top),
	);
	const ok = send.bottom <= keyboardTop;
	return {
		ok,
		send,
		keyboardTop,
		reason: `${
			ok
				? `send bottom ${send.bottom} <= keyboard top ${keyboardTop}`
				: `send bottom ${send.bottom} is below the keyboard top ${keyboardTop}`
		}${scoped ? "" : " (flat hierarchy: keys read by label band)"}`,
	};
}

// ---------------------------------------------------------------------------
// Where the finger goes: derived from the hierarchy, never a constant.
//
// WHY. With the long draft `session-keyboard.yaml` types (10 lines; the field
// caps at 8 and `composer.tsx` records a measured long-draft top of 241 pt), the
// composer card is ~260 pt tall on an 874 pt screen, so its TOP is at ~27-32 %,
// not 48 %. A swipe that starts inside the card is a pan on the Textarea, the
// transcript never sees it, and the keyboard cannot follow: an instrument that
// started there would "measure" a gesture that never happened. So every
// measured and prepare swipe starts GESTURE_CLEARANCE_PT above the composer
// card's top, read from the dump taken right after `session-keyboard.yaml`.
//
// MAESTRO CANNOT INTERPOLATE THIS. Maestro 2.11.0's `YamlSwipeDeserializer`
// parses a relative swipe's coordinates with `.toInt()` when the flow is READ,
// before any `${...}` is evaluated, so `start: "50%, ${DRAG_START_PCT}%"` throws
// a NumberFormatException; percentages must also be integers 0-100. The flows
// are therefore templates with `__NAME__` placeholders that the driver renders
// with literal integers into the run root (`renderFlow`), and a placeholder
// that is left over or missing fails the render rather than reaching Maestro.
// ---------------------------------------------------------------------------

/** Clear space between the finger's start and the composer card's top. */
export const GESTURE_CLEARANCE_PT = 40;
/** A start nearer the top than this is in the status bar / header, not the
 *  transcript: an ESTIMATE (status bar ~54-59 pt plus a header row). */
export const GESTURE_MIN_START_PT = 100;
/** The short pull's length, in percentage points of the screen height (~87 pt
 *  at 874 pt): a deliberate pull of the SCROLL VIEW that, on iOS's
 *  `keyboardDismissMode="interactive"`, moves the keyboard in proportion to the
 *  overscroll and springs back under the dismissal threshold. If it moves
 *  nothing the engagement guard reports inconclusive for that flow; the length
 *  is deliberately not stretched until it engages. */
export const SHORTPULL_LENGTH_PCT = 10;
/** The full drag ends here, near the bottom edge (a full dismissal). */
export const DRAG_END_PCT = 96;
/** The hierarchy's screen and the screenshot must have the same aspect ratio
 *  within this fraction, or the points -> percent conversion is not trusted. */
const SCREEN_ASPECT_TOLERANCE = 0.01;

export type GestureGeometry = {
	screenWidth: number;
	screenHeight: number;
	/** The topmost of `composer-shell-ring` / `composer-input`, in pt. */
	composerTop: number;
	composerSource: string;
	keyboardTop: number;
	/** Integer percentages of the screen height, as Maestro takes them. */
	dragStartPct: number;
	prepareEndPct: number;
	shortpullEndPct: number;
	/** composerTop minus the rounded start, in pt: >= GESTURE_CLEARANCE_PT. */
	marginPt: number;
};

type Rect = { left: number; top: number; right: number; bottom: number };
const rectOf = (bounds: string | undefined): Rect | null => {
	const m = bounds?.match(BOUNDS);
	return m
		? {
				left: Number(m[1]),
				top: Number(m[2]),
				right: Number(m[3]),
				bottom: Number(m[4]),
			}
		: null;
};

/**
 * The gesture start/end percentages from the `session-keyboard` hierarchy and
 * the screenshot taken beside it, or the reason they cannot be trusted.
 *
 * FAIL-CLOSED: any missing input (no screen frame, no composer bounds, no
 * keyboard, an aspect ratio that disagrees with the screenshot) or a geometry
 * with no room for a safe gesture returns `ok: false`, and the driver records
 * the run INCONCLUSIVE with that reason; a gesture is never sent from a
 * position the hierarchy did not give.
 */
export function gestureGeometry(
	tree: HierarchyNode,
	screenshot: { width: number; height: number },
): { ok: true; geometry: GestureGeometry } | { ok: false; reason: string } {
	const no = (reason: string) => ({ ok: false as const, reason });
	// The screen is the largest frame anchored at the origin among the root and
	// its descendants two levels down: the application (and the keyboard's own
	// window). Deeper nodes can extend past the screen (scrolled content).
	const framed: Rect[] = [];
	const visit = (node: HierarchyNode, depth: number) => {
		const rect = rectOf(node.attributes?.bounds);
		if (rect && rect.left === 0 && rect.top === 0) framed.push(rect);
		if (depth < 2)
			for (const child of node.children ?? []) visit(child, depth + 1);
	};
	visit(tree, 0);
	const area = (r: Rect) => (r.right - r.left) * (r.bottom - r.top);
	const frame = framed.sort((a, b) => area(b) - area(a))[0];
	if (!frame || frame.right <= 0 || frame.bottom <= 0)
		return no("the hierarchy has no screen frame anchored at [0,0]");
	const screenWidth = frame.right;
	const screenHeight = frame.bottom;
	if (!(screenshot.width > 0 && screenshot.height > 0))
		return no("the screenshot has no size");
	const aspect = screenWidth / screenHeight;
	const shotAspect = screenshot.width / screenshot.height;
	if (Math.abs(aspect - shotAspect) / shotAspect > SCREEN_ASPECT_TOLERANCE)
		return no(
			`the hierarchy's screen ${screenWidth}x${screenHeight} pt disagrees with the ${screenshot.width}x${screenshot.height} px screenshot`,
		);

	const nodes: HierarchyNode[] = [];
	const walk = (node: HierarchyNode) => {
		nodes.push(node);
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	const composer = ["composer-shell-ring", "composer-input"]
		.flatMap((id) =>
			nodes
				.filter((n) => n.attributes?.["resource-id"] === id)
				.flatMap((n) => {
					const rect = rectOf(n.attributes?.bounds);
					return rect ? [{ id, top: rect.top }] : [];
				}),
		)
		.sort((a, b) => a.top - b.top)[0];
	if (!composer)
		return no(
			"no composer-shell-ring or composer-input bounds in the hierarchy",
		);
	if (!(composer.top > 0 && composer.top < screenHeight))
		return no(
			`the composer top ${composer.top} pt is outside the ${screenHeight} pt screen`,
		);
	const keyboardTop = sendAboveKeyboard(tree).keyboardTop;
	if (keyboardTop === undefined || !Number.isFinite(keyboardTop))
		return no("the keyboard's top is not readable from the hierarchy");
	if (keyboardTop <= composer.top)
		return no(
			`the keyboard top ${keyboardTop} pt is not below the composer top ${composer.top} pt`,
		);

	const pct = (pt: number) => (100 * pt) / screenHeight;
	// Rounded DOWN so the rounding can only add clearance.
	const dragStartPct = Math.floor(pct(composer.top - GESTURE_CLEARANCE_PT));
	const startPt = (dragStartPct * screenHeight) / 100;
	const marginPt = composer.top - startPt;
	// The epsilon only absorbs float error in `pct`/`startPt`; flooring already
	// makes the margin >= the clearance, so this guards the invariant.
	if (marginPt < GESTURE_CLEARANCE_PT - 1e-6)
		return no(
			`the gesture would start ${marginPt.toFixed(1)} pt above the composer top ${composer.top} pt; need ${GESTURE_CLEARANCE_PT} pt`,
		);
	if (startPt < GESTURE_MIN_START_PT)
		return no(
			`no transcript room above the composer: the start ${startPt.toFixed(0)} pt is under ${GESTURE_MIN_START_PT} pt (composer top ${composer.top} pt)`,
		);
	// Prepare swipes stop above the keyboard so a dismissal cannot stand in for
	// the measured gesture.
	const prepareEndPct = Math.floor(pct(keyboardTop - GESTURE_CLEARANCE_PT));
	if (prepareEndPct <= dragStartPct)
		return no(
			`no room to scroll between the start (${dragStartPct} %) and the keyboard (${prepareEndPct} %)`,
		);
	const shortpullEndPct = dragStartPct + SHORTPULL_LENGTH_PCT;
	if (shortpullEndPct >= prepareEndPct)
		return no(
			`the short pull's end (${shortpullEndPct} %) would reach the prepare limit above the keyboard (${prepareEndPct} %)`,
		);
	return {
		ok: true,
		geometry: {
			screenWidth,
			screenHeight,
			composerTop: composer.top,
			composerSource: composer.id,
			keyboardTop,
			dragStartPct,
			prepareEndPct,
			shortpullEndPct,
			marginPt,
		},
	};
}

/** A PNG's pixel size from its IHDR (width, height: big-endian u32 at bytes
 *  16 and 20); throws on anything that is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
	assert(
		bytes.length >= 24 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47 &&
			bytes[12] === 0x49 &&
			bytes[13] === 0x48 &&
			bytes[14] === 0x44 &&
			bytes[15] === 0x52,
		"not a PNG: no IHDR at byte 12",
	);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The placeholders each flow template carries, with their values. The render
 *  asserts every one is present, so a template that stops using one (or a new
 *  one nobody supplies) fails loudly. */
export function gestureFlowValues(
	file: string,
	g: GestureGeometry,
): Record<string, number> {
	switch (file) {
		case KEYBOARD_READY_FLOW:
			return {
				DRAG_START_PCT: g.dragStartPct,
				PREPARE_END_PCT: g.prepareEndPct,
			};
		case "session-keyboard-shortpull.yaml":
			return {
				DRAG_START_PCT: g.dragStartPct,
				SHORTPULL_END_PCT: g.shortpullEndPct,
			};
		case "session-keyboard-drag.yaml":
			return { DRAG_START_PCT: g.dragStartPct };
		default:
			throw new Error(`no gesture placeholders defined for ${file}`);
	}
}

/** `template` with each `__NAME__` replaced by its integer percentage. */
export function renderFlow(
	template: string,
	values: Record<string, number>,
): string {
	let out = template;
	for (const [name, value] of Object.entries(values)) {
		assert(
			Number.isInteger(value) && value >= 0 && value <= 100,
			`${name}=${value} is not an integer percentage 0-100`,
		);
		const token = `__${name}__`;
		assert(out.includes(token), `the flow template has no ${token}`);
		out = out.replaceAll(token, String(value));
	}
	const left = out.match(/__[A-Z][A-Z0-9_]*__/g);
	assert(!left, `unrendered placeholder(s): ${left?.join(", ")}`);
	return out;
}
