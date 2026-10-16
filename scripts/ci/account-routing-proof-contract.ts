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
	try {
		await operations.preflight();
		if (stage === "preflight") return;
		await operations.setupBase();
		if (stage === "setup") return;
		await operations.produceCandidate();
		await operations.candidateFlows();
	} finally {
		await operations.cleanup();
	}
}
