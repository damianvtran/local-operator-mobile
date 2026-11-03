import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	activeProofDiagnostics,
	withProofDiagnostics,
} from "./auth-retirement-diagnostics.ts";
import { prepareProofBuild } from "./auth-retirement-ios-proof.ts";
import {
	countRefused,
	refusedCounts,
	sanitizePhaseFailure,
} from "./auth-retirement-phase-diagnostics.ts";
import { assertProofBuild } from "./auth-retirement-proof-contract.ts";
import {
	createReadyGate,
	launchWithReady,
	listenForProofSignals,
	PROGRESS_KINDS,
	READY_BUDGET_MS,
	READY_KINDS,
	ReadyTimeout,
	signalRefusal,
	URL_REFUSAL_REASONS,
	urlProgress,
} from "./auth-retirement-readiness.ts";

const roots: string[] = [];
const fresh = () => {
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"readiness-",
		),
	);
	roots.push(root);
	return root;
};
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const flavor = "auth-retirement-proof",
	source = "a".repeat(40);
const app = () =>
	readFileSync(
		new URL("../../src/testing/auth-retirement-proof.ts", import.meta.url),
		"utf8",
	);

describe("proof listener handshake (no SDK/real xcrun)", () => {
	it("arms before launch, retaining ready that arrives during launch", async () => {
		expect(READY_BUDGET_MS).toBe(45000);
		const gate = createReadyGate();
		let opened = false;
		const result = await launchWithReady(gate, async () => {
			expect(opened).toBe(false);
			expect(gate.accept()).toBe(true);
			return "pid";
		});
		opened = true;
		expect(result.launch).toBe("pid");
		expect(result.readyAt).toBeGreaterThan(0);
		expect(opened).toBe(true);
	});
	it("never opens the URL until listener-ready is received", async () => {
		const gate = createReadyGate();
		let opened = false;
		const pending = (async () => {
			await launchWithReady(gate, async () => "pid");
			opened = true;
		})();
		await Promise.resolve();
		expect(opened).toBe(false);
		expect(gate.accept()).toBe(true);
		await pending;
		expect(opened).toBe(true);
	});
	it("classifies ready-timeout with no openurl and no phase success", async () => {
		const root = fresh(),
			gate = createReadyGate(5);
		let opened = false;
		await expect(
			withProofDiagnostics(root, async () => {
				activeProofDiagnostics?.checkpoint("phase", "seed");
				try {
					await launchWithReady(gate, async () => "pid");
					opened = true;
				} catch (error) {
					expect(error).toBeInstanceOf(ReadyTimeout);
					activeProofDiagnostics?.observePhaseFailure({
						phase: "seed",
						cause: "ready-timeout",
						urlProgress: "none",
					});
					throw error;
				}
			}),
		).rejects.toBeInstanceOf(ReadyTimeout);
		expect(opened).toBe(false);
		expect(
			JSON.parse(readFileSync(join(root, "failure.json"), "utf8")),
		).toMatchObject({
			classification: "BLOCKED",
			phaseFailure: { cause: "ready-timeout", urlProgress: "none" },
		});
	});
	it.each([
		["READY_KINDS", READY_KINDS],
		["PROGRESS_KINDS", PROGRESS_KINDS],
		["URL_REFUSAL_REASONS", URL_REFUSAL_REASONS],
	] as const)("keeps %s enum identical in app/host", (name, expected) => {
		const literal = new RegExp(
			"export const " + name + " = (\\[[\\s\\S]*?\\]) as const",
		).exec(app())?.[1];
		expect(literal).toBeDefined();
		expect(JSON.parse(literal!.replace(/,\s*\]/g, "]"))).toEqual(expected);
	});
	it("admits the exact ready identity and refuses arbitrary kind/fields/identity", () => {
		const value = { kind: "listener-ready", flavor, sourceSha: source };
		expect(signalRefusal(value, "/ready", "seed", flavor, source)).toBeNull();
		expect(
			signalRefusal(
				{ ...value, kind: "arbitrary" },
				"/ready",
				"seed",
				flavor,
				source,
			),
		).toBe("progress-unknown");
		expect(
			signalRefusal(
				{ ...value, extra: "free text" },
				"/ready",
				"seed",
				flavor,
				source,
			),
		).toBe("unknown-key");
		expect(
			signalRefusal(
				{ ...value, flavor: "other" },
				"/ready",
				"seed",
				flavor,
				source,
			),
		).toBe("flavor-mismatch");
		expect(
			signalRefusal(
				{ ...value, sourceSha: "other" },
				"/ready",
				"seed",
				flavor,
				source,
			),
		).toBe("source-mismatch");
	});
	it.each(URL_REFUSAL_REASONS)("records only refused:%s progress", (reason) => {
		const signal = { kind: "url-refused", reason, flavor, sourceSha: source };
		expect(
			signalRefusal(signal, "/progress", "seed", flavor, source),
		).toBeNull();
		expect(
			sanitizePhaseFailure({
				phase: "seed",
				cause: "receipt-timeout",
				urlProgress: urlProgress(signal),
			}).urlProgress,
		).toBe(`refused:${reason}`);
	});
	it("records admitted and none, and counts unknown progress without free text", () => {
		const admitted = {
			kind: "url-admitted",
			phase: "seed",
			flavor,
			sourceSha: source,
		};
		expect(
			signalRefusal(admitted, "/progress", "seed", flavor, source),
		).toBeNull();
		expect(urlProgress(admitted)).toBe("admitted");
		const unknown = {
			kind: "url-refused",
			reason: "UNSAFE_PROGRESS_SENTINEL",
			flavor,
			sourceSha: source,
		};
		const reason = signalRefusal(unknown, "/progress", "seed", flavor, source);
		expect(reason).toBe("progress-unknown");
		const counts = refusedCounts();
		if (reason) countRefused(counts, reason);
		const root = fresh();
		awaitlessRecord(root, counts, urlProgress(unknown));
		expect(readFileSync(join(root, "failure.json"), "utf8")).not.toContain(
			"UNSAFE_PROGRESS_SENTINEL",
		);
		expect(
			sanitizePhaseFailure({ urlProgress: "admitted", readyAfterLaunchMs: 5 }),
		).toMatchObject({ urlProgress: "admitted", readyAfterLaunchMs: 5 });
		expect(sanitizePhaseFailure({}).urlProgress).toBe("none");
	});
	it("writes the selected port to CI env/build identity and generates matching app metadata", async () => {
		const root = fresh(),
			cwd = process.cwd();
		writeFileSync(join(root, "package.json"), "{}");
		writeFileSync(
			join(root, "app.config.ts"),
			"const config = {};\nexport default config;\n",
		);
		vi.stubEnv("GITHUB_EVENT_NAME", "workflow_dispatch");
		vi.stubEnv("RETIREMENT_PROOF", "true");
		vi.stubEnv("GITHUB_ENV", join(root, "github-env"));
		try {
			process.chdir(root);
			await prepareProofBuild(join(root, "identity"), async (_exe, args) =>
				args[0] === "status" ? "" : source,
			);
		} finally {
			process.chdir(cwd);
		}
		const id = JSON.parse(
			readFileSync(join(root, "identity/build-identity.json"), "utf8"),
		);
		expect(id.receiverPort).toBeGreaterThanOrEqual(20000);
		expect(id.receiverPort).toBeLessThan(40000);
		expect(readFileSync(join(root, "github-env"), "utf8")).toContain(
			`EXPO_PUBLIC_RETIREMENT_PROOF_RECEIVER_PORT=${id.receiverPort}`,
		);
		expect(readFileSync(join(root, "app.config.ts"), "utf8")).toContain(
			`LORetirementProofReceiverPort: ${id.receiverPort}`,
		);
		const frozen = { ...id, bundleSha256: "b".repeat(64) };
		expect(() =>
			assertProofBuild(frozen, {
				...frozen,
				receiverPort: id.receiverPort === 39999 ? 20000 : id.receiverPort + 1,
			}),
		).toThrow();
		expect(app()).toContain("receiver.port !== String(RECEIVER_PORT)");
	});
	it("binds exactly the frozen port on loopback via the real listen helper", async () => {
		const calls: unknown[][] = [];
		class Listener extends EventEmitter {
			listen(...args: unknown[]) {
				calls.push(args);
				this.emit("listening");
				return this;
			}
		}
		await listenForProofSignals(new Listener() as unknown as Server, 23456);
		expect(calls).toEqual([[23456, "127.0.0.1"]]);
	});
	it("classifies bind failure at receiver-setup, not as a phase success", async () => {
		const root = fresh();
		class Listener extends EventEmitter {
			listen() {
				this.emit("error", new Error("fixture bind failed"));
				return this;
			}
		}
		await expect(
			withProofDiagnostics(root, async () => {
				activeProofDiagnostics?.checkpoint("receiver-setup");
				await listenForProofSignals(new Listener() as unknown as Server, 23456);
			}),
		).rejects.toThrow("fixture bind failed");
		expect(
			JSON.parse(readFileSync(join(root, "failure.json"), "utf8")),
		).toMatchObject({
			classification: "BLOCKED",
			checkpoint: "receiver-setup",
		});
	});
});
function awaitlessRecord(
	root: string,
	counts: ReturnType<typeof refusedCounts>,
	progress: string,
): void {
	// Use the actual sanitized writer without starting any native runtime.
	const diag = new ProofDiagnostics(root);
	diag.checkpoint("phase", "seed");
	diag.observePhaseFailure({
		phase: "seed",
		cause: "receipt-timeout",
		urlProgress: progress,
		refused: counts,
	});
	diag.fail();
}

import { ProofDiagnostics } from "./auth-retirement-diagnostics.ts";
