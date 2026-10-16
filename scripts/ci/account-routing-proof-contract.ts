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
export const STAGE_SECONDS: Record<ProofStage, number> = {
	preflight: 600,
	setup: 1200,
	full: 4500,
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
	// Every value below is a REAL elapsed from a real hosted run's commands.json,
	// read directly from the downloaded artifacts (runs 38840447956 preflight,
	// 38842647133, 38844597781, 38845929163, 38847064654). The F6 table this
	// replaces contained values that were never measured — `maestroSteady` 42/46s
	// and `list` 400ms have no artifact behind them at all, and `coreDoctor` named
	// an operation no call site bound. Fabricated samples are worse than missing
	// ones: the derivation would rest on them.
	//
	// `censored: true` marks a sample that was KILLED by the cap in force, not a
	// completed run. Its elapsed is a LOWER BOUND on the operation's true cost —
	// the child was cut off, so it needed at least this long. Treating such a
	// sample as a measurement is how a cap gets sized to the thing that killed it.
	nativeSource: [
		{ run: 38847064654, ms: 26 },
		{ run: 38845929163, ms: 19 },
		{ run: 38844597781, ms: 61 },
		{ run: 38842647133, ms: 32 },
		{ run: 38840447956, ms: 95 },
	],
	productByteFreeze: [
		{ run: 38847064654, ms: 17 },
		{ run: 38845929163, ms: 18 },
		{ run: 38844597781, ms: 54 },
		{ run: 38842647133, ms: 73 },
		{ run: 38840447956, ms: 37 },
	],
	baselineRouteValidator: [
		{ run: 38847064654, ms: 18 },
		{ run: 38845929163, ms: 33 },
		{ run: 38844597781, ms: 47 },
		{ run: 38842647133, ms: 35 },
		{ run: 38840447956, ms: 36 },
	],
	publicCoreClone: [{ run: 38840447956, ms: 1777 }],
	publicCorePin: [{ run: 38840447956, ms: 7475 }],
	publicCoreIdentity: [
		{ run: 38847064654, ms: 25 },
		{ run: 38845929163, ms: 8 },
		{ run: 38844597781, ms: 41 },
		{ run: 38842647133, ms: 15 },
		{ run: 38840447956, ms: 19 },
	],
	// The bootstrap's first run resolves the pinned checkout's metadata from the
	// index; the spread (0.5s warm-receipt to 22.8s cold) is the whole point of
	// keeping samples rather than one number.
	coreBaseBootstrap: [
		{ run: 38847064654, ms: 524 },
		{ run: 38845929163, ms: 505 },
		{ run: 38844597781, ms: 1827 },
		{ run: 38842647133, ms: 846 },
		{ run: 38840447956, ms: 22771 },
	],
	// 4.5-19.1s across four completed runs. A 55s literal used to bind this site.
	socketDoctor: [
		{ run: 38847064654, ms: 11243 },
		{ run: 38845929163, ms: 14076 },
		{ run: 38844597781, ms: 19106 },
		{ run: 38842647133, ms: 14673 },
	],
	artifactTests: [
		{ run: 38847064654, ms: 93 },
		{ run: 38845929163, ms: 98 },
		{ run: 38844597781, ms: 112 },
		{ run: 38842647133, ms: 115 },
	],
	inspectApp: [
		{ run: 38847064654, ms: 116 },
		{ run: 38845929163, ms: 146 },
		{ run: 38844597781, ms: 217 },
		{ run: 38842647133, ms: 204 },
		{ run: 38844597781, ms: 858 },
	],
	maestroVersion: [
		{ run: 38847064654, ms: 3566 },
		{ run: 38845929163, ms: 3999 },
		{ run: 38844597781, ms: 4749 },
		{ run: 38842647133, ms: 5550 },
	],
	maestroHelp: [
		{ run: 38847064654, ms: 3360 },
		{ run: 38845929163, ms: 2612 },
		{ run: 38844597781, ms: 3420 },
		{ run: 38842647133, ms: 4470 },
	],
	// The two `censored` samples are the ones that matter: this operation was
	// killed at a 60s cap (F3) and again at a 15s cap (F6). 60.034s is therefore a
	// LOWER bound on its true cold cost, and the derived cap must clear it — which
	// is why a flat 60s cold floor would have repeated the F3 failure.
	selector: [
		{ run: 38845929163, ms: 6107 },
		{ run: 38844597781, ms: 7267 },
		{ run: 38847064654, ms: 15019, censored: true },
		{ run: 38842647133, ms: 60034, censored: true },
	],
	installedSimulators: [
		{ run: 38845929163, ms: 354 },
		{ run: 38844597781, ms: 261 },
	],
	create: [
		{ run: 38845929163, ms: 344 },
		{ run: 38844597781, ms: 296 },
	],
	boot: [
		{ run: 38845929163, ms: 2832 },
		{ run: 38844597781, ms: 2419 },
	],
	// 91.7s and 92.6s, both completed with rc0: this is a genuine measurement, not
	// the censored kill that run 38845929163 also recorded for it.
	bootReady: [
		{ run: 38844597781, ms: 92562 },
		{ run: 38845929163, ms: 91663 },
	],
	install: [{ run: 38844597781, ms: 24619 }],
	// Killed at the 120s steady cap: a lower bound on the cold driver bring-up.
	maestroCold: [{ run: 38844597781, ms: 121921, censored: true }],
	// F5 capped teardown at 20s and both were killed there; the 14985/454 samples
	// are completed runs under a larger cap.
	shutdown: [
		{ run: 38844597781, ms: 14985 },
		{ run: 38845929163, ms: 23349, censored: true },
	],
	delete: [
		{ run: 38844597781, ms: 454 },
		{ run: 38845929163, ms: 22002, censored: true },
	],
	installedContainer: [{ run: 38844597781, ms: 6590 }],
	inspectInstalled: [{ run: 38844597781, ms: 858 }],
} as const;

/** Heavy PRODUCER steps that have never run in a recorded setup/preflight run, so
 * they have no observations to derive from. These keep their existing documented
 * stage budgets, labelled as budgets rather than measurements — recording a cap
 * as an "observation" would be fabricating the very data the derivation rests on.
 * When a real full run records them, they move into OPERATION_OBSERVATIONS. */
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

/** Operations whose FIRST call of a run pays a cold, unoutputted start
 * (CoreSimulator launch, XCUITest driver bring-up). These get a floor with real
 * headroom on top of the derived cap, because the tail of a cold start is not
 * bounded by the samples in front of it. */
export const COLD_OPERATIONS: Partial<Record<BoundedOperation, number>> = {
	selector: 60,
	bootReady: 300,
	maestroCold: 300,
	// Teardown of a JUST-BOOTED simulator is the same cold service as the selector
	// (the manager's own classification: "shutdown/delete after a boot"). Without a
	// floor the derivation gives 36s/34s against 23.3s/22.0s observations — barely
	// above 1.5x, i.e. exactly the thin margin that broke the selector at F6.
	shutdown: 60,
	delete: 60,
};

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
 * An evidence flow is allowed 120s once the driver is warm. No artifact sample
 * exists for a warm flow — the only steady flow ever attempted (run 38844597781,
 * 121.9s) was the COLD one and was killed by this very budget — so deriving it
 * from data would mean inventing a sample. It is a labelled policy value, and the
 * cold cap is required to exceed it so a cold cost cannot hide behind it. */
export const STEADY_FLOW_CAP_SECONDS = 120;

/** Headroom over the largest observation. 1.5x, not 1.05x: a cap is a bound on
 * the NEXT run, and the next run is drawn from the same heavy-tailed cost the
 * samples came from. */
export const OBSERVED_HEADROOM = 1.5;

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

/** True when the sample that decides the cap was itself killed by a cap, i.e. the
 * derived bound rests on a lower bound rather than a completed measurement. */
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
	headroom = OBSERVED_HEADROOM,
	samples: readonly { run: number; ms: number }[] = OPERATION_OBSERVATIONS[
		operation
	],
) {
	if (samples.length === 0) throw new Error(`no observations for ${operation}`);
	const maxSeconds = Math.max(...samples.map((sample) => sample.ms)) / 1000;
	const derived = Math.ceil(maxSeconds * headroom);
	return Math.max(
		derived,
		OPERATION_MINIMUM_SECONDS[operation] ?? 0,
		COLD_OPERATIONS[operation] ?? 0,
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
		headroom: OBSERVED_HEADROOM,
		coldFloorSeconds: COLD_OPERATIONS[operation] ?? null,
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
