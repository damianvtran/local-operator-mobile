import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	STAGE_B_BUNDLE,
	STAGE_B_HOST,
	STAGE_B_OTHER_HOST,
	type StageBProofConfig,
	stageBDiagnosticText,
} from "../../src/testing/stage-b-draft-transport.ts";
import {
	type IdentityScenario,
	startStageBIdentityFixture,
} from "../../tools/mock-relay/stage-b-identity-fixture.ts";
import { capFor } from "./account-routing-proof-contract.ts";
import { prepareStageBProof } from "./stage-b-draft-build.ts";
import {
	awaitStageBSeed,
	captureStageBFailure,
	stageBFlowCap,
} from "./stage-b-draft-diagnostics.ts";
import {
	assertStageBDraft,
	attachStageBPhoto,
	discardStageBDraft,
	logoutStageB,
	type StageBStep,
	selectStageBComputer,
	stageBEditor,
	stageBFlow,
	stageBHasDrawnScreen,
	typeStageBDraft,
} from "./stage-b-draft-flows.ts";

const SOURCE_SHA = /^[a-f0-9]{40}$/;
const WHITESPACE = /\s+/;
const SIMULATOR_ID = /^[a-f0-9-]{36}$/i;
const LAUNCH_PID = /:\s*(\d+)\s*$/;

/** Driver installation may foreground SpringBoard. Pay that cost before the
 * tracked launch, then explicitly foreground and prove real app pixels/ids before
 * evidence begins. The cold hierarchy itself need not contain a running app. */
export async function warmStageBDriver(
	hierarchy: (name: string, seconds: number) => Promise<string>,
	launch: () => Promise<void>,
	foreground: () => Promise<void>,
): Promise<string> {
	await hierarchy("warm-maestro-driver-cold", capFor("maestroCold"));
	await launch();
	await foreground();
	const drawn = await hierarchy("warm-app-readiness", 90);
	if (!stageBHasDrawnScreen(drawn))
		throw new Error(
			"Stage B warm readiness: hierarchy has no drawn app screen id",
		);
	return drawn;
}

export function assertStageBAdmission(env: NodeJS.ProcessEnv): void {
	if (
		env.CI !== "true" ||
		env.GITHUB_ACTIONS !== "true" ||
		env.GITHUB_REPOSITORY !== "damianvtran/local-operator-mobile" ||
		env.GITHUB_EVENT_NAME !== "pull_request" ||
		env.STAGE_B_NATIVE_APPROVED !== "true" ||
		!SOURCE_SHA.test(env.STAGE_B_SOURCE_SHA ?? "")
	)
		throw new Error(
			"Stage B native execution requires its explicitly approved trusted PR lane",
		);
}
export function verifyStageBBundle(
	expected: StageBProofConfig,
	actual: {
		bundleId: string;
		sourceSha: string;
		nonce: string;
		flavor: string;
	},
): void {
	if (
		actual.bundleId !== expected.bundleId ||
		actual.sourceSha !== expected.sourceSha ||
		actual.nonce !== expected.nonce ||
		actual.flavor !== expected.flavor
	)
		throw new Error("produced/installed native proof identity mismatch");
}
const digest = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");
function treeDigest(root: string): string {
	const chunks: string[] = [];
	const walk = (path: string, relative = "") => {
		for (const name of readdirSync(path).sort()) {
			const file = join(path, name);
			const rel = `${relative}/${name}`;
			const stat = lstatSync(file);
			if (stat.isSymbolicLink())
				chunks.push(`${rel}:link:${readlinkSync(file)}`);
			else if (stat.isDirectory()) walk(file, rel);
			else chunks.push(`${rel}:${digest(readFileSync(file))}`);
		}
	};
	walk(root);
	return digest(chunks.join("\n"));
}
const redact = stageBDiagnosticText;
const pause = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until<T>(
	read: () => T | undefined,
	description: string,
	capMs = 20000,
): Promise<T> {
	const deadline = Date.now() + capMs;
	while (Date.now() < deadline) {
		const value = read();
		if (value !== undefined) return value;
		await pause(100);
	}
	throw new Error(`native proof observation timed out: ${description}`);
}

/** One bounded unsigned producer; a unique owned simulator; all children use
 * exact process-group reaping. This is not the callback/PR147 proof lane. */
export async function runStageBDraftProof(
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	assertStageBAdmission(env);
	const cwd = process.cwd();
	const sourceSha = env.STAGE_B_SOURCE_SHA ?? "";
	const output = resolve(
		env.RUNNER_TEMP ?? "",
		`stage-b-draft-proof-${sourceSha.slice(0, 12)}`,
	);
	if (!env.RUNNER_TEMP || existsSync(output))
		throw new Error("proof output must be a fresh owned runner directory");
	mkdirSync(output, { recursive: true });
	mkdirSync(join(output, "commands"));
	mkdirSync(join(output, "frames"));
	mkdirSync(join(output, "home"));
	mkdirSync(join(output, "tmp"));
	const childEnv: NodeJS.ProcessEnv = {
		...Object.fromEntries(
			Object.entries(env).filter(([key]) =>
				[
					"PATH",
					"JAVA_HOME",
					"DEVELOPER_DIR",
					"SDKROOT",
					"GEM_HOME",
					"GEM_PATH",
					"LANG",
					"CI",
					"GITHUB_ACTIONS",
					"GITHUB_REPOSITORY",
					"GITHUB_EVENT_NAME",
					"STAGE_B_NATIVE_APPROVED",
					"STAGE_B_SOURCE_SHA",
				].includes(key),
			),
		),
		NODE_ENV: "production",
		HOME: join(output, "home"),
		TMPDIR: join(output, "tmp"),
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "/bin/false",
		COREPACK_HOME:
			env.COREPACK_HOME ?? join(env.HOME ?? "", ".cache/node/corepack"),
		COREPACK_ENABLE_NETWORK: "0",
		MAESTRO_CLI_ANALYTICS_DISABLED: "true",
	};
	const children = new Set<ChildProcess>();
	const commands: Record<string, unknown>[] = [];
	const cases: Record<string, unknown>[] = [];
	let serial = 0;
	let udid: string | null = null;
	let stopping = false;
	let failed: unknown;
	let fixture: Awaited<ReturnType<typeof startStageBIdentityFixture>> | null =
		null;
	const receipt: Record<string, unknown> = {
		sourceSha,
		workflowSha: env.GITHUB_WORKFLOW_SHA ?? "unavailable",
		flavor: "stage-b-draft-proof",
		commands,
		cases,
		status: "running",
		nativeAuthBoundary:
			"real native UI/provider/storage/HTTP with synthetic identity; not live Radient OAuth/TLS",
	};
	const reap = (child: ChildProcess) => {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ESRCH")
			)
				throw error;
		}
	};
	const abort = () => {
		stopping = true;
		for (const child of children) reap(child);
	};
	process.once("SIGTERM", abort);
	process.once("SIGINT", abort);
	const run = (
		name: string,
		command: string,
		args: string[],
		seconds = 120,
		cleanup = false,
	): Promise<string> =>
		new Promise((done, reject) => {
			if (stopping && !cleanup) {
				reject(new Error("proof interrupted"));
				return;
			}
			const started = Date.now();
			const number = ++serial;
			const child = spawn(command, args, {
				cwd,
				env: childEnv,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			children.add(child);
			let bytes = "";
			let timedOut = false;
			let overflow = false;
			const append = (chunk: Buffer) => {
				if (bytes.length + chunk.length > 16 * 1024 * 1024) {
					overflow = true;
					reap(child);
				} else bytes += chunk.toString();
			};
			child.stdout.on("data", append);
			child.stderr.on("data", append);
			const timer = setTimeout(() => {
				timedOut = true;
				reap(child);
			}, seconds * 1000);
			child.once("error", (error) => {
				clearTimeout(timer);
				children.delete(child);
				reject(error);
			});
			child.once("close", (rc) => {
				clearTimeout(timer);
				// Reap descendants even after a successful leader exit. A completed
				// utility is not permission to leave its child process group behind.
				reap(child);
				children.delete(child);
				const safe = redact(bytes);
				writeFileSync(
					join(
						output,
						"commands",
						`${String(number).padStart(3, "0")}-${name}.log`,
					),
					safe,
				);
				commands.push({
					name,
					command,
					args: args.map(redact),
					rc,
					elapsedMs: Date.now() - started,
					timedOut,
					overflow,
					outputDigest: digest(safe),
				});
				if (rc !== 0 || timedOut || overflow)
					reject(
						new Error(
							`${name} failed: rc=${rc} timeout=${timedOut} overflow=${overflow}; see bounded command log`,
						),
					);
				else done(safe.trim());
			});
		});
	const maestro =
		env.STAGE_B_MAESTRO ?? join(env.HOME ?? "", ".maestro/bin/maestro");
	try {
		if ((await run("source", "git", ["rev-parse", "HEAD"])) !== sourceSha)
			throw new Error("checkout differs from frozen PR source");
		if (env.GITHUB_WORKFLOW_SHA) {
			if (!SOURCE_SHA.test(env.GITHUB_WORKFLOW_SHA))
				throw new Error("evaluated workflow SHA invalid");
			// PR workflow evaluation may use a merge commit while the app producer
			// pins the head. Compare actual workflow bytes rather than asserting the
			// two different GitHub identities are the same commit.
			await run("fetch-evaluated-workflow", "git", [
				"fetch",
				"--no-tags",
				"origin",
				env.GITHUB_WORKFLOW_SHA,
			]);
			const evaluated = await run("evaluated-workflow", "git", [
				"show",
				`${env.GITHUB_WORKFLOW_SHA}:.github/workflows/stage-b-draft-proof.yml`,
			]);
			if (
				evaluated !==
				readFileSync(
					join(cwd, ".github/workflows/stage-b-draft-proof.yml"),
					"utf8",
				).trim()
			)
				throw new Error(
					"evaluated workflow differs from frozen source definition",
				);
		}
		receipt.lockDigest = digest(readFileSync(join(cwd, "pnpm-lock.yaml")));
		const disk = await run("disk-preflight", "df", ["-k", cwd]);
		const freeKiB = Number(
			disk.split("\n").at(-1)?.trim().split(WHITESPACE)[3],
		);
		if (!Number.isFinite(freeKiB) || freeKiB < 15 * 1024 * 1024)
			throw new Error("native proof requires at least 15 GiB free");
		receipt.freeKiBBefore = freeKiB;
		await run("xcode-preflight", "xcodebuild", ["-version"]);
		await run("pod-preflight", "pod", ["--version"]);
		await run("driver-preflight", maestro, ["--version"]);
		await run("expo-preflight", "pnpm", ["exec", "expo", "--version"]);
		const runtimes = JSON.parse(
			await run("runtime-preflight", "xcrun", [
				"simctl",
				"list",
				"runtimes",
				"-j",
			]),
		) as {
			runtimes: { identifier: string; name: string; isAvailable: boolean }[];
		};
		const runtime = runtimes.runtimes
			.filter((item) => item.isAvailable && item.name.startsWith("iOS 26"))
			.sort((a, b) => b.identifier.localeCompare(a.identifier))[0];
		if (!runtime)
			throw new Error(
				"preinstalled iOS 26 runtime missing; no SDK/runtime installation attempted",
			);
		fixture = await startStageBIdentityFixture(sourceSha);
		const config = fixture.config;
		receipt.nonce = config.nonce;
		receipt.fixtureOrigin = config.fixtureOrigin;
		prepareStageBProof(cwd, config, env);
		await run(
			"prebuild",
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
			300,
		);
		await run("pods", "pod", ["install", "--project-directory=ios"], 900);
		const ios = readdirSync(join(cwd, "ios"));
		const workspace = ios.filter((name) => name.endsWith(".xcworkspace"));
		const projects = ios.filter((name) => name.endsWith(".xcodeproj"));
		if (workspace.length !== 1 || projects.length !== 1)
			throw new Error("generated native project identity ambiguous");
		const scheme = projects[0]?.slice(0, -".xcodeproj".length) ?? "";
		udid = await run("create-owned-simulator", "xcrun", [
			"simctl",
			"create",
			`StageB-${config.nonce.slice(0, 12)}`,
			"com.apple.CoreSimulator.SimDeviceType.iPhone-17",
			runtime.identifier,
		]);
		if (!SIMULATOR_ID.test(udid))
			throw new Error("owned simulator UDID invalid");
		receipt.udid = udid;
		await run("boot-owned-simulator", "xcrun", ["simctl", "boot", udid]);
		await run(
			"boot-status",
			"xcrun",
			["simctl", "bootstatus", udid, "-b"],
			240,
		);
		// Match the ordinary iOS lane's automatic build parallelism. The measured
		// uncapped Release build takes ~23–25 min; retain a bounded 45-min ceiling.
		await run(
			"unsigned-candidate-producer",
			"xcodebuild",
			[
				"-workspace",
				join("ios", workspace[0] ?? ""),
				"-scheme",
				scheme,
				"-configuration",
				"Release",
				"-sdk",
				"iphonesimulator",
				"-destination",
				`platform=iOS Simulator,id=${udid}`,
				"-derivedDataPath",
				join(output, "DerivedData"),
				"CODE_SIGNING_ALLOWED=NO",
				"CODE_SIGNING_REQUIRED=NO",
				"build",
				"-quiet",
			],
			2700,
		);
		const products = join(
			output,
			"DerivedData/Build/Products/Release-iphonesimulator",
		);
		const apps = readdirSync(products).filter((name) => name.endsWith(".app"));
		if (apps.length !== 1) throw new Error("produced native app ambiguous");
		const app = join(products, apps[0] ?? "");
		const info = async (path: string, key: string) =>
			run(`plist-${key}`, "/usr/bin/plutil", [
				"-extract",
				key,
				"raw",
				"-o",
				"-",
				join(path, "Info.plist"),
			]);
		const identity = async (path: string) => ({
			bundleId: await info(path, "CFBundleIdentifier"),
			sourceSha: await info(path, "StageBProofSourceSha"),
			nonce: await info(path, "StageBProofNonce"),
			flavor: await info(path, "StageBProofFlavor"),
		});
		verifyStageBBundle(config, await identity(app));
		const bundle = readFileSync(join(app, "main.jsbundle"));
		if (
			![sourceSha, config.nonce, config.flavor].every((value) =>
				bundle.includes(Buffer.from(value)),
			)
		)
			throw new Error("embedded JS lacks frozen proof metadata");
		receipt.appDigest = treeDigest(app);
		receipt.embeddedJsDigest = digest(bundle);
		receipt.entryDigest = digest(
			readFileSync(join(cwd, "stage-b-proof-entry.js")),
		);
		await run("install-produced-app", "xcrun", [
			"simctl",
			"install",
			udid,
			app,
		]);
		const installed = await run("installed-container", "xcrun", [
			"simctl",
			"get_app_container",
			udid,
			STAGE_B_BUNDLE,
			"app",
		]);
		verifyStageBBundle(config, await identity(installed));
		receipt.installedDigest = treeDigest(installed);
		if (
			digest(readFileSync(join(installed, "main.jsbundle"))) !==
			receipt.embeddedJsDigest
		)
			throw new Error("installed JavaScript differs from produced artifact");
		const executable = await info(app, "CFBundleExecutable");
		if (
			digest(readFileSync(join(app, executable))) !==
			digest(readFileSync(join(installed, executable)))
		)
			throw new Error("installed native executable differs from producer");
		const canary = `stage-b-private-draft-${config.nonce}`;
		const launches: number[] = [];
		receipt.launchPids = launches;
		const launch = async () => {
			const text = await run("launch-owned-app", "xcrun", [
				"simctl",
				"launch",
				udid ?? "",
				STAGE_B_BUNDLE,
			]);
			const pid = Number(text.match(LAUNCH_PID)?.[1]);
			if (!pid || launches.includes(pid))
				throw new Error("native restart PID not observed");
			launches.push(pid);
		};
		const terminate = () =>
			run("terminate-owned-app", "xcrun", [
				"simctl",
				"terminate",
				udid ?? "",
				STAGE_B_BUNDLE,
			]);
		const flow = async (name: string, steps: StageBStep[]) => {
			const path = join(output, `${name}.yaml`);
			writeFileSync(path, stageBFlow(steps));
			await run(
				name,
				maestro,
				[
					"--device",
					udid ?? "",
					"test",
					"--test-output-dir",
					join(output, "maestro"),
					path,
				],
				stageBFlowCap(steps, name === "warm-app-foreground"),
			);
		};
		const frame = async (name: string) => {
			const hierarchy = await run(
				`hierarchy-${name}`,
				maestro,
				["--device", udid ?? "", "hierarchy"],
				90,
			);
			writeFileSync(join(output, `${name}.hierarchy.txt`), hierarchy);
			if (!hierarchy.includes("bounds") && !hierarchy.includes("frame"))
				throw new Error("actual native hierarchy geometry unavailable");
			await run(`frame-${name}`, "xcrun", [
				"simctl",
				"io",
				udid ?? "",
				"screenshot",
				join(output, "frames", `${name}.png`),
			]);
			return hierarchy;
		};
		const snapshot = async () => {
			const count = fixture?.receipts.length ?? 0;
			fixture?.command("snapshot");
			const item = await until(
				() =>
					fixture?.receipts
						.slice(count)
						.find((item) => item.kind === "snapshot"),
				"native storage snapshot",
			);
			if (item.plaintext !== false || item.pickerCopies !== 0)
				throw new Error("native private plaintext/picker-copy observer failed");
			return item;
		};
		const command = async (action: string) => {
			const count = fixture?.receipts.length ?? 0;
			fixture?.command(action);
			return until(
				() =>
					fixture?.receipts.slice(count).find((item) => item.kind === action),
				`native ${action} receipt`,
			);
		};
		const relaunch = async (
			mode: IdentityScenario = "same",
			waitEditor = true,
		) => {
			const priorMe = fixture?.counters.me ?? 0;
			fixture?.scenario(mode);
			await terminate();
			await launch();
			await flow(`connect-${++serial}`, selectStageBComputer());
			await until(
				() => ((fixture?.counters.me ?? 0) > priorMe ? true : undefined),
				"fresh native /me request (not cached identity)",
				30000,
			);
			if (waitEditor) await flow(`editor-${++serial}`, stageBEditor());
		};
		const expire = async () => {
			const previous = fixture?.counters.expired ?? 0;
			fixture?.expire();
			await until(
				() => ((fixture?.counters.expired ?? 0) > previous ? true : undefined),
				"real relay 401",
				30000,
			);
			let state = await snapshot();
			const deadline = Date.now() + 30000;
			while (state.generationFingerprint !== "none") {
				if (Date.now() >= deadline)
					throw new Error("real 401 did not withdraw native admission");
				state = await snapshot();
			}
			return state;
		};
		await run("phone-light", "xcrun", [
			"simctl",
			"ui",
			udid,
			"appearance",
			"light",
		]);
		const warmHierarchy = await warmStageBDriver(
			(name, seconds) =>
				run(name, maestro, ["--device", udid ?? "", "hierarchy"], seconds),
			launch,
			() => flow("warm-app-foreground", []),
		);
		writeFileSync(
			join(output, "warm-app.hierarchy.txt"),
			stageBDiagnosticText(warmHierarchy),
		);
		await awaitStageBSeed(warmHierarchy, (seconds) =>
			run(
				"warm-seed-state",
				maestro,
				["--device", udid ?? "", "hierarchy"],
				seconds,
			),
		);
		receipt.driverWarmUp =
			"PASS cold driver before tracked launch; foreground-only drawn app hierarchy";
		await flow("connect-initial", selectStageBComputer());
		await flow("type-initial", typeStageBDraft(canary));
		await run("add-owned-photo", "xcrun", [
			"simctl",
			"addmedia",
			udid,
			join(cwd, "design/app-icon/ios/icon-light-1024.png"),
		]);
		await flow("attach-native-photo", attachStageBPhoto());
		// Ordinary editor readiness intentionally does not imply optional recovery
		// readiness. Observe the actual native capability before the positive case.
		const readyDeadline = Date.now() + 30000;
		let initial = await snapshot();
		while (initial.recoveryAdmitted !== true) {
			if (Date.now() >= readyDeadline)
				throw new Error("initial optional recovery proof never became ready");
			initial = await snapshot();
		}
		if (
			!(Number(initial.committed) > 0) ||
			initial.keyPresent !== true ||
			initial.recoveryAdmitted !== true
		)
			throw new Error(
				"native encrypted observer had no actual private bytes/key",
			);
		await frame("light-populated-before");
		await frame("light-populated-before-settled");
		// Selecting again after verified cache removal proves the Photos source
		// still exists; the harness never deletes or edits the library original.
		await flow("remove-picked-copy-ui", [
			{ tapOn: { id: "composer-attachment-0" } },
		]);
		await flow("original-photo-still-selectable", attachStageBPhoto());
		await expire();
		await frame("light-expired-error");
		await relaunch("held", false);
		await until(
			() => (fixture?.held() ? true : undefined),
			"held light identity request",
		);
		await frame("light-loading");
		await frame("light-loading-consecutive");
		if (!fixture.held())
			throw new Error("held light identity request expired before release");
		fixture.release();
		await flow("assert-same-owner-recovered", [
			...assertStageBDraft(canary, true),
			{ assertVisible: { id: "composer-attachment-0" } },
		]);
		const recovered = await snapshot();
		if (
			recovered.recoveryAdmitted !== true ||
			recovered.generationFingerprint === initial.generationFingerprint ||
			fixture.counters.mutations !== 0
		)
			throw new Error("recovery reused dispatch generation or sent work");
		cases.push({
			surface: "same-owner expiry recovery",
			result: "PASS",
			freshGeneration: true,
			noSend: true,
		});
		await frame("light-populated-after");
		await frame("light-populated-after-settled");
		await run("phone-dark", "xcrun", [
			"simctl",
			"ui",
			udid,
			"appearance",
			"dark",
		]);
		await frame("dark-populated-after");
		await frame("dark-populated-after-settled");
		await command("partial-pending");
		await expire();
		await relaunch("refresh");
		await flow(
			"partial-write-and-refresh-restored",
			assertStageBDraft(canary, true),
		);
		if (fixture.counters.oauthRefresh < 1)
			throw new Error("real OAuth refresh path was not exercised");
		cases.push({
			surface: "native pending-write restart and OAuth refresh",
			result: "PASS",
		});
		for (const mode of [
			"held",
			"unauthorized",
			"malformed",
			"redirect",
			"offline",
		] as const) {
			await expire();
			await relaunch(mode, mode !== "held");
			if (mode === "held") {
				await until(
					() => (fixture?.held() ? true : undefined),
					"held real /me request",
				);
				await frame("dark-loading");
				await frame("dark-loading-consecutive");
				const pendingDraft = `${canary}-typed-while-loading`;
				await flow(
					"edit-real-input-during-proof",
					typeStageBDraft(pendingDraft),
				);
				if (!fixture.held())
					throw new Error(
						"held identity request expired before pending-input control",
					);
				fixture.release();
				await flow("pending-user-input-wins", [
					...assertStageBDraft(pendingDraft, true),
					...assertStageBDraft(canary, false),
					{ assertNotVisible: { id: "composer-attachment-0" } },
				]);
				if ((await snapshot()).recoveryAdmitted !== true)
					throw new Error(
						"pending-input control did not obtain fresh recovery proof",
					);
				await flow("reset-after-pending-edit", [
					...discardStageBDraft(),
					...typeStageBDraft(canary),
				]);
				cases.push({
					surface: "native typing while recovery is pending wins",
					result: "PASS",
				});
			} else {
				await flow(`refused-${mode}`, assertStageBDraft(canary, false));
				await frame(`dark-refused-${mode}`);
				if ((await snapshot()).recoveryAdmitted !== false)
					throw new Error(
						"refused identity restored a cached recovery capability",
					);
				if (fixture.counters.redirectTarget !== 0)
					throw new Error(
						"native redirect:error followed the identity redirect",
					);
			}
			await relaunch("same");
			await flow(`after-${mode}-same-owner`, assertStageBDraft(canary, true));
			cases.push({ surface: `native identity ${mode}`, result: "PASS" });
		}
		// Change the destination through the REAL Computers route while old /me
		// is held. No bridge grants a scope or invokes provider admission directly.
		const beforeBackendChange = await snapshot();
		await expire();
		await relaunch("held", false);
		await until(
			() => (fixture?.held() ? true : undefined),
			"held old-backend proof",
		);
		fixture.scenario("same");
		await run("open-real-computer-picker", "xcrun", [
			"simctl",
			"openurl",
			udid,
			"stagebdraftproof://computers",
		]);
		await flow("choose-other-backend", [
			{
				extendedWaitUntil: {
					visible: { id: `computer-row-${STAGE_B_OTHER_HOST}` },
					timeout: 15000,
				},
			},
			{ tapOn: { id: `computer-row-${STAGE_B_OTHER_HOST}` } },
			...assertStageBDraft(canary, false),
		]);
		let switched = await snapshot();
		const switchedDeadline = Date.now() + 20000;
		while (switched.generationFingerprint === "none") {
			if (Date.now() >= switchedDeadline)
				throw new Error("new backend admission never completed");
			switched = await snapshot();
		}
		if (switched.installFingerprint === beforeBackendChange.installFingerprint)
			throw new Error("backend change retained the prior native key");
		fixture.release();
		await flow("late-old-proof-stays-empty", assertStageBDraft(canary, false));
		const afterLate = await snapshot();
		if (
			afterLate.generationFingerprint !== switched.generationFingerprint ||
			afterLate.installFingerprint !== switched.installFingerprint
		)
			throw new Error("late old proof replaced the new backend owner");
		await run("return-real-computer-picker", "xcrun", [
			"simctl",
			"openurl",
			udid,
			"stagebdraftproof://computers",
		]);
		await flow("choose-original-backend", [
			{
				extendedWaitUntil: {
					visible: { id: `computer-row-${STAGE_B_HOST}` },
					timeout: 15000,
				},
			},
			{ tapOn: { id: `computer-row-${STAGE_B_HOST}` } },
			...assertStageBDraft(canary, false),
		]);
		await flow("type-after-backend-isolation", typeStageBDraft(canary));
		cases.push({
			surface: "native backend switch with held old authority response",
			result: "PASS",
		});
		for (const mode of ["account-b", "tenant-b"] as const) {
			const beforeMismatch = await snapshot();
			await expire();
			await relaunch(mode);
			await flow(`mismatch-${mode}-empty`, assertStageBDraft(canary, false));
			const changed = await snapshot();
			if (changed.installFingerprint === beforeMismatch.installFingerprint)
				throw new Error(
					"proven authority mismatch retained the previous native key",
				);
			await relaunch("same");
			await flow(
				`mismatch-${mode}-old-owner-still-empty`,
				assertStageBDraft(canary, false),
			);
			await flow(`type-next-${mode}`, typeStageBDraft(canary));
			cases.push({ surface: `native ${mode} isolation`, result: "PASS" });
		}
		await flow("explicit-discard", discardStageBDraft());
		await relaunch();
		await flow("discard-survives-restart", assertStageBDraft(canary, false));
		cases.push({ surface: "explicit discard", result: "PASS" });
		await flow("type-before-logout", typeStageBDraft(canary));
		await snapshot();
		await flow("explicit-ui-logout", logoutStageB());
		const loggedOut = await snapshot();
		if (loggedOut.keyPresent !== false || loggedOut.files !== 0)
			throw new Error("UI logout retained native key/ciphertext");
		await relaunch();
		await flow("logout-no-recovery", assertStageBDraft(canary, false));
		cases.push({ surface: "explicit UI logout", result: "PASS" });
		await flow("type-before-sentinel-loss", typeStageBDraft(canary));
		const beforeSentinel = await snapshot();
		const dropped = await command("drop-sentinel");
		if (dropped.keyStillPresent !== true)
			throw new Error("sentinel-loss control did not retain a real native key");
		await relaunch();
		await flow("sentinel-loss-empty", assertStageBDraft(canary, false));
		const afterSentinel = await snapshot();
		if (beforeSentinel.installFingerprint === afterSentinel.installFingerprint)
			throw new Error("missing sentinel adopted surviving Keychain identity");
		cases.push({
			surface: "native sentinel loss with surviving key",
			result: "PASS",
		});
		await flow("type-before-reinstall", typeStageBDraft(canary));
		await snapshot();
		await terminate();
		await run("uninstall-owned-proof-app", "xcrun", [
			"simctl",
			"uninstall",
			udid,
			STAGE_B_BUNDLE,
		]);
		await run("reinstall-same-produced-app", "xcrun", [
			"simctl",
			"install",
			udid,
			app,
		]);
		const beforeBoot = fixture.receipts.length;
		await launch();
		await flow("connect-after-reinstall", [
			...selectStageBComputer(),
			...stageBEditor(),
		]);
		const startup = await until(
			() =>
				fixture?.receipts
					.slice(beforeBoot)
					.find((item) => item.kind === "startup"),
			"reinstall Keychain observation",
		);
		if (startup.survivingKey !== true || startup.sentinelPresent !== false)
			throw new Error(
				"BLOCKED: simulator did not expose OS Keychain survival with a missing sandbox sentinel",
			);
		await flow("reinstall-empty", assertStageBDraft(canary, false));
		cases.push({
			surface: "actual uninstall/reinstall with observed Keychain survival",
			result: "PASS",
		});
		await flow("type-before-corruption", typeStageBDraft(canary));
		await snapshot();
		await command("corrupt-recovery");
		await expire();
		await relaunch();
		await flow(
			"corrupt-ciphertext-no-fallback",
			assertStageBDraft(canary, false),
		);
		cases.push({
			surface: "native committed ciphertext/tag corruption",
			result: "PASS",
		});
		await frame("dark-empty-after-corruption");
		await flow("clear-corrupt-vault-by-ui-logout", logoutStageB());
		await relaunch();
		await flow("type-before-wrong-key", typeStageBDraft(canary));
		await snapshot();
		await command("wrong-key");
		await expire();
		await relaunch();
		await flow(
			"wrong-key-no-plaintext-fallback",
			assertStageBDraft(canary, false),
		);
		cases.push({
			surface: "native SecureStore wrong-key ciphertext refusal",
			result: "PASS",
		});
		if (fixture.counters.mutations !== 0)
			throw new Error("draft recovery generated a session/command mutation");
		receipt.wireCounters = fixture.counters;
		receipt.nativeReceipts = fixture.receipts;
		receipt.status = "PASS";
		await run(
			"archive-one-produced-app",
			"tar",
			[
				"-czf",
				join(output, "candidate-app.tgz"),
				"-C",
				products,
				basename(app),
			],
			180,
		);
	} catch (error) {
		failed = error;
		receipt.status = "FAIL";
		receipt.error = stageBDiagnosticText(
			error instanceof Error ? error.message : "proof failed",
		);
	} finally {
		for (const child of children) reap(child);
		if (udid) {
			if (failed)
				receipt.failureDiagnostics = await captureStageBFailure(
					(name, command, args, seconds) =>
						run(name, command, args, seconds, true),
					udid,
					output,
					maestro,
				);
			try {
				await run(
					"cleanup-shutdown-owned-simulator",
					"xcrun",
					["simctl", "shutdown", udid],
					60,
					true,
				);
			} catch (error) {
				receipt.shutdownError = String(error);
			}
			try {
				await run(
					"cleanup-delete-owned-simulator",
					"xcrun",
					["simctl", "delete", udid],
					60,
					true,
				);
			} catch (error) {
				receipt.deleteError = String(error);
				failed ??= error;
			}
		}
		if (fixture) {
			receipt.wireCounters = fixture.counters;
			receipt.nativeReceipts = fixture.receipts;
			try {
				await fixture.close();
			} catch (error) {
				receipt.fixtureCleanupError = String(error);
				failed ??= error;
			}
		}
		if (failed) receipt.status = "FAIL";
		process.removeListener("SIGTERM", abort);
		process.removeListener("SIGINT", abort);
		writeFileSync(
			join(output, "receipt.json"),
			`${JSON.stringify(receipt, null, 2)}\n`,
		);
	}
	if (failed) throw failed;
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	await runStageBDraftProof();
}
