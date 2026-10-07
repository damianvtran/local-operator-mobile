/**
 * The audit checker: run the mechanical half of the design/UX rubric over a
 * captured state matrix, and write a report a review round can answer.
 *
 * It consumes a manifest from `tools/visual/capture.ts`, re-drives the *same*
 * URLs in installed headless Chrome (so the check is over the real render, not
 * over a saved PNG), extracts geometry and the accessibility tree over CDP, and
 * emits one row per check × cell with the measured number and the frame it came
 * from.
 *
 *   node tools/audit/audit.ts --manifest <frames>/manifest.json [--out <dir>]
 *
 * EXIT CODES, because a CI step reads the number and not the prose:
 *
 *   0  every check PASSed (or the only non-PASS rows are EXCEPTIONs the rubric
 *      grants explicitly, e.g. a 24 pt control in a dense list)
 *   1  at least one FAIL
 *   2  the run itself was refused (no manifest, no records, bad arguments)
 *   3  no FAIL, but at least one BLOCKED — the audit could not tell
 *
 * 3 is deliberately not 0. "We could not tell" is what a build whose text does
 * not scale produces, and reading it as a pass is the defect the review round
 * found: the scaffold genuinely could not scale text to 200% and the run exited
 * 0. `--allow-blocked` restores 0 for local exploration and is never used in CI.
 *
 * A run that measured NOTHING is separated from all of the above, because it was
 * the one outcome the report could not express: every row BLOCKED printed as
 * `0 FAIL, 160 BLOCKED`, and `0 FAIL` reads as a clean build in a PR comment
 * while no check was ever evaluated. It gets its own verdict
 * (`NO-MEASUREMENT`), an explicit `measured` count in the summary, a stderr
 * block naming the capture's own reasons, and exit 3 even under
 * `--allow-blocked` — a gate that measured nothing did not have "a check that
 * could not measure"; it had no reading at all.
 *
 * A RE-DRIVE THAT DOES NOT REACH THE STATE ITS RECORD NAMES is not measured
 * either, and it is its own outcome (`state-not-reproduced`) for the same reason:
 * the rows would otherwise be readings about a screen the cell does not name.
 * This tool rebuilds every cell's URL from the manifest, so it renders whatever
 * THAT URL shows — and the seed the capture put on every page is part of that URL.
 * A relay-backed cell whose app was never pointed at a relay falls back to its own
 * default screen, and the checks that pass there were counted as the cell's. The
 * re-drive is therefore held to the capture's own readiness rule (the route the
 * record rendered, its screen root and its state marker — not its content: the rule's
 * bound, including the eight cells it is known to miss, is stated on `reDriveMismatch`),
 * and a mismatch BLOCKS the
 * cell and exits 3 like any other gap — see `lib/readiness.ts` `reDriveMismatch`.
 *
 * COVERAGE, stated rather than implied: this tool machine-checks the rubric's
 * mechanical half — U-01…U-10 and U-38…U-42 — and nothing else. U-11…U-17 are machine-defined
 * in the rubric and NOT implemented here; §4-§7 are manual by the rubric's own
 * text; §9's R1-R6 assertions are not implemented. See `COVERAGE` below, which
 * is printed in the report so a reader never has to infer it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type Affordance,
	type AffordanceOutcome,
	describeAffordance,
	narrowAffordances,
	outcomeFailed,
	runAffordances,
	waitForTestID,
} from "../lib/affordance.ts";
import { bool, csv, num, parseArgs, str } from "../lib/args.ts";
import type { CdpPage } from "../lib/cdp.ts";
import { sleep } from "../lib/cdp.ts";
import { launchChrome } from "../lib/chrome.ts";
import { applySafeAreaInsets, freshPage, withDeadline } from "../lib/page.ts";
import {
	captureHookQuery,
	cellHookQuery,
	reDriveIssues,
	reDriveMismatch,
	STATE_POLL_MS,
	STATE_WAIT_MS,
	seedQuery,
	stateStillComing,
} from "../lib/readiness.ts";
import { releaseScenarioClaim, selectScenario } from "../lib/relay.ts";
import { serveDir } from "../lib/static-server.ts";
import {
	PRE_PAINT_PROBE,
	READINESS_PROBE,
	SCREEN_ROOTS,
} from "../visual/matrix.ts";
import type { AuditState, CheckRow } from "./checks.ts";
import { runChecks, SUB_RULE_TEXT } from "./checks.ts";
import { floorsFromTokens } from "./color.ts";
import { EXTRACT_PROBE, flattenAxTree } from "./probe.ts";

/**
 * The checks the runner implements, in rubric order.
 *
 * This is the *machine-checked* half and nothing more. The rubric's §3 table runs
 * to U-17; stating that here, and in every report, is what stops a green run
 * from being read as coverage of a rubric this tool does not implement.
 */
export const ALL_CHECKS = [
	"U-01",
	"U-02",
	"U-03",
	"U-04",
	"U-05",
	"U-06",
	"U-07",
	"U-08",
	"U-09",
	"U-10",
	/* The S5 redesign's five (design pass `fix/hero-tables-strips` §1.8/§4.2):
	 * table rendering, the token cap, the scroll cue, the strip's rail/caret, and
	 * spacing against the token scale. They are numbered 38-42 because the
	 * rubric's own numbering places them after the §3 sequence they extend. */
	"U-38",
	"U-39",
	"U-40",
	"U-41",
	"U-42",
];

/** The rubric ids this tool does NOT machine-check, and who owns them. */
export const COVERAGE = {
	machineChecked: ALL_CHECKS,
	/** §3 ids the rubric defines as machine checks and this tool does not implement. */
	unimplemented: ["U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17"],
	/** §4-§7: manual by the rubric's own text. */
	manualOnly: ["§4 copy", "§5 flow", "§6 per-screen", "§7 scoring"],
	/** §9's R1-R6 assertions over the markdown/JSON pair. */
	uncheckedAssertions: ["R1", "R2", "R3", "R4", "R5", "R6"],
} as const;

/**
 * The semantic colours a state-only colour usage is measured against. Read from
 * the tokens so a palette change moves the check with it; the fallback set is
 * the palette this app shipped at the time of writing.
 */
/** The semantic palette a state-only colour usage is measured against. */
export interface SemanticPalette {
	/**
	 * Each role PER THEME, because a status colour is not the same hex in the two
	 * themes and a palette carrying only one of them cannot fire in the other.
	 *
	 * Measured, and it is the reason this shape changed: the dot's computed colour in a
	 * dark cell is the DARK hex, which matched nothing while only `.light` was read — so
	 * U-03 reported PASS in dark cells on a page whose status was carried by colour
	 * alone. A check that cannot fail in one of the two shipped themes is not a check.
	 */
	dangerLight: string | null;
	dangerDark: string | null;
	warningLight: string | null;
	warningDark: string | null;
	successLight: string | null;
	successDark: string | null;
	infoLight: string | null;
	infoDark: string | null;
	/** The accent is theme-dependent in the design kit, so both values are measured. */
	accentLight: string | null;
	accentDark: string | null;
}

/** Where a palette came from, and whether any of it loaded at all. */
export interface PaletteProvenance {
	path: string | null;
	loaded: boolean;
	/** Why it is missing, when it is: the sentence the report carries. */
	reason: string | null;
	/** How many semantic keys resolved to a colour. */
	entries: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** The readiness reading a re-driven page reports, narrowed at the CDP boundary. */
interface ReDrivenReading {
	path: string;
	testIds: string[];
	visibleTestIds: string[];
}

function asReading(value: unknown): ReDrivenReading {
	const bag = asRecord(value) ?? {};
	const ids = (key: string): string[] =>
		Array.isArray(bag[key])
			? (bag[key] as unknown[]).filter(
					(id): id is string => typeof id === "string",
				)
			: [];
	return {
		path: typeof bag.path === "string" ? bag.path : "",
		testIds: ids("testIds"),
		visibleTestIds: ids("visibleTestIds"),
	};
}

/**
 * `meta.seed`, as the capture writes it. `null` when the manifest carries none, which
 * includes every manifest written before the field existed — and that is deliberately
 * NOT the same as "not seeded": the re-drive comparison below is what decides whether
 * an unseeded re-drive reached the recorded state, so a manifest from before this
 * record produces mismatches rather than a silently unseeded green.
 */
function asSeed(value: unknown): SeedRecord | null {
	const bag = asRecord(value);
	if (bag === undefined) return null;
	return {
		// Anything but an explicit `true` is "no seed was applied": the safe direction,
		// because it makes the re-drive's disagreement with the record visible.
		applied: bag.applied === true,
		password: typeof bag.password === "string" ? bag.password : null,
		route: typeof bag.route === "string" ? bag.route : null,
		origin: typeof bag.origin === "string" ? bag.origin : null,
	};
}

/** The cell key the manifest's own tables are keyed by (`screen/state`). */
function recordCell(record: AuditRecord): string {
	return record.cell ?? `${record.screen}/${record.state}`;
}

/**
 * What to print when a declared-skip entry carries no owner.
 *
 * NOT "no owner named": the sentence has to say where the gap is, and it is in the
 * MANIFEST entry — the capture refuses to declare a skip without an owner
 * (`lib/readiness.ts` `declaredSkipFor`), so a reader meeting this is looking at a
 * hand-written or stale manifest, not at a cell nobody owns. (The lookup that finds
 * the entry compared its `screen/state` key to the record's frame STEM, so every
 * lookup missed and every declared skip printed this fallback while the manifest named
 * an owner for all of them.)
 */
const DECLARED_SKIP_NO_OWNER =
	"the manifest's declaredSkips entry for this cell names no owner";

/**
 * Whether the record's own capture run judged this cell to be in the state it names.
 *
 * UNKNOWN COUNTS AS READINESS CLAIMED, and that is the point: a manifest written
 * before `ready` existed must not become a licence to measure a re-driven fallback
 * screen. A record the capture genuinely failed on carries `ready: false` and its
 * sentences, and is already BLOCKED by name through `unreadyCells`, so the two
 * outcomes can never double-count one cell.
 */
function recordClaimedReadiness(record: AuditRecord): boolean {
	if (record.ready === false) return false;
	return (record.readinessProblems ?? []).length === 0;
}

/**
 * Put the mock relay back into the scenario this cell's state comes from.
 *
 * The relay holds ONE scenario at a time, and a cell's state is a fact about that pin
 * as much as about its URL: without this the re-drive renders whatever the PREVIOUS
 * cell left the relay in, which is a state this cell does not name. The capture pins
 * each cell before rendering it (`tools/visual/capture.ts`) and records the name it
 * pinned; this replays exactly that, through the same `selectScenario`.
 *
 * A cell no scenario declares (an ad-hoc `path:` page, or a manifest written before
 * the name was recorded) pins nothing, and the invariant below decides what the page
 * it renders is worth.
 */
async function pinCellScenario(
	record: AuditRecord,
	relay: string | null,
	timeoutMs: number,
): Promise<void> {
	const scenario = record.pinnedScenario;
	if (relay === null || typeof scenario !== "string" || scenario === "") return;
	const pinned = await withDeadline(
		selectScenario(relay, scenario),
		timeoutMs,
		`pinning ${scenario} for ${record.name ?? record.screen}`,
	);
	if (!pinned.ok) {
		throw new Error(
			`${pinned.reason}: the cell cannot be re-driven in the state it declares`,
		);
	}
}

/**
 * Read the semantic palette out of the design tokens.
 *
 * A palette that did not load yields an EMPTY set, and an empty set makes a
 * colour check unable to find a suspect — it reports PASS on a page that uses
 * colour alone to carry state. That is why the caller gets provenance too: "no
 * palette" must fail the check rather than pass it. Measured before this rule:
 * the canary's own defect page reported `U-03 PASS` on all 16 cells with no
 * tokens loaded.
 */
export function semanticFromTokens(tokens: unknown): SemanticPalette {
	const out: SemanticPalette = {
		dangerLight: null,
		dangerDark: null,
		warningLight: null,
		warningDark: null,
		successLight: null,
		successDark: null,
		infoLight: null,
		infoDark: null,
		accentLight: null,
		accentDark: null,
	};
	const root = asRecord(tokens);
	if (root === undefined) return out;
	const color = asRecord(root.color);
	if (color === undefined) return out;
	const semantic = asRecord(color.semantic);
	/** A role's two theme values, whichever shape the tokens carry it in. */
	const pair = (
		value: unknown,
	): { light: string | null; dark: string | null } => {
		// A flat string is one colour for both themes, so it lands in both halves: a
		// palette with no theme split must stay usable in either theme.
		if (typeof value === "string") return { light: value, dark: value };
		const bag = asRecord(value);
		return {
			light: typeof bag?.light === "string" ? bag.light : null,
			dark: typeof bag?.dark === "string" ? bag.dark : null,
		};
	};
	const danger = pair(semantic?.danger);
	out.dangerLight = danger.light;
	out.dangerDark = danger.dark;
	const warning = pair(semantic?.warning);
	out.warningLight = warning.light;
	out.warningDark = warning.dark;
	const success = pair(semantic?.success);
	out.successLight = success.light;
	out.successDark = success.dark;
	const info = pair(semantic?.info);
	out.infoLight = info.light;
	out.infoDark = info.dark;
	const accent = pair(asRecord(color.accent)?.accent);
	out.accentLight = accent.light;
	out.accentDark = accent.dark;
	return out;
}

/** The provenance of a palette: what loaded, from where, and why not. */
export function paletteProvenance(
	tokensPath: string | null,
	palette: SemanticPalette,
): PaletteProvenance {
	const entries = Object.values(palette).filter(
		(value) => typeof value === "string",
	).length;
	if (tokensPath === null) {
		return {
			path: null,
			loaded: false,
			reason: "no --tokens path and no repoRoot in the manifest",
			entries,
		};
	}
	if (!existsSync(tokensPath)) {
		return {
			path: tokensPath,
			loaded: false,
			reason: `${tokensPath} does not exist`,
			entries,
		};
	}
	if (entries === 0) {
		return {
			path: tokensPath,
			loaded: false,
			reason: `${tokensPath} carries no semantic colours`,
			entries,
		};
	}
	return { path: tokensPath, loaded: true, reason: null, entries };
}

/*
 * WHAT A RE-DRIVE MUST REPRODUCE, and the two facts it needs from the manifest.
 *
 * `path`/`theme`/`scale`/`insets` are the cell's own dimensions. The SEED is the
 * run's, and it is here because a relay-backed cell is only in the state it names
 * while the app is pointed at a relay: without it the app falls back to its own
 * default screen and every check that "passes" there is a reading about a screen
 * the cell does not name. It is read from `meta.seed` — the capture's record of
 * what it applied — never from an argument the caller must remember: the whole
 * defect was a re-drive that silently dropped a parameter the capture had set, and
 * a fix that depends on every future caller passing a flag is the same defect.
 */

/** One captured cell, as the audit reads it out of the manifest. */
interface AuditRecord {
	/** Whether the capture run judged this frame's text-scale pair live. */
	scaleLive?: boolean | null;

	/** The frame stem, used in progress and failure lines. */
	name?: string;
	/** The `screen/state` pair the manifest records for this cell, e.g. `S4/loading`. */
	cell?: string;
	screen: string;
	screenLabel?: string;
	state: string;
	device: string;
	theme: string;
	scale: string;
	path: string;
	viewport: { width: number; height: number; dpr: number };
	insets?: { top: number; bottom: number; left: number; right: number };
	frames?: Array<{ file: string }>;
	/**
	 * Whether the capture run judged this cell to have reached its declared state,
	 * and the sentences it failed on. A cell the capture could not reach is already
	 * BLOCKED by name (`unreadyCells`); the re-drive comparison below is what catches
	 * the opposite — a record the capture reached and the re-drive no longer does.
	 */
	ready?: boolean;
	readinessProblems?: string[];
	/*
	 * The manifest also carries `readiness` here — the capture's own `READINESS_PROBE`
	 * reading (the route it rendered and the ids it carried) — and the re-drive is NOT
	 * compared against it. It is compared against the RULE, given the record's route:
	 * the same rule the capture used to call the cell ready (`lib/readiness.ts`
	 * `reDriveMismatch`, which states its bound). Comparing the two id SETS was the
	 * other option and was rejected on measurement: two captures of the same tier
	 * already disagree on 4 streaming cells (a transcript row that had arrived by the
	 * second run), so set equality would BLOCK real cells the capture measured — and a
	 * rule that blocks a real cell costs more than one that misses the eight `S5/empty`
	 * cells, which are the known residue and are named where the rule is documented.
	 */
	/**
	 * The page actions the CAPTURE applied to reach this cell's state, replayed by the
	 * re-drive rather than re-derived from `CELL_OPENERS` — the rule `meta.seed` already
	 * follows: a re-drive that re-read the table would be measuring whatever the table
	 * says at re-drive time rather than what the frame was taken of.
	 *
	 * Read as `unknown` and narrowed by `narrowAffordances` (`lib/affordance.ts`), because the manifest is
	 * JSON. Absent (a manifest written before the hook existed) means "no actions", which
	 * is the safe direction: the re-drive renders the PRE-state, its state marker is
	 * missing, and the comparison reports the mismatch instead of a quiet green.
	 */
	openers?: unknown;
	/**
	 * The relay scenario the capture pinned before rendering this cell, or absent/null
	 * for a cell no scenario declares. The re-drive pins the same one: the relay holds a
	 * single scenario, so without this the page is whatever the previous cell left.
	 */
	pinnedScenario?: string | null;
}

/** The capture's record of the web-only seed hook, as `meta.seed` carries it. */
interface SeedRecord {
	/** False when the capture did not seed at all (`--no-seed`, or no `--relay`). */
	applied: boolean;
	password: string | null;
	route: string | null;
	/** The origin the capture served the build from, to tell a run-local route apart. */
	origin: string | null;
}

/**
 * The seed to re-drive with: the route the app is pointed at and the password it
 * authenticates with. `null` means "re-drive the cell unseeded", which is correct for a
 * capture that used none and a NAMED mismatch for one that did (see `reDriveMismatch`).
 */
type ResolvedSeed = { route: string | null; password: string | null } | null;

/**
 * The seed this run re-drives with, or `null` when the capture used none.
 *
 * The capture's DEFAULT seed route is the origin IT served the build from, and this
 * run serves the same build on its own port — so a recorded route that is that
 * origin must be re-derived here rather than reused, or every re-driven fetch would
 * go to a server that no longer exists. An explicit `--seed-route` names some other
 * origin and is kept verbatim.
 */
function seedFor(seed: SeedRecord | null, origin: string): ResolvedSeed {
	if (seed === null || !seed.applied || seed.route === null) return null;
	return {
		route: seed.route === seed.origin ? origin : seed.route,
		password: seed.password,
	};
}

/** The query string the capture used, so the audit renders the same cell. */
/**
 * The URL a cell is driven at: the page path (which may carry the cell's OWN
 * query — `lo-dictation`, `lo-draft`) joined with the audit's parameters.
 *
 * The separator comes FROM the path rather than being assumed. A naive `?` on a
 * path that already had a query produced `…&lo-dictation=recording?lo-theme=dark`:
 * the cell's last parameter swallowed the whole audit block as its value,
 * `lo-dictation` never applied, and the audit measured the ORDINARY composer while
 * reporting the cell's name (design round 1, D4 — the report's own rows showed the
 * malformed URL, and this PR's query-bearing cells were the first to hit it).
 * Exported so a test can pin the join.
 */
export function cellUrl(origin: string, path: string, query: string): string {
	return `${origin}${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/**
 * The audit's own parameters: theme, text scale, the safe-area insets, the capture
 * seed and the web-only hooks. These go AFTER whatever query the cell's path
 * already carries — see `cellUrl`.
 */
function cellQuery(record: AuditRecord, seed: ResolvedSeed): string {
	const query = new URLSearchParams({
		"lo-theme": record.theme,
		"lo-text-scale": String(
			record.scale === "100" ? 1 : record.scale === "150" ? 1.5 : 2,
		),
	});
	const insetsBeforeOverride = record.insets ?? {
		top: 0,
		bottom: 0,
		left: 0,
		right: 0,
	};
	for (const side of ["top", "bottom", "left", "right"] as const) {
		const value = insetsBeforeOverride[side];
		if (value !== undefined) query.set(`lo-inset-${side}`, String(value));
	}
	// The capture's half of the web-only seed hook (docs/e2e/README.md, option 3),
	// replayed through the SHARED `seedQuery` rather than respelled here: these are
	// the app's own parameter names, and a second spelling is how the two drift.
	if (seed !== null) {
		for (const [key, value] of new URLSearchParams(
			seedQuery(seed.route, seed.password),
		)) {
			query.set(key, value);
		}
	}
	// The web-only hooks every harness page carries (`lo-recorder`): the audit
	// re-renders the SAME page the capture did, so a cell whose markers depend on
	// one of these would otherwise pass in the capture and fail here.
	for (const [key, value] of new URLSearchParams(captureHookQuery())) {
		query.set(key, value);
	}
	// The per-cell viewer hooks, through the same builder the capture merges — the
	// audit must re-drive the exact page the frame came from (`S5/tables-end`'s
	// scrolled table is the reason this exists).
	for (const [key, value] of new URLSearchParams(
		cellHookQuery(record.cell ?? ""),
	)) {
		query.set(key, value);
	}
	return query.toString();
}

async function auditCell(
	page: CdpPage,
	record: AuditRecord,
	{
		origin,
		settleMs,
		seed,
		relay,
		cellTimeoutMs,
	}: {
		origin: string;
		settleMs: number;
		seed: ResolvedSeed;
		/** The mock relay to pin, or null when the manifest recorded none. */
		relay: string | null;
		/** The cell's own bound, for the relay pin inside it. */
		cellTimeoutMs: number;
	},
) {
	const device = record.viewport;
	await page.send("Emulation.setDeviceMetricsOverride", {
		width: device.width,
		height: device.height,
		deviceScaleFactor: device.dpr,
		mobile: true,
	});
	await page.send("Emulation.setEmulatedMedia", {
		features: [
			{ name: "prefers-color-scheme", value: record.theme },
			{ name: "prefers-reduced-motion", value: "no-preference" },
		],
	});
	// The real insets, so the app's own env() resolves them (see
	// tools/visual/capture.ts § applySafeAreaInsets).
	const insetsOverride = await applySafeAreaInsets(page, {
		insets: {
			top: record.insets?.top ?? 0,
			bottom: record.insets?.bottom ?? 0,
			left: record.insets?.left ?? 0,
			right: record.insets?.right ?? 0,
		},
	});
	/* Without the override the page reports 0 insets, so the check says the state
	 *  could not answer rather than passing it — and the helper carries the REASON,
	 *  because "the app declares no unsafe edges" and "CDP refused the override" are
	 *  different findings that read the same. It is the same call the capture makes
	 *  (`tools/lib/page.ts`), so the two cannot drift into measuring different pages. */
	await page.send("Page.addScriptToEvaluateOnNewDocument", {
		source: PRE_PAINT_PROBE,
	});
	await pinCellScenario(record, relay, cellTimeoutMs);
	const url = cellUrl(origin, record.path, cellQuery(record, seed));
	await page.send("Page.navigate", { url });
	await sleep(settleMs);
	/*
	 * REPLAY WHAT THE CAPTURE APPLIED to reach this cell's state, before the readiness
	 * wait below.
	 *
	 * The list comes from the manifest (`record.openers`), not from `CELL_OPENERS`: a
	 * re-drive that re-read the table would be measuring whatever the table says at
	 * re-drive time rather than what the frame was taken of — the same reasoning
	 * `meta.seed` records for the seed. A cell whose control is gone therefore shows up
	 * as the state marker it never opened, which the comparison against the record
	 * reports by name rather than as a silent green.
	 */
	const openers = narrowAffordances(record.openers);
	/*
	 * WAIT FOR THE SCREEN ROOT FIRST, as the capture does, before replaying.
	 *
	 * The capture added this wait after thirteen create-family cells took past
	 * eight seconds to render under fleet load; the re-drive had it not, and ran the
	 * actions after `settleMs` with only the per-action bound — so the same cell
	 * could open in the capture and not here. Both sides now ask the app the same
	 * question (`SCREEN_ROOTS`) before they press anything.
	 */
	let openerOutcomes: AffordanceOutcome[] = [];
	if (openers.length > 0) {
		const ready = await waitForTestID(page, SCREEN_ROOTS[record.screen] ?? "");
		openerOutcomes = ready
			? await runAffordances(page, openers)
			: [{ action: openers[0] as Affordance, result: "missing" }];
	}
	/*
	 * WAIT FOR THE EVENT, NOT THE CLOCK — the same rule the capture applies, and for the
	 * same measured reason (`lib/readiness.ts` `STATE_WAIT_MS`): a declared state can
	 * settle AFTER the settle window, and a re-drive judged at the window would block a
	 * cell whose state simply arrived late. Measured here: `S4/empty` re-driven at the
	 * default 1200 ms still showed the populated list, and reproduced at `--settle 4000`.
	 *
	 * Only a cell the capture called READY is waited on: a declared skip or an unready cell
	 * is BLOCKED on its own account, and polling for a state nothing claims would add the
	 * whole bound to every one of them.
	 */
	const reDriveFacts = (reading: ReDrivenReading) => ({
		screen: record.screen,
		state: record.state,
		askedPath: record.path,
		root: SCREEN_ROOTS[record.screen],
		reading,
	});
	let reading = asReading(await page.evaluate(READINESS_PROBE));
	let waitedMs = 0;
	while (
		recordClaimedReadiness(record) &&
		waitedMs < STATE_WAIT_MS &&
		stateStillComing(reDriveIssues(reDriveFacts(reading)))
	) {
		await sleep(Math.min(STATE_POLL_MS, STATE_WAIT_MS - waitedMs));
		waitedMs += STATE_POLL_MS;
		reading = asReading(await page.evaluate(READINESS_PROBE));
	}
	// The probe runs in the page, so its reply arrives as `unknown`; the audit
	// re-drives the same URL the capture used and reads the same fields, so this
	// is the boundary where the probe's contract is asserted once (below) rather
	// than at every check.
	const probeReply = asRecord(await page.evaluate(EXTRACT_PROBE));
	if (probeReply === undefined) {
		throw new Error(
			`the extraction probe returned no object for ${record.screen}/${record.state}`,
		);
	}
	// The probe's reply is the CDP boundary, so its shape is asserted once here:
	// the cast is justified because the fields it claims are the ones the probe
	// above this file emits, and every check downstream reads them by name.
	const geometry = probeReply as unknown as AuditState;
	const axTree = await page.send("Accessibility.getFullAXTree");
	const ax = flattenAxTree(Array.isArray(axTree.nodes) ? axTree.nodes : []);
	return {
		...geometry,
		ax,
		/* The action outcomes, THREADED OUT rather than discarded: the audit's verdict
		 *  reads them (a non-`ok` replay is a gap of its own — review round 1, R6),
		 *  and they are computed in this function's scope. */
		openerOutcomes,
		platform: record.device?.startsWith("android") ? "android" : "ios",
		screen: record.screen,
		state: record.state,
		device: record.device,
		theme: record.theme,
		scale: record.scale,
		frame:
			record.frames?.find((f) => !/-f0\.png$|-f250\.png$/.test(f.file))?.file ??
			record.frames?.[0]?.file ??
			null,
		requestedUrl: url,
		insetsOverride,
		reading,
	};
}

export interface AuditOptions {
	manifest: string;
	out: string | undefined;
	checks: string[];
	tokens: string | undefined;
	settleMs: number;
	/** Hard bound per cell; a cell that exceeds it is a BLOCKED row, not a hang. */
	cellTimeoutMs: number;
	/** Rules to silence, as `U-05-top` or `U-04`. A mutation self-test hook. */
	blind: string[];
	quiet: boolean;
	/** A Chrome profile directory to use; the default is a fresh temporary one. */
	profile?: string | undefined;
}

/** Refused-audit: the exit code 2 path, thrown so the CLI and the API agree. */
export class AuditRefused extends Error {}

export async function runAudit(options: AuditOptions) {
	/**
	 * Every row as produced, before any blinding, so the specs can be judged once
	 * the whole run is done.
	 *
	 * The first version asked per cell whether the CELL had produced a row for the
	 * rule, so a cell whose insets made the rule not-applicable marked the spec
	 * unmatched and the run exited 2 on a blind that had in fact blinded eight rows.
	 * Whether a rule exists is a property of the run, not of one cell.
	 */
	const unblinded: Array<{ check: string; measured?: string | null }> = [];
	const manifestPath = options.manifest;
	const rawManifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
	const manifest = asRecord(rawManifest);
	if (manifest === undefined)
		throw new AuditRefused(`${manifestPath} is not a manifest object`);
	const meta = asRecord(manifest.meta) ?? {};
	const outDir = options.out ?? resolve(manifestPath, "..");
	const tokensPath =
		options.tokens ??
		(typeof meta.repoRoot === "string"
			? resolve(meta.repoRoot, "design/tokens/tokens.json")
			: null);
	const tokens: unknown =
		tokensPath !== null && existsSync(tokensPath)
			? JSON.parse(readFileSync(tokensPath, "utf8"))
			: null;
	const floors = floorsFromTokens(tokens);
	const semantic = semanticFromTokens(tokens);
	const palette = paletteProvenance(tokensPath, semantic);
	const checks = options.checks.length ? options.checks : ALL_CHECKS;

	const allRecords = Array.isArray(manifest.records) ? manifest.records : [];
	// An audit of nothing is not a pass. A capture that produced no frames — a
	// filter that matched nothing, a crashed run, a manifest written before the
	// loop — must be refused here, because `0 cells, 0 rows, 0 FAIL` reads as a
	// clean build in a PR comment and in CI.
	if (allRecords.length === 0) {
		throw new AuditRefused(
			`${manifestPath} lists no records: there is nothing to audit, which is not a pass`,
		);
	}
	const records = allRecords
		.map((entry) => asRecord(entry))
		.filter(
			(entry): entry is Record<string, unknown> =>
				entry !== undefined && typeof entry.path === "string",
		) as unknown as AuditRecord[];
	if (records.length === 0) {
		throw new AuditRefused(
			`${manifestPath} has ${allRecords.length} records and none with a path: nothing to audit`,
		);
	}
	if (typeof meta.buildDir !== "string")
		throw new AuditRefused(
			`${manifestPath} has no meta.buildDir: cannot serve the build`,
		);
	/** The mock relay, as the manifest recorded it: served through the proxy and pinned per cell. */
	const relay = typeof meta.relay === "string" ? meta.relay : null;
	const server = await serveDir(meta.buildDir, {
		proxy: relay ?? undefined,
	});
	/*
	 * THE SEED THE CAPTURE APPLIED, read from the manifest's own record of it and
	 * resolved against THIS run's origin.
	 *
	 * Read rather than passed, and that is the fix rather than a convenience: the audit
	 * re-drives cells a capture produced, so the parameters belong to the RECORD. A flag
	 * would put the burden on every future caller to remember it — which is exactly how
	 * the defect arrived. The capture seeded, the audit did not, and a run of relay-backed
	 * cells measured the app's own fallback screen under the cells' names.
	 */
	const seedRecord = asSeed(meta.seed);
	const seed = seedFor(seedRecord, server.url);
	if (!options.quiet) {
		console.log(
			seed === null
				? "audit: the manifest records no relay seed — re-driving the cells as captured"
				: `audit: re-driving with the relay seed at ${seed.route}`,
		);
	}
	const chrome = await launchChrome({ profile: options.profile });

	const rows = [];
	let index = 0;
	try {
		/*
		 * EVERY CELL GETS ITS OWN TARGET, the same shape the capture uses and for the same
		 * measured reason (`lib/page.ts` `freshPage`): the seeded re-drive holds a live relay
		 * stream on the session screens, the streams accumulate across cells, and past a point
		 * the next `Page.navigate` never commits. Reusing one target put the audit exactly
		 * there — `CDP Page.navigate did not answer within 30000 ms`, an unhandled rejection
		 * out of the cell loop, and no report written at all.
		 */
		let page: CdpPage | null = null;
		for (const record of records) {
			index += 1;
			const fresh = await freshPage(chrome, page, options.cellTimeoutMs);
			if (!fresh.ok) {
				// A browser that has stopped answering cannot audit anything else. The run says so
				// — one BLOCKED row per cell it did not reach — instead of dying with a stack
				// trace and no report.
				console.error(
					`  ${fresh.reason} — the ${records.length - index + 1} cell(s) left are BLOCKED`,
				);
				for (const rest of records.slice(index - 1)) {
					rows.push({
						check: "RUN",
						verdict: "BLOCKED",
						blockedKind: "unmeasurable",
						measured: null,
						detail: fresh.reason,
						screen: rest.screen,
						state: rest.state,
						device: rest.device,
						theme: rest.theme,
						scale: rest.scale,
					});
				}
				break;
			}
			page = fresh.page;
			// `freshPage` arms every page with the two enables and the pre-paint probe; the audit
			// additionally reads the accessibility tree, so its own enable rides along here.
			await page.send("Accessibility.enable");
			// Per-cell bound, for the same reason the capture has one: the audit
			// re-drives every cell in a browser, and a page that never settles would
			// otherwise park the whole job. A cell that expires is reported as a
			// BLOCKED row naming the bound, never as a silent skip.
			const attempted = await withDeadline(
				auditCell(page, record, {
					origin: server.url,
					settleMs: options.settleMs,
					seed,
					relay,
					cellTimeoutMs: options.cellTimeoutMs,
				}),
				options.cellTimeoutMs,
				`cell ${record.screen}/${record.state} on ${record.device}`,
			);
			if (!attempted.ok) {
				rows.push({
					check: "RUN",
					verdict: "BLOCKED",
					blockedKind: "unmeasurable",
					measured: null,
					detail: attempted.reason,
					screen: record.screen,
					state: record.state,
					device: record.device,
					theme: record.theme,
					scale: record.scale,
				});
				console.error(`  ${String(record.name)}: ${attempted.reason}`);
				continue;
			}
			const state = attempted.value;
			/*
			 * DID THE RE-DRIVE REACH THE STATE THE RECORD NAMES?
			 *
			 * This is the invariant the whole re-drive needed and never had: the audit
			 * renders a page and then reports what its checks measured THERE, so a page that
			 * is not the cell (an unseeded app on its own welcome screen) contributed rows
			 * under the cell's name. The capture already has the vocabulary — it refuses to
			 * call a cell ready when the state marker is absent — and the same rule is applied
			 * here to the re-driven page, against the route the RECORD itself rendered.
			 *
			 * A mismatch is its own outcome rather than a FAIL or a PASS: the rows describe a
			 * screen the cell does not name, so there is no verdict to give. `state-not-reproduced`
			 * is reported with the other gaps (BLOCKED, exit 3) so a wrong screen can never
			 * contribute passing rows, and it names the cell on stderr so the run says which
			 * re-drive disagreed rather than only counting rows.
			 */
			const mismatch = recordClaimedReadiness(record)
				? reDriveMismatch({
						screen: record.screen,
						state: record.state,
						askedPath: record.path,
						root: SCREEN_ROOTS[record.screen],
						reading: state.reading ?? null,
					})
				: null;
			/*
			 * A REPLAYED ACTION THAT DID NOT LAND IS A GAP OF ITS OWN.
			 *
			 * The outcomes were computed and then thrown away, on the argument that a
			 * failed opener shows up as the state marker it never opened. That holds
			 * for eight of this slice's nine opener cells and fails for the ninth:
			 * `S16/create-filled`'s marker comes from its first action ALONE (opening
			 * the sheet), so a `type` that stopped landing — a renamed field, a broken
			 * value path — still re-drove to the declared state and contributed PASS
			 * rows about a form nobody had filled in. Reading the outcomes the module
			 * already returns is what makes the TYPING checkable on re-drive (review
			 * round 1, R6), and it costs one line per action.
			 */
			/* `ok-after-scroll` is a replay that LANDED — the press happened, the way
			 *  a reader makes it — so it is not this gap; the capture is where a declared
			 *  no-scroll control is judged (`UNSCROLLED_CONTROLS`). What counts here is
			 *  an action that could not be replayed at all. */
			const openerGap =
				(state.openerOutcomes ?? []).find((outcome) =>
					outcomeFailed(outcome.result),
				) ?? null;
			const gap =
				mismatch ??
				(openerGap === null
					? null
					: `${describeAffordance(openerGap.action)} reported '${openerGap.result}' when the capture's record applied it`);
			if (mismatch !== null) {
				console.error(
					`  ${String(record.name)}: the re-drive did not reach the state this record names — ${mismatch}`,
				);
			} else if (gap !== null) {
				console.error(
					`  ${String(record.name)}: the re-drive could not replay an action the capture applied — ${gap}`,
				);
			}
			// A cell whose declared state was never reached is not measurable, and its
			// rows are BLOCKED rather than PASS/FAIL: the harness re-drives the same URL,
			// so it renders the same fallback screen, and a check that "passed" there is
			// a reading about the fallback screen wearing the state's name. The capture
			// harness already fails these cells by name; this is the audit saying the
			// same thing about its own rows.
			// `unreadyCells` is a TOP-LEVEL manifest key, not a `meta` field.
			const notMeasurable = manifest.unreadyCells;
			const cellWasUnready =
				Array.isArray(notMeasurable) && notMeasurable.includes(record.name);
			// A DECLARED SKIP is a third outcome, and it has to be its own: the cell's
			// state is a named, owned dependency (a ticket, or an API the harness cannot
			// serve) rather than a failure, so its rows are BLOCKED with an owner and do
			// NOT count as a measurement gap. Counting them as gaps made every run of a
			// matrix that legitimately spans unlanded work exit 3, which is "we could not
			// tell" applied to a question nobody asked. The capture harness only marks a
			// cell this way while the app declares no marker for its state, so a marker
			// that stopped rendering is still a gap and still exits 3.
			const skipCells = manifest.declaredSkipCells;
			const cellWasSkipped =
				Array.isArray(skipCells) && skipCells.includes(record.name);
			const skipOwner = Array.isArray(manifest.declaredSkips)
				? (manifest.declaredSkips.find(
						// The manifest's `declaredSkips` entries are keyed by the CELL
						// (`screen/state` — how `capture.ts` writes them), never by the record's
						// own frame stem (`S4__loading__iphone-se__dark__100`). Matching the
						// stem made every lookup miss, so every declared skip printed its
						// fallback — "no owner named" — while the manifest named an owner for
						// all of them.
						(entry) => asRecord(entry)?.cell === recordCell(record),
					) as Record<string, unknown> | undefined)
				: undefined;
			const produced = runChecks(state, {
				floors,
				semantic: { ...semantic },
				checks,
				// The scale dimension is judged PER CELL by the capture harness, and the
				// run-level flag is only a fallback for a manifest written before that
				// existed. A cell whose own pair was inert must not be told it has a live
				// dimension because some other screen's was.
				scaleIsLive: record.scaleLive ?? meta.textScaleLive === true,
				// The palette's absence is a *failed check*, not a silent skip: with no
				// colours to match, a colour-only status node cannot be found, and a
				// PASS there is a reading the instrument did not earn.
				paletteMissingReason: palette.loaded
					? null
					: `${palette.reason ?? "no palette"}`,
			});
			// The blinding hook, applied at the moment a row is produced.
			//
			// This exists so the canary's own coverage can be attacked: `verify.ts`
			// blinds one rule at a time and requires the canary to fail, which is the
			// only way to prove a sub-rule is actually asserted. A blinded row is
			// rewritten to PASS and says so, and a blinded run is never evidence —
			// but a hook that silently did nothing would make the self-test vacuous,
			// so an unmatched spec is reported rather than ignored.
			const measured = cellWasSkipped
				? produced.map((row) => ({
						...row,
						verdict: "BLOCKED" as const,
						blockedKind: "declared-skip" as const,
						detail:
							`${row.detail ?? ""} — this cell's state is a DECLARED SKIP: ` +
							`${String(skipOwner?.owner ?? DECLARED_SKIP_NO_OWNER)}. Its frame is not evidence for ` +
							`the state it declares, and its absence is not a measurement gap`,
					}))
				: cellWasUnready
					? produced.map((row) => ({
							...row,
							verdict: "BLOCKED" as const,
							blockedKind: "state-not-reached" as const,
							detail:
								`${row.detail ?? ""} — this cell did not reach the state it declares in the ` +
								"capture run, so the row describes the fallback screen",
						}))
					: gap !== null
						? produced.map((row) => ({
								...row,
								verdict: "BLOCKED" as const,
								blockedKind: "state-not-reproduced" as const,
								detail:
									`${row.detail ?? ""} — the capture's record for this cell WAS ready and the ` +
									`re-drive does not reach the state it names, so the row describes another screen: ${gap}`,
							}))
						: produced;
			const blinded = measured.map((row) => {
				const spec = options.blind.find((candidate) =>
					matchesBlind(row, [candidate]),
				);
				// The measurement is LEFT ALONE and the reason is a field of its own:
				// rewriting `measured` destroyed the number the row exists to report,
				// which is the one thing a blind must not do.
				return spec === undefined
					? row
					: { ...row, verdict: "PASS" as const, blind: spec };
			});
			for (const row of measured) unblinded.push(row);
			for (const row of blinded) {
				rows.push({
					...row,
					screen: record.screen,
					screenLabel: record.screenLabel,
					state: record.state,
					device: record.device,
					theme: record.theme,
					scale: record.scale,
					frame: state.frame,
					url: state.requestedUrl,
				});
			}
			if (!options.quiet && index % 10 === 0) {
				console.log(`  ${index}/${records.length} cells audited`);
			}
		}
	} finally {
		const reaped = await chrome.close();
		await server.close();
		/* The relay keeps one world, so a claim left behind would refuse the next rig
		 *  in this shell (round 3, Q7). Best-effort: a teardown never fails a run, and
		 *  `relay` is the one the manifest names (the audit spawns its own when it does
		 *  not name one, and that one dies with this process). */
		if (relay) await releaseScenarioClaim(relay);
		if (reaped.survivors !== 0) {
			console.error(
				`WARNING: ${reaped.survivors} Chrome process(es) survived the sweep of ${reaped.profile}. ` +
					"A leaked browser keeps retrying the keychain on the operator's screen.",
			);
		}
	}

	const summary = new Map<
		string,
		{ pass: number; fail: number; exception: number; blocked: number }
	>();
	for (const row of rows) {
		const entry = summary.get(row.check) ?? {
			pass: 0,
			fail: 0,
			exception: 0,
			blocked: 0,
		};
		const verdict = String(row.verdict).toLowerCase();
		if (
			verdict === "pass" ||
			verdict === "fail" ||
			verdict === "exception" ||
			verdict === "blocked"
		)
			entry[verdict] += 1;
		summary.set(row.check, entry);
	}
	const failures = rows.filter((r) => r.verdict === "FAIL");
	const blocked = rows.filter((r) => r.verdict === "BLOCKED");
	// Only the BLOCKED rows that could not answer something they should have. A
	// check that does not apply to a cell (U-04 on a 100% frame) is expected and
	// does not make a run incomplete; one that could not measure (no palette, no
	// control in the frame) does.
	// `state-not-reached` counts as a gap too: a cell that never rendered the state it
	// declares measured nothing, and a run whose rows are all of that kind must not
	// exit 0. The other kinds ("not-applicable") are genuinely conditional — U-04
	// outside a 200% frame cannot apply — and stay non-failing.
	const gaps = blocked.filter(
		(r) =>
			r.blockedKind === "unmeasurable" ||
			r.blockedKind === "state-not-reached" ||
			r.blockedKind === "state-not-reproduced",
	);
	/**
	 * Rows the audit actually EVALUATED — anything that is not BLOCKED.
	 *
	 * This is the number the gate is really about, and it was the one number the
	 * report did not carry: a run whose every row was BLOCKED printed `0 FAIL,
	 * 160 BLOCKED`, and "0 FAIL" reads as a clean build in a PR comment and in CI
	 * while the audit measured nothing at all. Counting it explicitly is what lets
	 * the run say "we measured nothing" instead of leaving a reader to infer it.
	 */
	const measured = rows.filter((row) => row.verdict !== "BLOCKED").length;
	/**
	 * Why cells were not measurable, straight from the capture's own sentences.
	 *
	 * The manifest is the only place that knows whether a cell was refused for a
	 * missing marker, a route it never reached, or a relay it never talked to, and
	 * a zero-measurement run has to say WHICH — otherwise the reader sees a wall of
	 * BLOCKED and blames the app for what may be a naming disagreement between the
	 * app's identifiers and the harness's marker rule.
	 */
	const notMeasurableCell = Array.isArray(manifest.notMeasurableCells)
		? manifest.notMeasurableCells
		: [];
	const unmeasurableReasons = notMeasurableCell.flatMap((entry) => {
		const cell = asRecord(entry);
		const why = Array.isArray(cell?.why) ? cell.why : [];
		return why
			.filter((reason): reason is string => typeof reason === "string")
			.map((reason) => `${String(cell?.cell ?? "?")}: ${reason}`);
	});
	const report: AuditReport = {
		generatedAt: new Date().toISOString(),
		buildDir: meta.buildDir,
		relay: typeof meta.relay === "string" ? meta.relay : null,
		scenario: typeof meta.scenario === "string" ? meta.scenario : null,
		checks,
		cells: records.length,
		// Which palette and theme each cell was measured against, so a reading can
		// be audited rather than trusted.
		palette,
		measuredAgainst: {
			tokens: palette.path,
			themes: [...new Set(records.map((r) => r.theme))],
		},
		/*
		 * WHAT THE RE-DRIVE WAS POINTED AT, because a reader who cannot see this cannot
		 * tell a run that measured the recorded states from one that measured the app's
		 * fallback screen everywhere. In the report rather than in the prose for the same
		 * reason the provenance of the palette is: the numbers above only mean what this
		 * line says they mean.
		 */
		reDrive: {
			recorded: seedRecord?.applied === true,
			route: seed?.route ?? null,
		},
		coverage: COVERAGE,
		rows,
		summary: Object.fromEntries([...summary.entries()].sort()),
		failures: failures.length,
		blocked: blocked.length,
		/** Rows that were not BLOCKED: `0` means the audit measured nothing. */
		measured,
		/** BLOCKED rows that could not measure something they should have. */
		unmeasurable: gaps.length,
		/** The capture's own per-cell reasons, carried so a zero-measurement run can name the cause. */
		unmeasurableReasons,
		/**
		 * Cells whose state is a named, owned dependency rather than a failure.
		 *
		 * Reported so a reader can tell "the matrix does not cover this yet, and here is
		 * who owns it" from "the instrument could not tell". They are NOT gaps: counting
		 * them as gaps made every run of a matrix spanning unlanded work exit 3.
		 */
		declaredSkips: (Array.isArray(manifest.declaredSkips)
			? manifest.declaredSkips
			: []
		)
			.map((entry) => asRecord(entry))
			.filter((entry): entry is Record<string, unknown> => entry !== undefined)
			.map(
				(entry) =>
					`${String(entry.cell ?? "?")}: ${String(entry.owner ?? DECLARED_SKIP_NO_OWNER)}`,
			),
		verdict:
			failures.length > 0
				? "FAIL"
				: measured === 0
					? "NO-MEASUREMENT"
					: gaps.length > 0
						? "INCOMPLETE"
						: "PASS",
	};
	mkdirSync(outDir, { recursive: true });
	writeFileSync(
		join(outDir, "audit-report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	writeFileSync(join(outDir, "audit-report.md"), renderMarkdown(report));
	for (const spec of options.blind) {
		if (!unblinded.some((row) => matchesBlind(row, [spec])))
			blindUnmatched.add(spec);
	}

	return report;
}

/**
 * Rules silenced this run, and the specs that matched nothing.
 *
 * `--blind` is a mutation hook for the canary's coverage, not a release switch:
 * a spec that silences nothing means the self-test proved nothing, so it is
 * reported and treated as a failure by the caller rather than passing quietly.
 */
const blindUnmatched = new Set<string>();

/**
 * Whether a spec silences this row: `U-04` the whole check, `U-05-top` one rule.
 *
 * A sub-rule spec matches on the row's own words for that rule (`top edge …`,
 * `overflow-x: hidden`), because that text is what distinguishes the independent
 * branches — matching on the check id alone would blind both.
 */
function matchesBlind(
	row: { check: string; measured?: string | null },
	specs: string[],
): boolean {
	for (const spec of specs) {
		const [check, sub] = spec.split(":");
		if (check === undefined || row.check !== check) continue;
		if (sub === undefined) return true;
		// The patterns live in `checks.ts` because the canary's per-defect assertion
		// reads the same table; a second copy here is a copy that drifts.
		const pattern = SUB_RULE_TEXT[`${check}:${sub}`];
		if (pattern !== undefined && pattern.test(row.measured ?? "")) return true;
	}
	return false;
}

/** The markdown report: one row per finding, plus the per-check totals. */

/** What `renderMarkdown` reads; named so the shape is checkable. */
export interface AuditReport {
	generatedAt: string;
	buildDir: string;
	relay: string | null;
	scenario: string | null;
	checks: string[];
	cells: number;
	palette: PaletteProvenance;
	coverage: typeof COVERAGE;
	measuredAgainst: { tokens: string | null; themes: string[] };
	/**
	 * The seed the capture recorded, and the route this run re-drove it with. `route` is
	 * an origin of THIS run's when the capture seeded the origin it served from.
	 */
	reDrive: { recorded: boolean; route: string | null };
	rows: Array<
		Record<string, string | null | undefined> & {
			verdict: string;
			check: string;
			blockedKind?: string;
		}
	>;
	summary: Record<
		string,
		{ pass: number; fail: number; exception: number; blocked: number }
	>;
	failures: number;
	blocked: number;
	/** Rows the audit evaluated (anything not BLOCKED). `0` = it measured nothing. */
	measured: number;
	/**
	 * Cells whose state is a named, owned dependency rather than a failure. Never
	 * counted in `unmeasurable`: a declared gap is not an instrument failure.
	 */
	declaredSkips: string[];
	/**
	 * BLOCKED rows that could not measure something they should have — the not-measurable
	 * checks plus the cells whose re-drive did not reach the state the record names.
	 */
	unmeasurable: number;
	/** The capture's own sentence per not-measurable cell, for the zero-measurement report. */
	unmeasurableReasons: string[];
	verdict: string;
}

export function renderMarkdown(report: AuditReport) {
	// Named apart from "unmeasurable" because the two are different statements: one is
	// "this side could not read a number", the other is "the page was not the cell at
	// all". Both block, and a reader has to be able to tell which happened.
	const notReproduced = report.rows.filter(
		(row) => row.blockedKind === "state-not-reproduced",
	).length;
	const lines = [
		`# Accessibility audit — ${report.generatedAt}`,
		"",
		`- build: \`${report.buildDir}\``,
		`- relay: \`${report.relay ?? "—"}\` · scenario \`${report.scenario ?? "—"}\``,
		`- cells audited: ${report.cells} · checks: ${report.checks.join(", ")}`,
		`- palette: \`${report.palette.path ?? "—"}\` · loaded: ${report.palette.loaded} · entries: ${report.palette.entries}` +
			(report.palette.reason ? ` · (${report.palette.reason})` : ""),
		/*
		 * WHAT THE RE-DRIVE WAS POINTED AT. A reader who cannot see this cannot tell a run
		 * that measured the recorded states from one that measured the app's fallback
		 * screen in every cell — which is the reading this line exists to make impossible
		 * to mistake for the former.
		 */
		`- re-drive: ${
			report.reDrive.recorded
				? `the capture's own relay seed, re-applied at \`${report.reDrive.route ?? "—"}\``
				: "no relay seed recorded in the manifest — the cells were re-driven as captured"
		}`,
		`- **verdict: ${report.verdict}** — ${report.failures} FAIL, ${report.blocked} BLOCKED ` +
			`(${report.unmeasurable - notReproduced} unmeasurable, ${notReproduced} state-not-reproduced, ` +
			"the rest not-applicable)",
		`- **rows measured: ${report.measured} of ${report.rows.length}**` +
			(report.measured === 0
				? " — the audit measured NOTHING. A run with no measurement is not a run, and 0 FAIL here means no check was ever evaluated."
				: ""),
		"",
		"This tool machine-checks the rubric's mechanical half and nothing else:",
		`- machine-checked: **${report.coverage.machineChecked.join(", ")}**`,
		`- machine-defined in the rubric but NOT implemented here: **${report.coverage.unimplemented.join(", ")}**`,
		`- manual by the rubric's own text: ${report.coverage.manualOnly.join(", ")}`,
		`- §9 assertions not checked here: ${report.coverage.uncheckedAssertions.join(", ")}`,
		"",
		"Check ids are the rubric's own (`docs/ux/audit-rubric.md` §3). `BLOCKED` means the state could not answer the question — it is not a pass, and a run whose only non-PASS rows are BLOCKED exits 3.",
		"",
		"## Totals",
		"",
		"| check | pass | fail | exception | blocked |",
		"|---|---|---|---|---|",
	];
	for (const [check, entry] of Object.entries(report.summary)) {
		lines.push(
			`| ${check} | ${entry.pass} | ${entry.fail} | ${entry.exception} | ${entry.blocked} |`,
		);
	}
	const interesting = report.rows.filter((r) => r.verdict !== "PASS");
	if (report.declaredSkips.length > 0) {
		// Its own section, above the rows, because it is the one thing a reader must
		// not confuse with a measurement gap: the state is not reachable on this head
		// and somebody owns it.
		lines.push(
			"",
			`## Declared skips (${report.declaredSkips.length})`,
			"",
			"These cells declare a state this head does not render yet, so no frame of them is",
			"evidence. They are NOT counted in `unmeasurable` (the capture marks a cell this way",
			"only while the app declares no marker for its state):",
			"",
		);
		for (const entry of report.declaredSkips) lines.push(`- ${entry}`);
	}
	lines.push(
		"",
		`## Rows (${interesting.length} non-PASS of ${report.rows.length})`,
		"",
	);
	if (interesting.length === 0) {
		lines.push(
			"Every check passed on every cell. See `audit-report.json` for the measurements.",
		);
	} else if (report.measured === 0) {
		// A zero-measurement run is not a table of findings; it is a statement that
		// the instrument could not speak, and it has to read that way.
		lines.push(
			`**The audit measured nothing.** All ${report.rows.length} rows are BLOCKED, so there is no measurement`,
			"here to read as evidence — `0 FAIL` above is the absence of a reading, not a passing one.",
		);
		if (report.unmeasurableReasons.length > 0) {
			lines.push("", "Why the capture could not reach them:", "");
			for (const reason of report.unmeasurableReasons)
				lines.push(`- ${reason}`);
		}
		lines.push("");
	} else {
		lines.push(
			"| check | screen | state | device | theme | scale | verdict | measured | detail | frame |",
			"|---|---|---|---|---|---|---|---|---|---|",
		);
		for (const row of interesting) {
			lines.push(
				`| ${row.check} | ${row.screen} | ${row.state} | ${row.device} | ${row.theme} | ${row.scale} | **${row.verdict}** | ` +
					`${row.measured ?? ""} | ${String(row.detail ?? "").replace(/\|/g, "\\|")} | ${String(row.frame ?? "")} |`,
			);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

/* -------------------------------------------------------------------- CLI -- */

const isMain =
	process.argv[1] &&
	import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) {
	const { flags } = parseArgs(process.argv.slice(2));
	const manifest = str(flags, "manifest", undefined);
	if (bool(flags, "help") || !manifest) {
		console.log(
			[
				"usage: node tools/audit/audit.ts --manifest <frames>/manifest.json [options]",
				"",
				"  --manifest <path>   the capture harness's manifest.json",
				"  --out <dir>         where the report goes (default: beside the manifest)",
				`  --checks <ids>      comma list, default the reported half of the rubric: ${ALL_CHECKS.join(",")}`,
				`                      NOT checked here: ${COVERAGE.unimplemented.join(",")} (machine-defined in the`,
				"                      rubric, unimplemented by this tool); §4-§7 are manual; R1-R6 unchecked.",
				"  --allow-blocked     exit 0 even when a check could not measure (local only, never CI)",
				"  --tokens <path>     tokens.json for the floors (default <repo>/design/tokens/tokens.json)",
				"  --settle <ms>       boot budget per cell (default 1200)",
				"  --cell-timeout <s>  hard bound per cell; a cell that exceeds it is a BLOCKED row (default 45)",
				"  --blind <rule>      silence one rule (U-04, U-05-top, U-07-x). A mutation",
				"                      self-test hook for the canary's own coverage; a blinded",
				"                      run is not evidence, and a spec that matches no row fails.",
				"  --quiet             no progress lines",
				"",
				"exit: 0 all clear · 1 FAIL · 2 refused to run · 3 no FAIL but a check could not measure",
			].join("\n"),
		);
		process.exit(manifest ? 0 : 2);
	}
	let report: AuditReport;
	try {
		report = await runAudit({
			manifest,
			out: str(flags, "out", undefined),
			checks: csv(flags, "checks"),
			tokens: str(flags, "tokens", undefined),
			settleMs: num(flags, "settle", 1200),
			cellTimeoutMs: num(flags, "cell-timeout", 45) * 1000,
			blind: csv(flags, "blind"),
			quiet: bool(flags, "quiet"),
			profile: str(flags, "profile", undefined),
		});
	} catch (error) {
		if (error instanceof AuditRefused) {
			console.error(`audit refused: ${error.message}`);
			process.exit(2);
		}
		throw error;
	}
	console.log(
		`audit: ${report.cells} cells, ${report.rows.length} check rows, ${report.measured} measured, ` +
			`${report.failures} FAIL, ${report.blocked} BLOCKED (${report.unmeasurable} unmeasurable) · ` +
			`palette ${report.palette.loaded ? "loaded" : "MISSING"}`,
	);
	const notReproduced = report.rows.filter(
		(row) => row.blockedKind === "state-not-reproduced",
	);
	if (notReproduced.length > 0) {
		/*
		 * NAMED, because this is the outcome that used to be a silent PASS: the capture's
		 * record for these cells was ready and the re-drive landed on another screen. A
		 * count alone would not say which cell, and the cells are what a reader has to go
		 * and look at; the full sentences are on stderr once per cell as they happen and in
		 * audit-report.md.
		 */
		console.error(
			`audit: ${notReproduced.length} row(s) are BLOCKED as state-not-reproduced — the capture's ` +
				"record for these cells was ready and the re-drive did not reach the state it names:",
		);
		const named = [
			...new Set(
				notReproduced.map((row) => String(row.frame ?? row.url ?? "?")),
			),
		];
		for (const entry of named.slice(0, 5)) console.error(`  - ${entry}`);
		if (named.length > 5)
			console.error(`  … ${named.length - 5} more, in audit-report.md`);
	}
	if (report.declaredSkips.length > 0) {
		// Named, and deliberately NOT folded into "unmeasurable": a cell whose state
		// waits on an owned ticket is not something the instrument failed to read.
		console.log(
			`audit: ${report.declaredSkips.length} cell(s) are DECLARED SKIPS (not gaps):`,
		);
		for (const entry of report.declaredSkips.slice(0, 5))
			console.log(`  - ${entry}`);
		if (report.declaredSkips.length > 5)
			console.log(
				`  … ${report.declaredSkips.length - 5} more, in audit-report.md`,
			);
	}
	if (blindUnmatched.size > 0) {
		// A blind that silences nothing proves nothing, so it fails rather than
		// letting the mutation self-test read as a pass it did not earn. It is
		// checked before the zero-measurement rule below because a blind that
		// matched nothing is a broken INSTRUMENT, not a reading about the app.
		console.error(
			`audit: --blind matched no row: ${[...blindUnmatched].join(", ")}. ` +
				"The rule name or its sub-rule spelling is wrong, or the check produced no row.",
		);
		process.exit(2);
	}
	if (report.measured === 0) {
		// Loud, and ahead of every other verdict: a run that evaluated no check must
		// not report itself as a run with a gap, and `--allow-blocked` (a local
		// convenience for "a check could not measure") must not turn "measured
		// nothing" into 0.
		console.error(
			`audit: MEASURED NOTHING — 0 of ${report.rows.length} rows were evaluated; all ${report.blocked} are BLOCKED. ` +
				"This is not a pass and not a gap: the gate could not speak.",
		);
		for (const reason of report.unmeasurableReasons.slice(0, 5))
			console.error(`  - ${reason}`);
		if (report.unmeasurableReasons.length > 5)
			console.error(
				`  … ${report.unmeasurableReasons.length - 5} more, in audit-report.md`,
			);
		process.exit(3);
	}
	if (report.failures > 0) process.exit(1);
	// A run with a gap is not a pass: the scaffold's un-scalable text produced a
	// BLOCKED-only report that exited 0 before this rule existed. A check that
	// does not apply to a cell (U-04 outside the 200% frames) is not a gap.
	if (report.unmeasurable > 0 && !bool(flags, "allow-blocked")) process.exit(3);
	process.exit(0);
}
