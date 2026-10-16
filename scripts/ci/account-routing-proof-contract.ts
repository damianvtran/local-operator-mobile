import { createHash } from "node:crypto";
import { validateCustomBaseUrl } from "../../src/connection/profile.ts";
import {
	assertDedicatedNativeCI,
	assertPolicyFixtureIdentity,
	type PolicyTransport,
} from "../../tools/mock-relay/account-routing-identity.ts";

export const PROOF_MODE = "account-routing-ios-proof";
export const PINS = {
	product: "c67e79b09c24c0776292e857cadf7e6973b0144e",
	base: "34b8340da2baa764016896367f58d0fc4b3c51d3",
	core: "c1b7083a5371d60aa4ad58dbb54fd30d1a25857c",
	coreBlob: "b08458247ac5babb43acd696c44bc3630e01d787",
	artifactId: 12008351088,
	runId: 38805568113,
	artifactBytes: 33947890,
	artifactDigest:
		"18254a69eec01605aa0ccca0d39c50f98a3be73a2086dbc918ec40f7b63c903e",
	repository: "damianvtran/local-operator-mobile",
	maestro: "2.11.0",
} as const;
export type ProofStage = "preflight" | "setup" | "full";
/** Per-stage wall-clock budget.
 *
 * DERIVED, not declared, because the stage clock and the per-op caps must not be
 * two independent sources of truth: a stage budget below the sum of the caps its
 * steps can spend is exactly how a legitimate cold step gets clamped and reported
 * as a policy failure — the class this loop kept rediscovering. The workflow's
 * `timeout-minutes` is this number; the arithmetic below is asserted by a control.
 *
 * Measured basis (run 38850837889, the coldest run to date), in seconds:
 *   setup payload  = selector 300 + bootReady 367 + install 300 + shutdown 300
 *                  + delete 120 + maestroCold 420 + warm launch 91 + 3 warm flows
 *                  360 + version/help 120 + simctl 36  -> ~2100s (35 min)
 *   preflight payload = clone 90 + pin 60 + bootstrap 300 + socket doctor 29
 *                  + extraction 120 + the sub-second git/node steps -> ~800s
 *   full adds the xcodebuild producer 3600 + pod install 600 + prebuild 360
 *                  + ~30 warm flows 3600 -> ~9000s more
 * Each stage keeps substantial headroom above its payload, and the control below
 * fails if a budget ever drops to or below the sum of the cold caps in it. */
export const STAGE_SECONDS: Record<ProofStage, number> = {
	preflight: 1200,
	setup: 4200,
	full: 12600,
};

/** EVERY observation of a bounded operation, with the run it came from.
 *
 * A single number is not a distribution: the selector measured 6107ms, 7267ms and
 * then 15021ms, so a cap sized just above the SMALLEST observation (15s, F5) was
 * still under-sized one run later (CI 38847064654). Recording the whole sample
 * set is what makes the derived cap data-driven instead of hand-tuned.
 *
 * Entries are SAMPLES, not budgets: adding a measured run is the only way a cap
 * moves. Milliseconds, as observed and reported by the proof host.
 */
export const OPERATION_OBSERVATIONS = {
	// Every value is a REAL elapsed from a real hosted run's commands.json, read
	// from the downloaded artifacts: runs 38840447956 (preflight), 38842647133,
	// 38844597781, 38845929163, 38847064654 and 38850837889. Nothing here is
	// estimated; three earlier revisions of this table contained values that were
	// never measured, and each one under-sized a bound.
	//
	// `censored: true` marks a sample KILLED by the cap in force, not a completed
	// run: its elapsed is a LOWER BOUND (the child was cut off), and it carries
	// kill/reap latency. Including it in the max is deliberate — the derived cap
	// must clear the bound that killed it.
	//
	// Run 38850837889 is why the factors are spread-based rather than 1.5x: every
	// cold op in it was slower than every prior run (selector 46.9s, bootReady
	// 122.3s, install 47.8s, shutdown 63.5s), so a bound sized on prior spread was
	// exceeded on four operations at once.
	artifactTests: [
		{ run: 38850837889, ms: 80 },
		{ run: 38847064654, ms: 93 },
		{ run: 38845929163, ms: 98 },
		{ run: 38844597781, ms: 112 },
		{ run: 38842647133, ms: 115 },
	],
	baselineRouteValidator: [
		{ run: 38850837889, ms: 89 },
		{ run: 38847064654, ms: 18 },
		{ run: 38845929163, ms: 33 },
		{ run: 38844597781, ms: 47 },
		{ run: 38842647133, ms: 35 },
		{ run: 38840447956, ms: 36 },
	],
	boot: [
		{ run: 38850837889, ms: 2665 },
		{ run: 38845929163, ms: 2832 },
		{ run: 38844597781, ms: 2419 },
	],
	bootReady: [
		{ run: 38850837889, ms: 122263 },
		{ run: 38845929163, ms: 91663, censored: true },
		{ run: 38844597781, ms: 92562 },
	],
	create: [
		{ run: 38850837889, ms: 342 },
		{ run: 38845929163, ms: 344 },
		{ run: 38844597781, ms: 296 },
	],
	delete: [
		{ run: 38850837889, ms: 1185 },
		{ run: 38845929163, ms: 22002, censored: true },
		{ run: 38844597781, ms: 454 },
	],
	inspectApp: [
		{ run: 38850837889, ms: 122 },
		{ run: 38847064654, ms: 116 },
		{ run: 38845929163, ms: 146 },
		{ run: 38844597781, ms: 858 },
		{ run: 38844597781, ms: 217 },
		{ run: 38842647133, ms: 204 },
	],
	install: [
		{ run: 38850837889, ms: 47798, censored: true },
		{ run: 38844597781, ms: 24619 },
	],
	installedContainer: [{ run: 38844597781, ms: 6590 }],
	installedSimulators: [
		{ run: 38850837889, ms: 483 },
		{ run: 38845929163, ms: 354 },
		{ run: 38844597781, ms: 261 },
	],
	maestroCold: [{ run: 38844597781, ms: 121921, censored: true }],
	maestroHelp: [
		{ run: 38850837889, ms: 3009 },
		{ run: 38847064654, ms: 3360 },
		{ run: 38845929163, ms: 2612 },
		{ run: 38844597781, ms: 3420 },
		{ run: 38842647133, ms: 4470 },
	],
	maestroVersion: [
		{ run: 38850837889, ms: 3645 },
		{ run: 38847064654, ms: 3566 },
		{ run: 38845929163, ms: 3999 },
		{ run: 38844597781, ms: 4749 },
		{ run: 38842647133, ms: 5550 },
	],
	nativeSource: [
		{ run: 38850837889, ms: 28 },
		{ run: 38847064654, ms: 26 },
		{ run: 38845929163, ms: 19 },
		{ run: 38844597781, ms: 61 },
		{ run: 38842647133, ms: 32 },
		{ run: 38840447956, ms: 95 },
	],
	productByteFreeze: [
		{ run: 38850837889, ms: 38 },
		{ run: 38847064654, ms: 17 },
		{ run: 38845929163, ms: 18 },
		{ run: 38844597781, ms: 54 },
		{ run: 38842647133, ms: 73 },
		{ run: 38840447956, ms: 37 },
	],
	publicCoreIdentity: [
		{ run: 38850837889, ms: 22 },
		{ run: 38847064654, ms: 25 },
		{ run: 38845929163, ms: 8 },
		{ run: 38844597781, ms: 41 },
		{ run: 38842647133, ms: 15 },
		{ run: 38840447956, ms: 19 },
	],
	selector: [
		{ run: 38850837889, ms: 46859 },
		{ run: 38847064654, ms: 15019, censored: true },
		{ run: 38845929163, ms: 6107 },
		{ run: 38844597781, ms: 7267 },
		// Killed at its 60s cap (F3). `rc:128` is the fabricated kill code that
		// round's `resolve(code ?? 128)` produced — the reason the deadline path now
		// reports a named deadline instead — so this is a censored sample, not an
		// exit. A generator keying only on `rc: null` missed it; the R6-1 control
		// caught that, which is the control doing its job on its own author.
		{ run: 38842647133, ms: 60034, censored: true },
	],
	shutdown: [
		{ run: 38850837889, ms: 63481, censored: true },
		{ run: 38845929163, ms: 23349, censored: true },
		{ run: 38844597781, ms: 14985 },
	],
	socketDoctor: [
		{ run: 38850837889, ms: 11688 },
		{ run: 38847064654, ms: 11243 },
		{ run: 38845929163, ms: 14076 },
		{ run: 38844597781, ms: 19106 },
		{ run: 38842647133, ms: 14673 },
		{ run: 38840447956, ms: 5518 },
	],
} as const;

/** Heavy PRODUCER steps whose bound is DELIBERATE rather than derived: either no
 * recorded run has reached them, or the only samples are single preflight
 * observations of a network/index operation, where one sample is not a
 * distribution and deriving from it would size the bound to one lucky run.
 *
 * Observed so far, kept here as evidence rather than as a derivation: clone
 * 1.777s and pin 7.475s (run 38840447956, when the Core checkout was absent);
 * the bootstrap script 0.505-22.771s across five runs, where 0.5s is a warm
 * receipt and 22.8s is a cold index resolve. A budget for these is a judgement,
 * and it is labelled as one — recording it as an "observation" would fabricate
 * the data the derivation rests on, and deriving from a single sample would
 * under-size the bound (review R6-2). */
export const PRODUCER_BUDGET_SECONDS = {
	expoPrebuild: 180,
	podInstall: 600,
	xcodebuild: 3600,
	checkoutSnapshot: 60,
	coreClone: 90,
	corePin: 60,
	// The bootstrap's first run resolves 23 wheels plus the pinned checkout's
	// metadata from the index; the ONE recorded preflight saw 0.5s because the
	// receipt was warm, which is a cache hit rather than the operation's cost.
	coreBootstrapInstall: 300,
} as const;

/** Operations with NO observation in any recorded run: they have never been
 * reached by a hosted run, so there is nothing to derive from and inventing a
 * sample would fabricate the table's own input. They keep an explicitly labelled
 * conservative budget, and move into OPERATION_OBSERVATIONS the moment a real run
 * measures them. */
export const UNOBSERVED_BUDGET_SECONDS = {
	// One `maestro ... hierarchy` driver touch; steady driver commands are
	// sub-5s, so this is a conservative bound, not a measurement.
	hierarchy: 60,
	// `node scripts/ci/version.ts --write`; a sub-second node step in practice.
	candidateRefVersion: 60,
	// Archive extraction is a python zip walk over a ~100MB bundle.
	baseExtraction: 120,
	// `node scripts/ci/ios-project.ts` — resolves the workspace/scheme.
	workspaceResolver: 60,
	// `plutil -convert json` on a built Info.plist.
	plistJson: 60,
	// `node scripts/ci/native-config.ts ios <info.json>`.
	nativeConfig: 60,
	// `node scripts/ci/prebuild-determinism.ts` over two prebuild trees.
	determinism: 180,
	// `simctl install` of the produced candidate — the same operation as
	// `install-exact-base` (24.6s measured), but on the candidate build.
	installCandidate: 120,
} as const;

export type BoundedOperation = keyof typeof OPERATION_OBSERVATIONS;

/** Samples an ARTIFACT shows were killed by the cap in force, not completed.
 *
 * Each entry quotes the recorded command from that run's `commands.json`, and
 * the control asserts the corresponding table sample carries `censored: true`.
 * This exists because the flag is easy to get wrong in exactly the direction that
 * hides a bound: `bootReady` shipped with 91663ms recorded as a completed rc0
 * measurement while run 38845929163's own artifact says
 * `{"rc":null,"deadlineExceeded":true,"capSeconds":90}` — the shipped comment
 * asserted the reverse of the artifact (review R6-1). A hand-written flag cannot
 * catch that; an artifact-derived list can, because the evidence is quoted here
 * rather than remembered.
 */
export const ARTIFACT_CENSORED_SAMPLES = [
	{
		operation: "bootReady",
		run: 38845929163,
		evidence:
			'{"rc":null,"elapsedMs":91663,"deadlineExceeded":true,"capSeconds":90}',
	},
	{
		operation: "selector",
		run: 38847064654,
		evidence: '{"rc":null,"elapsedMs":15019,"deadlineExceeded":true}',
	},
	{
		operation: "selector",
		run: 38842647133,
		evidence: '{"rc":128,"elapsedMs":60034}',
	},
	{
		operation: "maestroCold",
		run: 38844597781,
		evidence: '{"rc":null,"elapsedMs":121921,"deadlineExceeded":true}',
	},
	{
		operation: "shutdown",
		run: 38845929163,
		evidence:
			'{"rc":null,"elapsedMs":23349,"deadlineExceeded":true,"capSeconds":20}',
	},
	{
		operation: "delete",
		run: 38845929163,
		evidence:
			'{"rc":null,"elapsedMs":22002,"deadlineExceeded":true,"capSeconds":20}',
	},
] as const satisfies readonly {
	operation: BoundedOperation;
	run: number;
	evidence: string;
}[];

/** Operations whose FIRST call of a run pays a cold, unoutputted start
 * (CoreSimulator launch, XCUITest driver bring-up, a cold backend install), plus
 * the teardown of a just-booted simulator, which is the same cold service.
 *
 * Their bounds are NOT derived from `max(observed) * small`: a hosted runner can
 * be uniformly slower than every previous run, so a factor over the observed max
 * bounds the run by other runs' spread and each dispatch then discovers the next
 * under-sized cap. That is exactly what happened across F5/F6/R5 and again in run
 * 38850837889, where the whole run was colder than every prior one (selector
 * 46.9s vs a 15.0s prior max; install 47.8s vs a 24.6s prior max; shutdown 63.5s
 * vs a 23.3s prior max). The manager's rule is the one now implemented: size a
 * cold op so it cannot plausibly be exceeded, from a SPREAD-based factor, with a
 * hard per-op floor. */
export const COLD_OPERATION_FLOOR_SECONDS: Partial<
	Record<BoundedOperation, number>
> = {
	// Floors are the manager's named minima: selector/install/shutdown >= 300,
	// bootReady >= 360, delete >= 120, cold maestro >= 420. They are deliberately
	// above every observation to date, because the point of a bound is the next
	// run, not the run already measured.
	selector: 300,
	bootReady: 360,
	install: 300,
	shutdown: 300,
	delete: 120,
	maestroCold: 420,
};

/** A cold operation's factor over its largest observation, applied BEFORE the
 * floor. 3x, not 1.5x: the selector's samples span 6.1-60.0s (a killed sample is
 * a lower bound, so the true span is wider), and a single dispatch that is
 * uniformly colder moves every sample at once. */
export const COLD_SPREAD_FACTOR = 3;

/** The smallest sensible bound per operation, so a single fast sample cannot
 * derive a cap that a normal slow run immediately breaks. */
export const OPERATION_MINIMUM_SECONDS: Partial<
	Record<BoundedOperation, number>
> = {
	create: 30,
	maestroVersion: 60,
	maestroHelp: 60,
	// Sub-second operations whose measured spread is tiny but whose REMOTE cousins
	// (a cold node start, a cold git) are not: a floor stops a fast sample from
	// deriving a bound a normal slow run immediately breaks.
	nativeSource: 60,
	productByteFreeze: 60,
	baselineRouteValidator: 60,
	publicCoreIdentity: 60,
};

/** The steady per-flow budget, as a CONTRACT rather than an observation.
 *
 * An evidence flow is allowed this much once the driver is warm. No artifact
 * sample exists for a warm flow — the only steady flow ever attempted was the
 * COLD one (run 38844597781, 121.9s) — so deriving it from data would mean
 * inventing a sample. The cold cap is required to exceed it so a cold cost cannot
 * hide behind the warm budget. */
export const STEADY_FLOW_CAP_SECONDS = 120;

/** Factor over the largest observation for a NON-cold operation. */
export const OBSERVED_HEADROOM = 1.5;

/** Every observed value for an operation, in seconds. */
export function observedSeconds(operation: BoundedOperation) {
	return OPERATION_OBSERVATIONS[operation].map((sample) => sample.ms / 1000);
}

/** max/min of the samples: the measured spread, which is what tells a reader
 * whether one factor can possibly cover the next run. Null with fewer than two
 * samples, because a single sample has no spread. */
export function observedSpread(operation: BoundedOperation) {
	const values = observedSeconds(operation);
	if (values.length < 2) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	return { min, max, ratio: min > 0 ? max / min : null };
}

/** The largest observation recorded for an operation, in seconds.
 *
 * Censored samples (killed by the cap in force) are INCLUDED: they are lower
 * bounds on the true cost, so a cap derived from them is a lower bound too, which
 * is exactly the property that makes the bound safe against the failure that
 * censored it.
 */
export function observedMaxSeconds(operation: BoundedOperation) {
	return Math.max(...OPERATION_OBSERVATIONS[operation].map((s) => s.ms)) / 1000;
}

/** The cold ops a stage can spend, so its budget can be checked against the sum of
 * their caps rather than against one declared number: a stage clock below that sum
 * is how a legitimate cold step gets clamped and reported as a policy failure. */
export function coldStepSumSeconds(stage: ProofStage) {
	// Declared BEFORE the stage budgets that consume it: `const` initialisers run
	// in source order, so a budget referencing a later function would be a runtime
	// TDZ error rather than a compile error.
	return (STAGE_COLD_STEPS[stage] ?? []).reduce(
		(total, operation) => total + capFor(operation),
		0,
	);
}

export const STAGE_COLD_STEPS: Partial<Record<ProofStage, BoundedOperation[]>> =
	{
		setup: [
			"selector",
			"bootReady",
			"install",
			"shutdown",
			"delete",
			"maestroCold",
		],
		full: [
			"selector",
			"bootReady",
			"install",
			"shutdown",
			"delete",
			"maestroCold",
		],
	};

/** Stage payload: the sum of every cap a stage's steps can spend, so a stage
 * budget can be checked against real work instead of against one big number. */
export const STAGE_PAYLOAD_SECONDS: Partial<Record<ProofStage, number>> = {
	// See the arithmetic in STAGE_SECONDS' comment; producer budgets and the
	// unobserved budgets come from their own maps so this cannot drift from them.
	preflight:
		PRODUCER_BUDGET_SECONDS.coreClone +
		PRODUCER_BUDGET_SECONDS.corePin +
		PRODUCER_BUDGET_SECONDS.coreBootstrapInstall +
		UNOBSERVED_BUDGET_SECONDS.baseExtraction +
		240,
	setup:
		coldStepSumSeconds("setup") +
		capFor("maestroVersion") +
		capFor("maestroHelp") +
		capFor("installedSimulators") +
		capFor("create") +
		capFor("boot") +
		capFor("selector") +
		3 * STEADY_FLOW_CAP_SECONDS,
	// `full` re-runs setup's cold steps, then the ONE candidate producer
	// (xcodebuild dominates) and ~30 warm candidate flows. Kept as an explicit sum
	// of the parts so it cannot drift from the caps and budgets it is built from.
	full:
		coldStepSumSeconds("full") +
		capFor("maestroVersion") +
		capFor("maestroHelp") +
		capFor("installedSimulators") +
		capFor("create") +
		capFor("boot") +
		capFor("selector") +
		3 * STEADY_FLOW_CAP_SECONDS +
		PRODUCER_BUDGET_SECONDS.expoPrebuild +
		PRODUCER_BUDGET_SECONDS.checkoutSnapshot +
		PRODUCER_BUDGET_SECONDS.podInstall +
		PRODUCER_BUDGET_SECONDS.xcodebuild +
		PRODUCER_BUDGET_SECONDS.expoPrebuild +
		UNOBSERVED_BUDGET_SECONDS.workspaceResolver +
		UNOBSERVED_BUDGET_SECONDS.plistJson +
		UNOBSERVED_BUDGET_SECONDS.nativeConfig +
		UNOBSERVED_BUDGET_SECONDS.determinism +
		UNOBSERVED_BUDGET_SECONDS.installCandidate +
		UNOBSERVED_BUDGET_SECONDS.candidateRefVersion +
		30 * STEADY_FLOW_CAP_SECONDS,
};

export function capRestsOnCensoredSample(operation: BoundedOperation) {
	const max = observedMaxSeconds(operation);
	return OPERATION_OBSERVATIONS[operation].some(
		(sample) =>
			(sample as { censored?: boolean }).censored && sample.ms / 1000 === max,
	);
}

/** A cap DERIVED from the samples: above every observation, above the cold floor
 * where the operation is cold, and never below its per-operation minimum.
 *
 * `headroom` is a parameter so a control can prove the derivation is data-driven
 * rather than reading a constant back.
 */
export function deriveCapSeconds(
	operation: BoundedOperation,
	headroom?: number,
	samples?: readonly { run: number; ms: number }[],
) {
	const source = samples ?? OPERATION_OBSERVATIONS[operation];
	if (source.length === 0) throw new Error(`no observations for ${operation}`);
	const maxSeconds = Math.max(...source.map((sample) => sample.ms)) / 1000;
	const coldFloor = COLD_OPERATION_FLOOR_SECONDS[operation];
	// A cold op uses its OWN factor (default COLD_SPREAD_FACTOR) and its hard
	// floor; a warm op uses the caller's factor or OBSERVED_HEADROOM. An explicit
	// `headroom` argument still wins, so a control can prove the derivation reads
	// the samples rather than a constant.
	const factor =
		headroom ??
		(coldFloor !== undefined ? COLD_SPREAD_FACTOR : OBSERVED_HEADROOM);
	const derived = Math.ceil(maxSeconds * factor);
	return Math.max(
		derived,
		OPERATION_MINIMUM_SECONDS[operation] ?? 0,
		coldFloor ?? 0,
	);
}

/** The single entry the proof host uses, so no call site hand-writes a number. */
export function capFor(operation: BoundedOperation) {
	return deriveCapSeconds(operation);
}

/** Receipt-facing derivation record: the samples, their run ids, the max used and
 * the resulting cap, so a reader can see WHY a bound is what it is. */
export function capDerivation(operation: BoundedOperation) {
	return {
		operation,
		observations: OPERATION_OBSERVATIONS[operation],
		maxObservedSeconds: observedMaxSeconds(operation),
		// A cap whose deciding sample was killed by a previous cap is a bound on a
		// bound; the receipt says so rather than implying a completed measurement.
		restsOnCensoredSample: capRestsOnCensoredSample(operation),
		headroom:
			COLD_OPERATION_FLOOR_SECONDS[operation] !== undefined
				? COLD_SPREAD_FACTOR
				: OBSERVED_HEADROOM,
		spread: observedSpread(operation),
		coldFloorSeconds: COLD_OPERATION_FLOOR_SECONDS[operation] ?? null,
		minimumSeconds: OPERATION_MINIMUM_SECONDS[operation] ?? null,
		capSeconds: capFor(operation),
	};
}

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const UDID = /^[a-fA-F0-9-]{36}$/;
const DRIVE_PREFIX = /^[a-z]:/i;
const BUNDLE_ID = /^[a-zA-Z0-9.-]+$/;
const HIERARCHY_FIELD =
	/^(bounds|frame|font(size|family|name)?|textScale|contentSizeCategory)$/i;
const GEOMETRY_FIELD = /^(bounds|frame)$/i;
const FONT_FIELD = /^font/i;
export const FROZEN_PATHS = ["src", "app", "app.config.ts", "pnpm-lock.yaml"];

export function selectProof(
	event: string,
	mode: string,
	stage: string,
): ProofStage | null {
	if (mode === "full") {
		if (stage !== "full")
			throw new Error("stage selection is targeted-proof only");
		return null;
	}
	if (mode === "s15-proof") {
		if (event !== "workflow_dispatch" || stage !== "full")
			throw new Error("invalid S15 selection");
		return null;
	}
	if (
		mode !== PROOF_MODE ||
		event !== "workflow_dispatch" ||
		!["preflight", "setup", "full"].includes(stage)
	)
		throw new Error("unknown or non-manual targeted proof selection");
	return stage as ProofStage;
}
export function frozenSha(value: string) {
	if (!SHA.test(value))
		throw new Error("proof source must be an exact commit SHA");
	return value;
}
export function assertProofCI(env: NodeJS.ProcessEnv) {
	assertDedicatedNativeCI(env);
	if (
		env.GITHUB_REPOSITORY !== PINS.repository ||
		env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
		env.PROOF_MODE !== PROOF_MODE
	)
		throw new Error("targeted proof is manual and repository-specific");
	frozenSha(env.GITHUB_SHA ?? "");
}
export function assertNativeOrigin(
	hostname: string,
	cookieName: string,
	port: number,
	transport: PolicyTransport,
) {
	if (transport !== "ci-native-mdns")
		throw new Error("native proof requires explicit mDNS mode");
	assertPolicyFixtureIdentity(hostname, cookieName, transport);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
		throw new Error("invalid owned listener port");
	const origin = `http://${hostname}:${port}`;
	// The SHIPPED production validator is executed, never copied or relaxed.
	if (
		!validateCustomBaseUrl(origin, { allowInsecure: true }).ok ||
		validateCustomBaseUrl(origin).ok
	)
		throw new Error(
			"real custom-URL form validator refuses this proof origin/consent boundary",
		);
	return origin;
}
export function assertLoopbackAnswers(addresses: string[]) {
	if (
		addresses.length === 0 ||
		addresses.some((address) => address !== "127.0.0.1" && address !== "::1")
	)
		throw new Error(
			"owned mDNS hostname did not resolve exclusively to loopback",
		);
}
export function mdnsCommand(
	hostname: string,
	cookieName: string,
	port: number,
) {
	assertNativeOrigin(hostname, cookieName, port, "ci-native-mdns");
	return [
		"-P",
		hostname.slice(0, -6),
		"_http._tcp",
		"local.",
		String(port),
		hostname,
		"127.0.0.1",
	];
}
export function assertArtifactMetadata(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("missing base artifact metadata");
	const data = value as Record<string, unknown>;
	const run = data.workflow_run;
	if (!run || typeof run !== "object" || Array.isArray(run))
		throw new Error("missing artifact run provenance");
	const workflow = run as Record<string, unknown>;
	if (
		data.id !== PINS.artifactId ||
		data.name !== "ios-simulator" ||
		data.expired !== false ||
		data.size_in_bytes !== PINS.artifactBytes ||
		data.digest !== `sha256:${PINS.artifactDigest}` ||
		workflow.id !== PINS.runId ||
		workflow.head_sha !== PINS.base
	)
		throw new Error("base artifact id/head/size/digest/expiry mismatch");
	return {
		id: data.id,
		digest: PINS.artifactDigest,
		head: PINS.base,
		runId: PINS.runId,
	};
}
export function assertBaseRun(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("missing base run provenance");
	const run = value as Record<string, unknown>;
	if (
		run.id !== PINS.runId ||
		run.head_sha !== PINS.base ||
		run.status !== "completed" ||
		run.conclusion !== "success" ||
		run.path !== ".github/workflows/ios.yml"
	)
		throw new Error("base producer run/head/workflow/success mismatch");
	return {
		id: PINS.runId,
		head: PINS.base,
		conclusion: "success",
		path: run.path,
	};
}
export function assertArchiveDigest(bytes: Uint8Array) {
	if (
		bytes.length !== PINS.artifactBytes ||
		createHash("sha256").update(bytes).digest("hex") !== PINS.artifactDigest
	)
		throw new Error("base archive digest/size mismatch");
}
export function safeArchiveName(name: string) {
	if (
		!name ||
		name.startsWith("/") ||
		name.includes("\\") ||
		name.includes("\0") ||
		name.split("/").some((part) => part === ".." || part === ".") ||
		DRIVE_PREFIX.test(name)
	)
		throw new Error("unsafe archive member");
	return name.toLowerCase();
}
export function assertBundleFacts(value: {
	bundleId: string;
	executable: string;
	architectures: string[];
	jsAssets: { path: string; sha256: string }[];
}) {
	if (
		!BUNDLE_ID.test(value.bundleId) ||
		!value.executable ||
		value.executable.includes("/") ||
		value.executable === ".." ||
		!value.architectures.some(
			(arch) => arch === "arm64" || arch === "x86_64",
		) ||
		value.jsAssets.length === 0 ||
		value.jsAssets.some((asset) => !HASH.test(asset.sha256))
	)
		throw new Error(
			"missing/invalid actual simulator bundle or embedded JS identity",
		);
}
export function assertOwnedUdid(value: string) {
	if (!UDID.test(value)) throw new Error("invalid created simulator receipt");
	return value;
}
export function assertMaestroHelp(version: string, help: string) {
	if (
		!version.includes(PINS.maestro) ||
		!help.includes("--device") ||
		!help.includes("test") ||
		!help.includes("hierarchy")
	)
		throw new Error("pinned Maestro iOS driver/help prerequisite unavailable");
}

/** Preserve only observed geometry/font fields. A driver that exposes none is
 * reported as such, never replaced by source token sizes or guessed points. */
export function hierarchyFacts(text: string) {
	const observed: { field: string; value: unknown }[] = [];
	try {
		const walk = (value: unknown) => {
			if (Array.isArray(value)) {
				for (const child of value) walk(child);
				return;
			}
			if (!value || typeof value !== "object") return;
			for (const [field, child] of Object.entries(value)) {
				if (HIERARCHY_FIELD.test(field)) observed.push({ field, value: child });
				else walk(child);
			}
		};
		walk(JSON.parse(text));
	} catch {
		return {
			format: "non-JSON raw hierarchy retained",
			observed,
			geometryExposed: false,
			fontsExposed: false,
		};
	}
	return {
		format: "actual Maestro JSON fields, units unchanged",
		observed,
		geometryExposed: observed.some((item) => GEOMETRY_FIELD.test(item.field)),
		fontsExposed: observed.some((item) => FONT_FIELD.test(item.field)),
	};
}

/** Executable orchestration contract. A failed step throws before any later
 * producer; injected units exercise ordering without mDNS/VM/SDK side effects. */
export type ProofOperations = {
	preflight(): Promise<void>;
	setupBase(): Promise<void>;
	produceCandidate(): Promise<void>;
	candidateFlows(): Promise<void>;
	cleanup(): Promise<void>;
};
export async function runProof(stage: ProofStage, operations: ProofOperations) {
	let stageFailure: unknown;
	let stageDone = false;
	try {
		await operations.preflight();
		if (stage === "preflight") stageDone = true;
		else {
			await operations.setupBase();
			if (stage === "setup") stageDone = true;
			else {
				await operations.produceCandidate();
				await operations.candidateFlows();
				stageDone = true;
			}
		}
	} catch (error) {
		// Held, not swallowed: cleanup may itself fail, and the STAGE failure must
		// stay the primary one reported to a reader (CI 38845929163 reported
		// teardown while the real cause was a prerequisite deadline).
		stageFailure = error;
	}
	// Cleanup runs OUTSIDE `finally`: throwing from a finally block discards the
	// original completion (biome noUnsafeFinally), which is the very masking this
	// change exists to prevent. Composing here keeps both failures intact.
	let cleanupFailure: unknown;
	try {
		await operations.cleanup();
	} catch (error) {
		cleanupFailure = error;
	}
	if (stageFailure) {
		const primary =
			stageFailure instanceof Error
				? stageFailure.message
				: "targeted proof failed";
		const secondary =
			cleanupFailure instanceof Error ? cleanupFailure.message : cleanupFailure;
		throw new Error(
			cleanupFailure ? `${primary} (secondary) ${secondary}` : primary,
		);
	}
	if (cleanupFailure) throw cleanupFailure;
	if (!stageDone) throw new Error("targeted proof did not complete its stage");
}
