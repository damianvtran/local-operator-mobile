#!/usr/bin/env node
/** Manual, staged, hosted-CI native evidence producer. Importing is inert.
 * Local source tests exercise injected operations and pure boundary guards; no
 * laptop mDNS/simulator/SDK execution is permitted by this entry point.
 */
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { accountRoutingSchema } from "../../src/contracts/schemas.ts";
import { accountRoutingCopy as copy } from "../../src/features/settings/account-routing-copy.ts";
import { CONTROL, REGION, SCREEN } from "../../src/ui/a11y.ts";
import {
	type CanonicalPolicyFixture,
	createCanonicalPolicyFixture,
} from "../../tools/mock-relay/account-routing.ts";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import {
	assertArchiveDigest,
	assertArtifactMetadata,
	assertBaseRun,
	assertBundleFacts,
	assertLoopbackAnswers,
	assertMaestroHelp,
	assertNativeOrigin,
	assertOwnedUdid,
	assertProofCI,
	type BoundedOperation,
	capDerivation,
	capFor,
	FROZEN_PATHS,
	hierarchyFacts,
	mdnsCommand,
	PINS,
	PRODUCER_BUDGET_SECONDS,
	type ProofStage,
	runProof,
	STAGE_SECONDS,
	STEADY_FLOW_CAP_SECONDS,
	selectProof,
	UNOBSERVED_BUDGET_SECONDS,
} from "./account-routing-proof-contract.ts";
import * as flows from "./account-routing-proof-flows.ts";
import {
	type Lease,
	ProofHost,
	tolerableTeardown,
} from "./account-routing-proof-host.ts";

type Bundle = {
	app: string;
	bundleId: string;
	executable: string;
	architectures: string[];
	jsAssets: {
		path: string;
		sha256: string;
		marker_matches: Record<string, boolean>;
	}[];
	executableSha256: string;
	version: string;
	build: string;
};
type Slot = {
	fixture: CanonicalPolicyFixture;
	relay: ReturnType<typeof createRelay>;
	origin: string;
	port: number;
	mdns: Lease;
};
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");
const UDID_LINE = /^udid=(.+)$/m;
const WORKSPACE_LINE = /^workspace=(.+)$/m;
const SCHEME_LINE = /^scheme=(.+)$/m;
export const DERIVED_OPS = [
	"selector",
	"bootReady",
	"shutdown",
	"delete",
	"install",
	"boot",
	"installedSimulators",
	"create",
	"coldAppLaunch",
	"maestroCold",
] as const;
const markers = [
	REGION.settingsAccountRouting,
	"mobile.account_routing.reload",
];

export class NativeProof {
	readonly slots = new Map<"a" | "b", Slot>();
	readonly receipt: Record<string, unknown>;
	private core = "";
	private python = "";
	private baseline: Bundle | undefined;
	private candidate: Bundle | undefined;
	private udid: string | undefined;
	/** The first Maestro invocation of a stage pays driver bring-up. */
	private maestroWarm = false;
	private frames = 0;
	private readonly secret = randomUUID();
	readonly host: ProofHost;
	readonly root: string;
	readonly cwd: string;
	readonly stage: ProofStage;
	constructor(root: string, cwd: string, stage: ProofStage, env = process.env) {
		this.root = root;
		this.cwd = cwd;
		this.stage = stage;
		assertProofCI(env);
		const elapsed = Math.max(
			0,
			(Date.now() - Number(env.LOH12_PROOF_STARTED_AT ?? Date.now())) / 1000,
		);
		this.host = new ProofHost(
			root,
			cwd,
			STAGE_SECONDS[stage] - elapsed - 120,
			[this.secret, env.GITHUB_TOKEN ?? ""],
			env,
		);
		this.receipt = {
			kind: "targeted-native-evidence-NOT-full-E2E",
			// Data-driven: each cap records its samples, the max used and the
			// resulting seconds, so no bound is a hand-written number.
			capDerivations: DERIVED_OPS.map(capDerivation),
			stage,
			source: env.GITHUB_SHA,
			productSource: PINS.product,
			baseSource: PINS.base,
			beforeArtifact: PINS.artifactId,
			startedAt: new Date().toISOString(),
			dimensions: {
				RTL: "not exercised; no RTL eligibility claim",
				fonts:
					"actual hierarchy attributes when exposed, never inferred from source",
				textScale: "actual app200% flow",
				platform: "iOS shared RN only; Android runtime not claimed",
			},
		};
	}
	private save() {
		writeFileSync(
			join(this.root, "proof.json"),
			JSON.stringify(this.receipt, null, 2),
		);
	}
	private async github(path: string, binary = false) {
		const response = await fetch(
			`https://api.github.com/repos/${PINS.repository}/${path}`,
			{
				headers: {
					accept: binary
						? "application/vnd.github+json"
						: "application/vnd.github+json",
					...(process.env.GITHUB_TOKEN
						? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
						: {}),
				},
				signal: AbortSignal.timeout(60000),
			},
		);
		if (!response.ok)
			throw new Error(
				`public pinned artifact request failed HTTP${response.status}`,
			);
		if (!binary) return response.json();
		if (!response.body) throw new Error("base archive response has no body");
		const chunks: Uint8Array[] = [];
		let size = 0;
		for await (const chunk of response.body) {
			size += chunk.length;
			if (size > PINS.artifactBytes)
				throw new Error("archive exceeds pinned byte bound");
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	}
	async preflight() {
		const head = (
			await this.host.run(
				"native-source",
				"git",
				["rev-parse", "HEAD"],
				capFor("nativeSource"),
			)
		).trim();
		if (head !== process.env.GITHUB_SHA)
			throw new Error("checked-out candidate differs from workflow SHA");
		await this.host.run(
			"product-byte-freeze",
			"git",
			["diff", "--exit-code", PINS.product, "HEAD", "--", ...FROZEN_PATHS],
			capFor("productByteFreeze"),
		);
		const baselineValidator = await this.host.run(
			"baseline-route-validator",
			"git",
			["show", `${PINS.base}:src/connection/profile.ts`],
			capFor("baselineRouteValidator"),
		);
		if (
			hash(baselineValidator) !==
			hash(readFileSync(join(this.cwd, "src/connection/profile.ts")))
		)
			throw new Error("BASE and candidate public route validators differ");
		this.core = join(this.root, "core-c1");
		if (!existsSync(this.core)) {
			await this.host.run(
				"public-core-clone",
				"git",
				[
					"clone",
					"--no-checkout",
					"--filter=blob:none",
					"https://github.com/damianvtran/local-operator.git",
					this.core,
				],
				PRODUCER_BUDGET_SECONDS.coreClone,
			);
			await this.host.run(
				"public-core-pin",
				"git",
				["-C", this.core, "checkout", "--detach", PINS.core],
				PRODUCER_BUDGET_SECONDS.corePin,
			);
		}
		const coreHead = (
			await this.host.run(
				"public-core-identity",
				"git",
				["-C", this.core, "rev-parse", "HEAD"],
				capFor("publicCoreIdentity"),
			)
		).trim();
		if (coreHead !== PINS.core) throw new Error("stale public Core checkout");
		await this.host.run(
			"core-base-bootstrap",
			"python3",
			["scripts/ci/account-routing-bootstrap.py", this.core, this.root],
			PRODUCER_BUDGET_SECONDS.coreBootstrapInstall,
		);
		const bootstrap: unknown = JSON.parse(
			readFileSync(join(this.root, "core-bootstrap.json"), "utf8"),
		);
		if (
			!record(bootstrap) ||
			bootstrap.baseCount !== 23 ||
			bootstrap.core !== PINS.core ||
			typeof bootstrap.python !== "string"
		)
			throw new Error("missing actual23-base dependency resolution receipt");
		this.python = bootstrap.python;
		this.receipt.coreBootstrap = bootstrap;
		const fixtureEnv = {
			...this.host.env,
			LOH12_CORE_ROOT: this.core,
			LOH12_CORE_PYTHON: this.python,
		};
		Object.assign(process.env, fixtureEnv);
		await this.host.run(
			"canonical-source-socket-doctor",
			"node",
			["tools/mock-relay/verify-account-routing.ts"],
			capFor("socketDoctor"),
			fixtureEnv,
		);
		await this.host.run(
			"archive-boundary-tests",
			this.python,
			["scripts/ci/account-routing-artifact-test.py"],
			capFor("artifactTests"),
		);
		this.receipt.artifact = assertArtifactMetadata(
			await this.github(`actions/artifacts/${PINS.artifactId}`),
		);
		this.receipt.baseProducer = assertBaseRun(
			await this.github(`actions/runs/${PINS.runId}`),
		);
		const zip = join(this.root, "exact-base.zip");
		if (!existsSync(zip))
			writeFileSync(
				zip,
				await this.github(`actions/artifacts/${PINS.artifactId}/zip`, true),
			);
		assertArchiveDigest(readFileSync(zip));
		const extraction = join(this.root, "base-extracted");
		if (!existsSync(extraction)) {
			const result = await this.host.run(
				"base-safe-extraction",
				this.python,
				[
					"scripts/ci/account-routing-artifact.py",
					"extract",
					zip,
					extraction,
					...markers,
				],
				UNOBSERVED_BUDGET_SECONDS.baseExtraction,
			);
			writeFileSync(join(this.root, "base-bundle.json"), result);
		}
		const cachedBase: unknown = JSON.parse(
			readFileSync(join(this.root, "base-bundle.json"), "utf8"),
		);
		if (!record(cachedBase) || typeof cachedBase.app !== "string")
			throw new Error("invalid base extraction receipt");
		this.baseline = await this.inspectedApp(
			cachedBase.app,
			"base-fresh-identity",
		);
		if (!this.baseline) throw new Error("base bundle receipt missing");
		assertBundleFacts(this.baseline);
		if (
			this.baseline.jsAssets.some((asset) =>
				Object.values(asset.marker_matches).some(Boolean),
			)
		)
			throw new Error(
				"before artifact unexpectedly carries candidate feature markers",
			);
		this.receipt.baseline = this.baseline;
		for (const profile of ["a", "b"] as const) await this.startSlot(profile);
		this.receipt.preflight =
			"PASS actual canonical/source-counter/artifact/validator/mDNS/DNS/auth prerequisites; no simulator or candidate compile";
		this.save();
	}
	private async startSlot(profile: "a" | "b") {
		const fixture = createCanonicalPolicyFixture({
			python: this.python,
			coreRoot: this.core,
			privateRoot: join(this.root, `native-slot-${profile}`),
			profile,
			transport: "ci-native-mdns",
		});
		const relay = createRelay({
			accountRouting: fixture,
			password: this.secret,
		});
		const listener = await relay.listen();
		const origin = assertNativeOrigin(
			fixture.hostname,
			fixture.cookieName,
			listener.port,
			"ci-native-mdns",
		);
		let publication: Awaited<ReturnType<ProofHost["start"]>>;
		try {
			publication = await this.host.start(
				`owned-bonjour-${profile}`,
				"/usr/bin/dns-sd",
				mdnsCommand(fixture.hostname, fixture.cookieName, listener.port),
			);
		} catch (error) {
			await relay.shutdown();
			throw error;
		}
		// Convert async publisher errors into an explicit prerequisite failure;
		// an unhandled rejection must not bypass owned-resource cleanup.
		let publisherExited = false;
		void publication.done.then(
			() => {
				publisherExited = true;
			},
			() => {
				publisherExited = true;
			},
		);
		const slot = {
			fixture,
			relay,
			origin,
			port: listener.port,
			mdns: publication.lease,
		};
		this.slots.set(profile, slot);
		let resolved = false;
		for (let attempt = 0; attempt < 30; attempt++) {
			if (publisherExited || publication.lease.child.exitCode !== null)
				throw new Error("owned Bonjour publisher exited before DNS proof");
			try {
				assertLoopbackAnswers(
					(
						await Promise.race([
							lookup(fixture.hostname, { all: true }),
							sleep(2000).then(() => {
								throw new Error("owned OS DNS deadline exceeded");
							}),
						])
					).map((row) => row.address),
				);
				resolved = true;
				break;
			} catch {
				await sleep(250);
			}
		}
		if (!resolved)
			throw new Error(
				"owned unique .local did not resolve; no fallback or candidate SDK dispatch",
			);
		const unauthorized = await fetch(`${origin}/api/settings/account-routing`, {
			signal: AbortSignal.timeout(5000),
		});
		if (unauthorized.status !== 401 || unauthorized.headers.has("set-cookie"))
			throw new Error("native hostname auth boundary failed");
		const wrong = await fetch(`${origin}/login`, {
			method: "POST",
			body: new URLSearchParams(
				Object.fromEntries([["password", `${this.secret}-wrong`]]),
			),
			redirect: "manual",
			signal: AbortSignal.timeout(5000),
		});
		if (wrong.status !== 401)
			throw new Error("actual wrong-password control failed");
		const login = await fetch(`${origin}/login`, {
			method: "POST",
			body: new URLSearchParams(
				Object.fromEntries([["password", this.secret]]),
			),
			redirect: "manual",
			signal: AbortSignal.timeout(5000),
		});
		const header = login.headers.get("set-cookie") ?? "";
		const cookie = header.split(";", 1)[0] ?? "";
		const attrs = header
			.split(";")
			.slice(1)
			.map((part) => part.trim().toLowerCase());
		if (
			login.status !== 303 ||
			!cookie.startsWith(`${fixture.cookieName}=`) ||
			attrs.some((part) => part.startsWith("domain=")) ||
			!attrs.includes("path=/") ||
			!attrs.includes("httponly")
		)
			throw new Error("private host-only cookie namespace/attributes failed");
		this.host.secrets.push(cookie.slice(fixture.cookieName.length + 1));
		const request = (
			method: string,
			body?: unknown,
			requestOrigin = origin,
			requestCookie = cookie,
		) =>
			fetch(`${origin}/api/settings/account-routing`, {
				method,
				headers: Object.fromEntries([
					["cookie", requestCookie],
					["origin", requestOrigin],
					["content-type", "application/json"],
				]),
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(5000),
			});
		if (
			(await request("GET")).status !== 200 ||
			(
				await request(
					"PATCH",
					{ value: "invalid-source-counterfixture" },
					"https://refused.invalid",
				)
			).status !== 403
		)
			throw new Error("native transport operator/origin auth boundary failed");
		const before = accountRoutingSchema.parse(
			(await fixture.respond("GET", undefined)).body,
		).setting.value;
		if (
			(await request("PATCH", { value: "invalid-source-counterfixture" }))
				.status !== 422 ||
			accountRoutingSchema.parse((await fixture.respond("GET", undefined)).body)
				.setting.value !== before
		)
			throw new Error(
				"native transport invalid-write/persistence counterfixture failed",
			);
		if (
			(
				await request(
					"GET",
					undefined,
					origin,
					"lop_mobile=synthetic-parent-domain-collision",
				)
			).status !== 401 ||
			(
				await request(
					"GET",
					undefined,
					origin,
					`${cookie}; ${fixture.cookieName}=synthetic-parent-domain-collision`,
				)
			).status !== 401
		)
			throw new Error(
				"production/duplicate-parent-domain cookie collision guard failed",
			);
		this.receipt[`slot${profile}`] = {
			...fixture.identity,
			origin,
			ownedBonjourPid: publication.lease.pid,
			actualOSDNS: "loopback-only",
			cookieScope: { domain: null, path: "/", hostOnly: true },
			observedAt: new Date().toISOString(),
			unauthenticatedHTTP: unauthorized.status,
			wrongPasswordHTTP: wrong.status,
			originRefusedHTTP: 403,
			invalidWriteHTTP: 422,
			cookieCollisionHTTP: 401,
		};
	}
	private slot(profile: "a" | "b") {
		const value = this.slots.get(profile);
		if (!value) throw new Error("missing owned slot");
		return value;
	}
	/** Pay the cold driver bring-up OUTSIDE the evidence flows.
	 *
	 * The repository's own Android playbook already does this
	 * (docs/e2e/ci-notes.md §"Native E2E": a readiness gate plus one launch of the
	 * installed app "so the first flow does not carry the cold start"), and there
	 * was no iOS equivalent: the first iOS flow paid the XCUITest driver install
	 * and boot with no output, then hit the steady 120s budget (CI 38844597781,
	 * 123170ms, empty log). The warm-up is diagnosed as its own step under its own
	 * COLD cap, so a driver that genuinely never comes up is a named
	 * `deadline exceeded` here rather than a mystery inside the first evidence
	 * flow. It uses the real driver-touch command (hierarchy) and does not walk or
	 * fake any policy state.
	 */
	private async warmDriver() {
		if (!this.udid || !this.baseline)
			throw new Error("cannot warm an uninstalled driver");
		await this.host.run(
			"warm-launch-base-app",
			"xcrun",
			["simctl", "launch", this.udid, this.baseline.bundleId],
			capFor("selector"),
		);
		const driver = await this.host.run(
			"warm-maestro-driver",
			"maestro",
			["--device", this.udid, "hierarchy"],
			capFor("maestroCold"),
		);
		this.maestroWarm = true;
		// A READINESS GATE, not just a driver touch: the same practice the repo
		// documents for Android ("launch the installed app once so the first flow
		// does not carry the cold start"). F4 warmed the DRIVER; run 38853165349
		// showed the first flow still carried the APP's cold launch and lost its
		// opening assertion to a steady 15s wait. Requiring the app's own first
		// screen to be visible in the warm hierarchy means the first evidence flow
		// starts from a PROVEN-drawn state, and it is read from the real hierarchy
		// rather than assumed — the flow still does its own clearState launch and
		// its own assertion, unweakened.
		// A freshly launched app draws the Welcome screen (measured: its identifiers
		// are present in the warm hierarchy of run 38853165349). Requiring one of the
		// real identifiers means the first evidence flow starts from a proven-drawn
		// state instead of a hoped-for one.
		const warmShows = [SCREEN.welcome, SCREEN.home];
		if (!warmShows.some((id) => driver.includes(id)))
			throw new Error(
				"warm driver did not show a drawn app screen before the first evidence flow",
			);
		this.receipt.driverWarmUp =
			"PASS actual simctl launch + driver hierarchy showing a drawn app screen before the first evidence flow";
	}
	private async flow(
		name: string,
		commands: flows.NativeStep[],
		profile: "a" | "b" = "a",
	) {
		if (!this.udid || !this.baseline)
			throw new Error("native driver not set up");
		const label = `${++this.frames}-${name.replaceAll(/[^a-z0-9_-]/gi, "_").slice(0, 90)}`;
		const file = join(this.root, `flow-${label}.yaml`);
		const config = join(this.root, `flow-${label}-config.yaml`);
		mkdirSync(join(this.root, "frames"), { recursive: true });
		mkdirSync(join(this.root, "hierarchies"), { recursive: true });
		const scoped = commands.map((step) =>
			typeof step.takeScreenshot === "string"
				? {
						...step,
						takeScreenshot: join(
							this.root,
							"frames",
							`${label}-${step.takeScreenshot}`,
						),
					}
				: step,
		);
		writeFileSync(
			file,
			`appId: ${this.baseline.bundleId}\n---\n${JSON.stringify(scoped, null, 2)}\n`,
		);
		writeFileSync(config, JSON.stringify({ flows: [`flow-${label}.yaml`] }));
		// Cold vs steady: the FIRST Maestro call of a stage pays XCUITest driver
		// bring-up, so it takes the cold cap; later flows stay on the steady one.
		const cap = this.maestroWarm
			? STEADY_FLOW_CAP_SECONDS
			: capFor("maestroCold");
		this.maestroWarm = true;
		await this.host.run(
			`maestro-${label}`,
			"maestro",
			[
				"--device",
				this.udid,
				"test",
				"--config",
				config,
				"-e",
				`APP_ID=${this.baseline.bundleId}`,
				"-e",
				`RELAY_URL=${this.slot(profile).origin}`,
				"-e",
				`RELAY_PASSWORD=${this.secret}`,
				"--test-output-dir",
				join(this.root, "frames"),
				file,
			],
			cap,
		);
		const hierarchy = await this.host.run(
			`hierarchy-${name}`,
			"maestro",
			["--device", this.udid, "hierarchy"],
			UNOBSERVED_BUDGET_SECONDS.hierarchy,
		);
		writeFileSync(join(this.root, "hierarchies", `${label}.txt`), hierarchy);
		writeFileSync(
			join(this.root, "hierarchies", `${label}-observed.json`),
			JSON.stringify(hierarchyFacts(hierarchy), null, 2),
		);
		// Retain the real accessibility/bounds/font payload, never fabricate a
		// geometry model from source. Unsupported hierarchy stops the lane.
		if (!hierarchy.includes("bounds") && !hierarchy.includes("frame"))
			throw new Error("actual native geometry unavailable in driver hierarchy");
	}
	private async inspectedApp(app: string, name: string) {
		const value: unknown = JSON.parse(
			await this.host.run(
				`inspect-${name}`,
				this.python,
				["scripts/ci/account-routing-artifact.py", "inspect", app, ...markers],
				capFor("inspectApp"),
			),
		);
		if (!record(value)) throw new Error("invalid actual bundle identity");
		const bundle = value as Bundle;
		assertBundleFacts(bundle);
		return bundle;
	}
	private async installedMatches(bundle: Bundle, name: string) {
		if (!this.udid) throw new Error("no owned simulator");
		const path = (
			await this.host.run(
				`installed-container-${name}`,
				"xcrun",
				["simctl", "get_app_container", this.udid, bundle.bundleId, "app"],
				capFor("installedContainer"),
			)
		).trim();
		const installed = await this.inspectedApp(path, `installed-${name}`);
		if (
			installed.executableSha256 !== bundle.executableSha256 ||
			JSON.stringify(installed.jsAssets) !== JSON.stringify(bundle.jsAssets)
		)
			throw new Error("installed embedded JS differs from inspected artifact");
		this.receipt[`installed${name}`] = installed;
	}
	async setupBase() {
		if (!this.baseline) throw new Error("artifact preflight absent");
		const version = await this.host.run(
			"maestro-version",
			"maestro",
			["--version"],
			capFor("maestroVersion"),
		);
		const help = await this.host.run(
			"maestro-help",
			"maestro",
			["--help"],
			capFor("maestroHelp"),
		);
		assertMaestroHelp(version, help);
		// The selector shells out to the FIRST `simctl` of this stage, which on a
		// cold runner starts CoreSimulator and can take minutes.
		const selection = await this.host.run(
			"existing-simulator-selector",
			"node",
			["scripts/ci/ios-simulator.ts", "--prefer", "iPhone 17"],
			capFor("selector"),
		);
		const selected = UDID_LINE.exec(selection)?.[1];
		if (!selected) throw new Error("existing simulator selector gave no UDID");
		const devices: unknown = JSON.parse(
			await this.host.run(
				"installed-simulators",
				"xcrun",
				["simctl", "list", "devices", "available", "--json"],
				capFor("installedSimulators"),
			),
		);
		if (!record(devices) || !record(devices.devices))
			throw new Error("installed runtime metadata unavailable");
		let runtime: string | undefined;
		let deviceType: string | undefined;
		for (const [key, rows] of Object.entries(devices.devices))
			if (Array.isArray(rows))
				for (const row of rows)
					if (
						record(row) &&
						row.udid === selected &&
						typeof row.deviceTypeIdentifier === "string"
					) {
						runtime = key;
						deviceType = row.deviceTypeIdentifier;
					}
		if (!runtime || !deviceType)
			throw new Error(
				"existing device/runtime metadata not sufficient; do not install anything",
			);
		this.udid = assertOwnedUdid(
			(
				await this.host.run(
					"create-owned-simulator",
					"xcrun",
					["simctl", "create", `LOH12-${randomUUID()}`, deviceType, runtime],
					capFor("create"),
				)
			).trim(),
		);
		this.receipt.simulator = {
			udid: this.udid,
			runtime,
			deviceType,
			freshOwned: true,
		};
		await this.host.run(
			"boot-owned-simulator",
			"xcrun",
			["simctl", "boot", this.udid],
			capFor("boot"),
		);
		await this.host.run(
			"owned-boot-ready",
			"xcrun",
			["simctl", "bootstatus", this.udid, "-b"],
			// Measured 92.6s / 91.7s across two real runs; the old 90 was BELOW
			// the distribution and killed a healthy cold boot (CI 38845929163).
			capFor("bootReady"),
		);
		await this.host.run(
			"install-exact-base",
			"xcrun",
			["simctl", "install", this.udid, this.baseline.app],
			capFor("install"),
		);
		await this.installedMatches(this.baseline, "Base");
		await this.warmDriver();
		const before = this.slot("a").fixture.wireTrace.length;
		await this.flow(
			"base-real-form",
			flows.connectSettings(
				// The PROOF-OWNED iOS variant, not the base helper: the base
				// helper's `hideKeyboard` steps are Android-only and Maestro 2.11.0
				// rejects them on iOS (run 38854849272 walked the real path, then
				// failed there). Same ids, waits, opt-in and Connected verdict; the
				// base asset is untouched so the Android lane keeps what it verifies.
				join(
					this.cwd,
					"e2e/maestro/account-routing-proof/connect-relay-ios.yaml",
				),
			),
		);
		const wire = this.slot("a").fixture.wireTrace.slice(before);
		if (
			!wire.some((entry) => entry.path === "/login" && entry.status === 303) ||
			!wire.some(
				(entry) =>
					entry.path === "/api/sessions" &&
					entry.status === 200 &&
					entry.ownCookie,
			) ||
			wire.some((entry) => entry.unexpectedCookieNames.length)
		)
			throw new Error(
				"BASE actual form/OS jar did not authenticate exclusively with owned cookies",
			);
		// Prove driver gesture/selector support before expensive candidate SDK work.
		await this.flow("base-gesture-smoke", [
			...flows.theme("light"),
			{ doubleTapOn: { id: CONTROL.settingsThemeLight } },
		]);
		for (const mode of ["light", "dark"] as const)
			await this.flow(`base-${mode}`, flows.baselineSettings(mode));
		this.receipt.setup =
			"PASS exact BASE real form/OS jar/connected Settings BEFORE light+dark; candidate not compiled";
		this.save();
	}
	async produceCandidate() {
		if (!this.udid || !this.receipt.setup)
			throw new Error("candidate SDK forbidden before successful BASE setup");
		writeFileSync(
			join(this.root, ".candidate-producer-started"),
			JSON.stringify({
				source: process.env.GITHUB_SHA,
				at: new Date().toISOString(),
			}),
			{ flag: "wx", mode: 0o600 },
		);
		const versionFile = join(this.root, "version.env");
		await this.host.run(
			"candidate-ref-version",
			"node",
			["scripts/ci/version.ts", "--write"],
			UNOBSERVED_BUDGET_SECONDS.candidateRefVersion,
			{
				GITHUB_ENV: versionFile,
				GITHUB_OUTPUT: join(this.root, "candidate-version-outputs"),
			},
		);
		const versionEnv = Object.fromEntries(
			readFileSync(versionFile, "utf8")
				.trim()
				.split("\n")
				.map((line) => {
					const i = line.indexOf("=");
					return [line.slice(0, i), line.slice(i + 1)];
				}),
		);
		await this.host.run(
			"candidate-prebuild",
			"pnpm",
			[
				"exec",
				"expo",
				"prebuild",
				"--platform",
				"ios",
				"--clean",
				"--no-install",
			],
			PRODUCER_BUDGET_SECONDS.expoPrebuild,
			versionEnv,
		);
		await this.host.run(
			"pre-pods-determinism-snapshot",
			"/bin/cp",
			["-R", "ios", join(this.root, "ios-built")],
			PRODUCER_BUDGET_SECONDS.checkoutSnapshot,
		);
		await this.host.run(
			"candidate-pods",
			"pod",
			["install", "--project-directory=ios"],
			PRODUCER_BUDGET_SECONDS.podInstall,
		);
		const project = await this.host.run(
			"existing-workspace-resolver",
			"node",
			["scripts/ci/ios-project.ts", "--root", "ios"],
			UNOBSERVED_BUDGET_SECONDS.workspaceResolver,
		);
		const workspace = WORKSPACE_LINE.exec(project)?.[1];
		const scheme = SCHEME_LINE.exec(project)?.[1];
		if (!workspace || !scheme)
			throw new Error("existing iOS workspace/scheme resolver failed");
		await this.host.run(
			"candidate-release-producer-ONCE",
			"xcodebuild",
			[
				"-workspace",
				workspace,
				"-scheme",
				scheme,
				"-configuration",
				"Release",
				"-destination",
				`platform=iOS Simulator,id=${this.udid}`,
				"-derivedDataPath",
				join(this.root, "DerivedData"),
				"CODE_SIGNING_ALLOWED=NO",
				"build",
			],
			PRODUCER_BUDGET_SECONDS.xcodebuild,
			versionEnv,
		);
		const products = join(
			this.root,
			"DerivedData/Build/Products/Release-iphonesimulator",
		);
		const apps = readdirSync(products).filter((name) => name.endsWith(".app"));
		if (apps.length !== 1 || !apps[0])
			throw new Error(
				"candidate producer did not yield exactly one simulator app",
			);
		this.candidate = await this.inspectedApp(
			join(products, apps[0]),
			"candidate",
		);
		if (
			this.candidate.bundleId !== this.baseline?.bundleId ||
			markers.some(
				(marker) =>
					!this.candidate?.jsAssets.some(
						(asset) => asset.marker_matches[marker],
					),
			)
		)
			throw new Error(
				"candidate actual bundle/JS does not carry current product feature",
			);
		if (
			this.candidate.version !== versionEnv.LOCAL_OPERATOR_MOBILE_VERSION ||
			this.candidate.build !== versionEnv.LOCAL_OPERATOR_MOBILE_VERSION_CODE
		)
			throw new Error("ref version did not reach actual candidate Info.plist");
		const infoJson = join(this.root, "candidate-info.json");
		await this.host.run(
			"candidate-actual-plist-json",
			"plutil",
			[
				"-convert",
				"json",
				"-o",
				infoJson,
				join(this.candidate.app, "Info.plist"),
			],
			UNOBSERVED_BUDGET_SECONDS.plistJson,
		);
		await this.host.run(
			"candidate-native-config",
			"node",
			["scripts/ci/native-config.ts", "ios", infoJson],
			UNOBSERVED_BUDGET_SECONDS.nativeConfig,
		);
		await this.host.run(
			"candidate-prebuild-again",
			"pnpm",
			[
				"exec",
				"expo",
				"prebuild",
				"--platform",
				"ios",
				"--clean",
				"--no-install",
			],
			PRODUCER_BUDGET_SECONDS.expoPrebuild,
			versionEnv,
		);
		await this.host.run(
			"candidate-determinism",
			"node",
			[
				"scripts/ci/prebuild-determinism.ts",
				"--built",
				join(this.root, "ios-built"),
				"--regenerated",
				"ios",
			],
			UNOBSERVED_BUDGET_SECONDS.determinism,
		);
		await this.host.run(
			"install-candidate",
			"xcrun",
			["simctl", "install", this.udid, this.candidate.app],
			UNOBSERVED_BUDGET_SECONDS.installCandidate,
		);
		await this.installedMatches(this.candidate, "Candidate");
		this.receipt.candidate = this.candidate;
		this.save();
	}
	async candidateFlows() {
		if (!this.candidate) throw new Error("no inspected candidate");
		const a = this.slot("a");
		const b = this.slot("b");
		await this.flow(
			"candidate-real-form",
			flows.connectSettings(
				// The PROOF-OWNED iOS variant, not the base helper: the base
				// helper's `hideKeyboard` steps are Android-only and Maestro 2.11.0
				// rejects them on iOS (run 38854849272 walked the real path, then
				// failed there). Same ids, waits, opt-in and Connected verdict; the
				// base asset is untouched so the Android lane keeps what it verifies.
				join(
					this.cwd,
					"e2e/maestro/account-routing-proof/connect-relay-ios.yaml",
				),
			),
		);
		const projection = await a.fixture.respond("GET", undefined);
		const policy = accountRoutingSchema.parse(projection.body);
		if (policy.setting.choices.length !== 3)
			throw new Error(
				"expected three ACTUAL backend choices, not a copied phone table",
			);
		for (const choice of [
			...policy.setting.choices.filter(
				(item) => item.value !== policy.setting.value,
			),
			...policy.setting.choices.filter(
				(item) => item.value === policy.setting.value,
			),
		]) {
			const current = await a.fixture.respond("GET", undefined);
			if (
				record(current.body) &&
				record(current.body.setting) &&
				current.body.setting.value === choice.value
			)
				continue;
			const before = a.fixture.trace.filter(
				(entry) => entry.method === "PATCH",
			).length;
			await this.flow("draft", flows.choose(choice.value));
			if (
				a.fixture.trace.filter((entry) => entry.method === "PATCH").length !==
				before
			)
				throw new Error("native draft unexpectedly wrote");
			a.fixture.controls.holdWrites = true;
			await this.flow("duplicate-pending-press", flows.savePending());
			if (a.fixture.pendingResponses() !== 1)
				throw new Error(
					"duplicate gesture did not create exactly one actual in-flight request",
				);
			a.fixture.controls.holdWrites = false;
			a.fixture.releaseHeld();
			await this.flow("saved", flows.saved(choice.value));
			const writes = a.fixture.trace.filter(
				(entry) => entry.method === "PATCH",
			);
			const fresh = accountRoutingSchema.parse(
				(await a.fixture.respond("GET", undefined)).body,
			);
			if (
				writes.length !== before + 1 ||
				writes.at(-1)?.value !== choice.value ||
				!writes.at(-1)?.configSha256 ||
				fresh.setting.value !== choice.value
			)
				throw new Error(
					"native duplicate intent/write/new-process disk readback side effect mismatch",
				);
		}
		const current = a.fixture.trace.at(-1)?.value;
		const other = policy.setting.choices.find(
			(choice) => choice.value !== current,
		);
		if (!other) throw new Error("actual non-current backend choice missing");
		a.fixture.controls.mode = "forbid-write";
		await this.flow("rejected-draft", flows.choose(other.value));
		await this.flow("rejected-save", [
			{ tapOn: { id: CONTROL.settingsAccountRoutingSave } },
			...flows.policyMessage("rejected"),
		]);
		a.fixture.controls.mode = "normal";
		await this.flow("rejected-reload", flows.reloadPolicy());
		a.fixture.controls.mode = "drop-after-write";
		await this.flow("unknown-draft", flows.choose(other.value));
		await this.flow("unconfirmed-after-commit", [
			{ tapOn: { id: CONTROL.settingsAccountRoutingSave } },
			...flows.reloadAfterUncertain(),
		]);
		a.fixture.controls.mode = "normal";
		await this.flow("unknown-resolved-by-GET", flows.selected(other.value));
		// Retain the request until the PUBLIC edit/connect form has selected B.
		a.fixture.controls.holdWrites = true;
		const bSeed = accountRoutingSchema.parse(
			(await b.fixture.respond("GET", undefined)).body,
		).setting;
		const target = policy.setting.choices.find(
			(choice) => choice.value !== other.value && choice.value !== bSeed.value,
		);
		if (!target) throw new Error("retired write target absent");
		await this.flow("retired-draft", flows.choose(target.value));
		await this.flow("retired-pending", flows.savePending());
		if (a.fixture.pendingResponses() !== 1)
			throw new Error("A response was not actually held before selecting B");
		await this.flow("public-switch-to-B", flows.switchComputer(), "b");
		const bValue = (await b.fixture.respond("GET", undefined)).body;
		if (
			!record(bValue) ||
			!record(bValue.setting) ||
			typeof bValue.setting.value !== "string"
		)
			throw new Error("B canonical readback unavailable");
		await this.flow(
			"B-before-retired-completion",
			flows.selected(bValue.setting.value),
			"b",
		);
		a.fixture.controls.holdWrites = false;
		a.fixture.releaseHeld();
		await this.flow(
			"B-after-retired-completion",
			[
				...flows.selected(bValue.setting.value),
				{ assertNotVisible: { text: copy("mobile.account_routing.saved") } },
			],
			"b",
		);
		for (const [mode, message] of [
			["old-relay", "unavailable"],
			["malformed", "load_error"],
		] as const) {
			a.fixture.controls.mode = mode;
			await this.flow(`public-switch-${mode}`, flows.switchComputer());
			await this.flow(mode, flows.policyMessage(message));
			a.fixture.controls.mode = "normal";
			await this.flow(`${mode}-retry`, flows.reloadPolicy());
			await this.flow("switch-back-B", flows.switchComputer(), "b");
		}
		a.fixture.controls.holdReads = true;
		await this.flow("public-A-loading", flows.switchComputer());
		await this.flow("loading-held", flows.policyMessage("loading"));
		if (a.fixture.pendingResponses() !== 1)
			throw new Error("A read was not actually held before selecting B");
		await this.flow("retire-read-select-B", flows.switchComputer(), "b");
		a.fixture.controls.holdReads = false;
		a.fixture.releaseHeld();
		await this.flow(
			"B-retired-read-safe",
			flows.selected(bValue.setting.value),
			"b",
		);
		await this.flow("return-A", flows.switchComputer());
		await a.relay.shutdown();
		await this.flow("disconnected-empty", [
			...flows.policyAnchor(),
			{
				extendedWaitUntil: {
					visible: { text: copy("mobile.account_routing.disconnected") },
					timeout: 15000,
				},
			},
			...flows.firstSettled("disconnected"),
		]);
		a.relay = createRelay({ accountRouting: a.fixture, password: this.secret });
		await a.relay.listen({ port: a.port });
		await this.flow("reconnected", flows.readyPolicy());
		for (const mode of ["light", "dark"] as const)
			await this.flow(`after-${mode}`, [
				...flows.theme(mode),
				...flows.readyPolicy(),
				...flows.firstSettled(`after-${mode}`),
			]);
		await this.flow("actual-text-scale-200", flows.scaled());
		await this.flow("real-route-removed-empty", flows.removeRoute());
		await this.flow("real-route-form-reconnected", flows.reconnectRemoved());
		this.receipt.flows =
			"PASS actual candidate policy/state/wire/private-config/iOS touch/a11y; inspect actual frame+hierarchy artifacts independently";
		this.receipt.frames = this.frames;
		this.save();
	}
	async cleanup() {
		this.host.beginCleanup();
		const failures: string[] = [];
		for (const [profile, slot] of this.slots) {
			try {
				slot.fixture.releaseHeld();
				writeFileSync(
					join(this.root, `wire-${profile}.json`),
					JSON.stringify(
						{
							identity: slot.fixture.identity,
							wire: slot.fixture.wireTrace,
							policy: slot.fixture.trace,
						},
						null,
						2,
					),
				);
				await slot.relay.shutdown();
			} catch {
				failures.push(`fixture-${profile}`);
			}
			try {
				await slot.mdns.stop();
			} catch {
				failures.push(`mdns-${profile}`);
			}
		}
		if (this.udid) {
			// Sized from the samples above, not from the smallest one: an
			// already-shutdown or already-gone device is a tolerable success,
			// matched on simctl's own wording, never on "any teardown error".
			const teardown: readonly (readonly [
				string,
				string[],
				BoundedOperation,
			])[] = [
				[
					"shutdown-owned-simulator",
					["simctl", "shutdown", this.udid],
					"shutdown",
				],
				["delete-owned-simulator", ["simctl", "delete", this.udid], "delete"],
			];
			for (const [name, args, operation] of teardown) {
				try {
					await this.host.run(name, "xcrun", [...args], capFor(operation));
				} catch (error) {
					if (tolerableTeardown(error)) continue;
					failures.push(`simulator-${operation}`);
				}
			}
		}
		try {
			await this.host.cleanup();
		} catch {
			failures.push("owned-process-groups");
		}
		this.receipt.cleanup = {
			failures,
			allOwnedResourcesReaped: failures.length === 0,
		};
		this.receipt.completedAt = new Date().toISOString();
		this.save();
		// Structured detail lives in receipt.cleanup; runProof composes the
		// reader-facing message so a STAGE failure stays primary (CI 38845929163
		// reported teardown while the real cause was a prerequisite deadline).
		if (failures.length)
			throw new Error(`cleanup failures: ${failures.join(",")}`);
	}
}

async function main() {
	assertProofCI(process.env);
	const requested = process.argv[process.argv.indexOf("--stage") + 1];
	if (process.argv.length !== 4 || process.argv[2] !== "--stage")
		throw new Error("use exact --stage preflight|setup|full");
	const stage = selectProof(
		process.env.GITHUB_EVENT_NAME ?? "",
		process.env.PROOF_MODE ?? "",
		requested ?? "",
	);
	if (!stage) throw new Error("this entrypoint is targeted proof only");
	const temp = process.env.RUNNER_TEMP;
	if (!temp || !process.env.GITHUB_RUN_ID)
		throw new Error("missing owned hosted runner temp/run identity");
	const root = resolve(
		temp,
		`account-routing-proof-${process.env.GITHUB_RUN_ID}`,
	);
	const existed = existsSync(root);
	const marker = join(root, ".owned-proof.json");
	if (existed && !existsSync(marker))
		throw new Error("unmarked existing proof root");
	if (!existed) mkdirSync(root, { mode: 0o700 });
	let startedAt = Date.now();
	const stages: string[] = [];
	if (existsSync(marker)) {
		const previous: unknown = JSON.parse(readFileSync(marker, "utf8"));
		if (
			!record(previous) ||
			previous.run !== process.env.GITHUB_RUN_ID ||
			previous.source !== process.env.GITHUB_SHA
		)
			throw new Error("unowned/stale proof root");
		// Each stage is a SEPARATE workflow step with its own `timeout-minutes`.
		// Charging setup the preflight step's wall time left it a budget equal to
		// the cold-simulator cap alone (1200 - 900 - 120 = 180s) for a stage that
		// must also boot, install, connect and capture — a legitimate run would
		// then fail as a policy breach. The stage clock therefore starts at THIS
		// invocation; the per-step timeout is the outer bound on total wall time,
		// and the marker stays valuable as an owned-root/ordering record.
		startedAt = Date.now();
		if (Array.isArray(previous.stages))
			for (const prior of previous.stages)
				if (typeof prior === "string") stages.push(prior);
	}
	stages.push(stage);
	writeFileSync(
		marker,
		JSON.stringify({
			run: process.env.GITHUB_RUN_ID,
			source: process.env.GITHUB_SHA,
			startedAt,
			stages,
		}),
		{ mode: 0o600 },
	);
	process.env.LOH12_PROOF_STARTED_AT = String(startedAt);
	const proof = new NativeProof(root, process.cwd(), stage);
	try {
		await runProof(stage, proof);
	} catch (error) {
		proof.receipt.failure = proof.host.redact(
			error instanceof Error ? error.message : "targeted proof failed",
		);
		writeFileSync(
			join(root, "proof.json"),
			JSON.stringify(proof.receipt, null, 2),
		);
		throw error;
	}
	if (process.env.GITHUB_STEP_SUMMARY)
		writeFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`## Targeted account-routing iOS ${stage}\n\n${JSON.stringify(proof.receipt, null, 2)}\n\nThis is NOT full E2E or Android runtime approval.\n`,
			{ flag: "a" },
		);
}
if (import.meta.main)
	void main().catch((error: unknown) => {
		console.error(
			error instanceof Error ? error.message : "targeted proof failed",
		);
		process.exitCode = 1;
	});
