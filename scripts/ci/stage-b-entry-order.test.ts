import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	STAGE_B_BUNDLE,
	type StageBProofConfig,
	stageBSeedFailure,
} from "../../src/testing/stage-b-draft-transport";
import { stageBGeneratedSource } from "./stage-b-draft-build";

const config: StageBProofConfig = {
	flavor: "stage-b-draft-proof" as const,
	bundleId: STAGE_B_BUNDLE,
	sourceSha: "a".repeat(40),
	nonce: "b".repeat(32),
	fixtureOrigin: "http://127.0.0.1:12345",
};

/** Evaluate the actual generated CommonJS entry, with native registration faked,
 * not its ordering. A deliberately held seed models network/SecureStore latency. */
function evaluateEntry(entry: string) {
	const registry = new Map<string, () => () => unknown>();
	const calls: string[] = [];
	let resolveSeed!: () => void;
	let rejectSeed!: (error?: unknown) => void;
	const seed = new Promise<void>((resolve, reject) => {
		resolveSeed = resolve;
		rejectSeed = reject;
	});
	let transport = false;
	let seeded = false;
	let state:
		| {
				ready: boolean;
				stage: string;
				error: { name: string; message: string } | null;
		  }
		| undefined;
	const logs: string[] = [];
	let effect: (() => unknown) | undefined;
	const App = () => "real-router";
	const AppRegistry = {
		registerComponent: (name: string, factory: () => () => unknown) => {
			calls.push("register-main");
			registry.set(name, factory);
		},
	};
	const initialize = (report?: (stage: string) => void) => {
		calls.push("async-seed");
		report?.("private-key-read");
		return seed;
	};
	const requireModule = (id: string): unknown => {
		if (id === "./src/testing/stage-b-draft-bootstrap.ts")
			return {
				stageBSeedFailure,
				installStageBDraftProof: () => {
					transport = true;
					calls.push("install-transport");
					return initialize;
				},
				// Exact old generator control: registration happens only in its .then.
				bootStageBDraftProof: () => {
					transport = true;
					return initialize();
				},
			};
		expect(transport, `transport before ${id}`).toBe(true);
		if (id === "@expo/metro-runtime") return {};
		if (id === "react")
			return {
				useState: (initial: NonNullable<typeof state>) => {
					state ??= initial;
					return [
						state,
						(
							next:
								| typeof state
								| ((
										previous: NonNullable<typeof state>,
								  ) => NonNullable<typeof state>),
						) => {
							state =
								typeof next === "function"
									? next(state as NonNullable<typeof state>)
									: next;
						},
					];
				},
				useEffect: (callback: () => unknown) => {
					effect ??= callback;
				},
				createElement: (
					type: unknown,
					props: unknown,
					...children: unknown[]
				) => ({ type, props, children }),
			};
		if (id === "react-native")
			return {
				View: "View",
				ActivityIndicator: "ActivityIndicator",
				AppRegistry,
			};
		if (id === "expo-router/build/utils/splash")
			return { hide: () => calls.push("hide-native-splash") };
		if (id === "expo-router/build/renderRootComponent")
			return {
				renderRootComponent: (Root: () => unknown) =>
					AppRegistry.registerComponent("main", () => Root),
			};
		if (
			id === "expo-router/build/qualified-entry" ||
			id === "expo-router/entry"
		) {
			expect(
				seeded,
				"real router/provider imports wait for credential seed",
			).toBe(true);
			calls.push("import-real-router");
			if (id === "expo-router/entry")
				AppRegistry.registerComponent("main", () => App);
			return { App };
		}
		throw new Error(`Unexpected entry dependency ${id}`);
	};
	runInNewContext(entry, {
		require: requireModule,
		Error,
		console: { error: (message: string) => logs.push(message) },
	});
	return {
		registry,
		calls,
		logs,
		render: () => registry.get("main")?.()(),
		mountEffect: () => effect?.(),
		resolve: async () => {
			seeded = true;
			resolveSeed();
			await seed;
			await Promise.resolve();
		},
		reject: async (error?: unknown) => {
			rejectSeed(error);
			await seed.catch(() => {});
			await Promise.resolve();
		},
		App,
	};
}

function requireSynchronousMain(registry: Map<string, unknown>) {
	if (!registry.has("main"))
		throw new Error("native main was not registered synchronously");
}

describe("dedicated Stage B entry registration", () => {
	it("reveals the gate once on layout without waiting for or importing the real router", async () => {
		const entry = evaluateEntry(stageBGeneratedSource(config).entry);
		requireSynchronousMain(entry.registry);
		expect(entry.calls).not.toContain("hide-native-splash");
		const gate = entry.render() as { props: { onLayout: () => void } };
		gate.props.onLayout();
		gate.props.onLayout();
		expect(entry.calls).toEqual([
			"install-transport",
			"register-main",
			"hide-native-splash",
		]);
		entry.mountEffect();
		await entry.resolve();
		expect(entry.render()).toMatchObject({ type: entry.App });
		gate.props.onLayout(); // A queued old layout after App mount cannot hide twice.
		expect(
			entry.calls.filter((call) => call === "hide-native-splash"),
		).toHaveLength(1);
	});
	it("registers main synchronously and mounts the real router only after seed completion", async () => {
		const entry = evaluateEntry(stageBGeneratedSource(config).entry);
		requireSynchronousMain(entry.registry);
		expect(entry.calls).toEqual(["install-transport", "register-main"]);
		expect(entry.render()).toMatchObject({
			type: "View",
			props: { testID: "stage-b-proof-gate" },
		});
		entry.mountEffect();
		expect(entry.calls).toEqual([
			"install-transport",
			"register-main",
			"async-seed",
		]);
		expect(entry.render()).toMatchObject({ type: "View" });
		await entry.resolve();
		expect(entry.render()).toMatchObject({ type: entry.App });
		expect(entry.calls.at(-1)).toBe("import-real-router");
	});
	it("rejects the previous generator with the same synchronous-main contract", async () => {
		const legacy = `require('./src/testing/stage-b-draft-bootstrap.ts').bootStageBDraftProof(${JSON.stringify(config)}).then(() => require('expo-router/entry')).catch(() => { throw new Error('Dedicated Stage B bootstrap failed'); });`;
		const control = evaluateEntry(legacy);
		expect(() => requireSynchronousMain(control.registry)).toThrow(
			"main was not registered synchronously",
		);
		await control.resolve();
		expect(control.registry.has("main")).toBe(true); // A late registration is insufficient.
	});
	it("fails closed without mounting the real provider when seeding rejects", async () => {
		const entry = evaluateEntry(stageBGeneratedSource(config).entry);
		requireSynchronousMain(entry.registry);
		entry.render();
		entry.mountEffect();
		await entry.reject(new TypeError("keychain token=secret-never-log"));
		expect(entry.render()).toMatchObject({
			type: "View",
			props: {
				testID: "stage-b-proof-gate",
				accessibilityLabel: expect.stringContaining(
					"stage=private-key-read cause=TypeError:",
				),
			},
		});
		expect(entry.logs[0]).toContain("stage=private-key-read");
		expect(entry.logs.join(" ")).not.toContain("secret-never-log");
		expect(entry.calls).not.toContain("import-real-router");
	});
});
