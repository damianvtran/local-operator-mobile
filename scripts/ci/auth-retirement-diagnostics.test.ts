import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("retains a sanitized failure receipt for setup failures before native phases", () => {
	const host = readFileSync(
		new URL("./auth-retirement-ios-proof.ts", import.meta.url),
		"utf8",
	);
	const workflow = readFileSync(
		new URL("../../.github/workflows/ios.yml", import.meta.url),
		"utf8",
	);
	expect(host).toContain("withProofDiagnostics");
	expect(workflow).toContain("auth-retirement-proof/failure.json");
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe } from "vitest";
import {
	activeProofDiagnostics,
	commandCategory,
	withProofDiagnostics,
} from "./auth-retirement-diagnostics.ts";
import { command } from "./auth-retirement-ios-proof.ts";

const fresh = () =>
	mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"proof-diagnostic-",
		),
	);
const secret = "SYNTHETIC_SECRET_DO_NOT_LOG_9a7c";
const receipt = (root: string) =>
	JSON.parse(readFileSync(join(root, "failure.json"), "utf8"));
describe("sanitized first-failure diagnostics", () => {
	it("retains exact safe checkpoint without dynamic exception messages or paths", async () => {
		const root = fresh();
		await expect(
			withProofDiagnostics(root, async () => {
				activeProofDiagnostics?.checkpoint("install");
				throw new Error(`${secret} /private/operator/credentials`);
			}),
		).rejects.toThrow();
		expect(receipt(root)).toMatchObject({
			classification: "BLOCKED",
			checkpoint: "install",
			phase: null,
			command: null,
		});
		const combined =
			readFileSync(join(root, "failure.json"), "utf8") +
			readFileSync(join(root, "proof.json"), "utf8");
		for (const forbidden of [secret, "/private", root, "credentials", "stack"])
			expect(combined).not.toContain(forbidden);
		expect(
			JSON.parse(readFileSync(join(root, "proof.json"), "utf8")),
		).toMatchObject({ complete: false, diagnosticOnly: true, phases: [] });
	});
	it("records a subprocess nonzero outcome but never its adversarial args/stdout/stderr", async () => {
		const root = fresh();
		await expect(
			withProofDiagnostics(root, async () => {
				activeProofDiagnostics?.checkpoint("phase", "seed");
				await command(process.execPath, [
					"-e",
					`console.log(${JSON.stringify(secret)});console.error('/private/token/'+${JSON.stringify(secret)});process.exit(7);`,
				]);
			}),
		).rejects.toThrow();
		expect(receipt(root)).toMatchObject({
			checkpoint: "phase",
			phase: "seed",
			command: {
				category: "local-process",
				outcome: "nonzero-exit",
				exitCode: 7,
			},
		});
		const text = readFileSync(join(root, "failure.json"), "utf8");
		// Match adversarial payloads, not the legitimate enum "nonzero-exit",
		// which happens to contain the generic command-switch substring "-e".
		for (const forbidden of [secret, "/private", "console.log", "process.exit"])
			expect(text).not.toContain(forbidden);
	});
	it("classifies actual timeout as BLOCKED and keeps cleanup from replacing first failure", async () => {
		const root = fresh();
		await expect(
			withProofDiagnostics(root, async () => {
				activeProofDiagnostics?.checkpoint("boot-ready");
				try {
					await command(
						process.execPath,
						["-e", "setInterval(()=>{},1000)"],
						50,
					);
				} catch {
					activeProofDiagnostics?.checkpoint("cleanup");
					await command(process.execPath, ["-e", "process.exit(0)"]);
					throw new Error(secret);
				}
			}),
		).rejects.toThrow();
		expect(receipt(root)).toMatchObject({
			classification: "BLOCKED",
			checkpoint: "boot-ready",
			command: { outcome: "timeout", signal: "SIGKILL" },
		});
	});
	it("records actual start failure without executable paths", async () => {
		const root = fresh();
		await expect(
			withProofDiagnostics(root, () => command(join(root, secret), [])),
		).rejects.toThrow();
		expect(receipt(root)).toMatchObject({
			command: {
				category: "unknown",
				outcome: "start-failure",
				exitCode: null,
			},
		});
		expect(readFileSync(join(root, "failure.json"), "utf8")).not.toContain(
			root,
		);
	});
	it("never serializes unknown checkpoint/phase/executable labels", async () => {
		expect(commandCategory(secret, [secret])).toBe("unknown");
		const root = fresh();
		await expect(
			withProofDiagnostics(root, async () => {
				activeProofDiagnostics?.checkpoint(secret, secret);
				throw new Error(secret);
			}),
		).rejects.toThrow();
		expect(receipt(root)).toMatchObject({
			checkpoint: "preflight",
			phase: null,
		});
		expect(readFileSync(join(root, "failure.json"), "utf8")).not.toContain(
			secret,
		);
	});
});
it("runtime-sanitizes adversarial lifecycle fields instead of serializing dynamic values", async () => {
	const root = fresh();
	await expect(
		withProofDiagnostics(root, async () => {
			const diag = activeProofDiagnostics!;
			diag.finish(diag.begin("install"), "timeout", 0, null, {
				budgetMs: secret,
				exitAfterMs: secret,
				closeAfterMs: secret,
				timerAfterMs: secret,
				stdoutEndAfterMs: secret,
				stderrEndAfterMs: secret,
				exitCode: secret,
				exitSignal: secret,
				killResult: secret,
			} as unknown as import("./auth-retirement-diagnostics.ts").CommandLifecycle);
			throw new Error(secret);
		}),
	).rejects.toThrow();
	const text = readFileSync(join(root, "failure.json"), "utf8");
	expect(text).not.toContain(secret);
	expect(JSON.parse(text).command.lifecycle).toEqual({
		budgetMs: 0,
		exitAfterMs: null,
		closeAfterMs: null,
		timerAfterMs: null,
		stdoutEndAfterMs: null,
		stderrEndAfterMs: null,
		exitCode: null,
		exitSignal: "other",
		killResult: "other",
	});
});
