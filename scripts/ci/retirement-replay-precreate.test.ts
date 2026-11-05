import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { NativeScope } from "./retirement-replay-native.ts";
import { runSeedReplay } from "./retirement-ui-replay.ts";

const fixture = vi.hoisted(() => ({
	source: "a".repeat(40),
	runnerTar: Buffer.alloc(0),
}));
// Only artifact fixture boundaries are substituted; the coordinator, phase
// wrappers, NativeScope timeout and evidence writers all execute unchanged.
vi.mock("./retirement-replay-artifacts.ts", () => ({
	originalArchive: async () => ({ tar: fixture.runnerTar }),
	metadata: async () => ({}),
	download: async () => Buffer.alloc(0),
	unpackZip: () => ({
		"runner-products.tar.gz": fixture.runnerTar,
		"setup-receipt.json": Buffer.from(
			JSON.stringify({
				runnerSourceSHA: fixture.source,
				compileOutcome: "passed",
				mode: "setup-only",
				testExecutionAttempted: false,
				appBuildAttempted: false,
				runnerTarSHA256: createHash("sha256")
					.update(fixture.runnerTar)
					.digest("hex"),
				localNetworkingOnly: true,
			}),
		),
	}),
	verifyModes: () => {},
	productManifest: () => [],
}));
vi.mock("./retirement-ui-guards.ts", async (original) => ({
	...(await original<typeof import("./retirement-ui-guards.ts")>()),
	verifyExtractedRetained: () => ({}),
}));
const roots: string[] = [];
const fds: number[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const fd of fds.splice(0)) closeSync(fd);
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const sites = [
	"source-check",
	"original-extract",
	"runner-extract",
	"simulator-inventory",
] as const;
it.each(sites)(
	"exports the real pre-create %s timeout in both receipts",
	async (site) => {
		const parent = mkdtempSync(join(tmpdir(), "replay-precreate-"));
		roots.push(parent);
		const root = join(parent, "run");
		const fd = openSync(join(parent, "supervisor.jsonl"), "w");
		fds.push(fd);
		vi.stubEnv("LO_REPLAY_SUPERVISOR_FD", String(fd));
		const sentinel = "SECRET_SENTINEL_NEVER_EXPORT";
		vi.stubEnv("REPLAY_SECRET_TEST", sentinel);
		fixture.runnerTar = gzipSync(Buffer.alloc(1024));
		const start = NativeScope.prototype.start;
		const calls: string[] = [];
		vi.spyOn(NativeScope.prototype, "start").mockImplementation(function (
			this: NativeScope,
			exe,
			args,
		) {
			const current =
				exe === "git"
					? "source-check"
					: exe === "tar"
						? args.at(-1) === join(root, "original")
							? "original-extract"
							: "runner-extract"
						: "simulator-inventory";
			calls.push(`${exe} ${args.join(" ")}`);
			if (current === site) {
				// A real supervised slow child, not a synthetic ReplayRefused: arguments,
				// output and environment all carry the negative export sentinel.
				return start.call(
					this,
					process.execPath,
					[
						"-e",
						`console.log('${sentinel}'); setTimeout(() => {}, 60000)`,
						sentinel,
					],
					500,
				);
			}
			if (exe === "tar") {
				const destination = args.at(-1);
				if (!destination) throw new Error("missing fixture destination");
				mkdirSync(destination, { recursive: true });
				writeFileSync(
					join(
						destination,
						destination.endsWith("original")
							? "frozen-artifact.json"
							: "runner-manifest.json",
					),
					JSON.stringify(
						destination.endsWith("original")
							? { nonce: "fixture" }
							: { source: fixture.source, products: [] },
					),
				);
			}
			return {
				completion: Promise.resolve(exe === "git" ? fixture.source : ""),
				stop: async () => {},
				exitCode: () => 0,
				hasExited: () => true,
			};
		});
		const result = await runSeedReplay({
			root,
			runnerSource: fixture.source,
			compileRun: 1,
			runnerArtifact: 2,
			artifactCredential: sentinel,
			mode: "seed-replay",
		});
		expect(result?.cause).toBe("command-timeout");
		expect(result?.failedPhase).toBe(site);
		expect(calls).toEqual(
			[
				"git rev-parse HEAD",
				`tar -xzpf ${join(root, "original.tar.gz")} -C ${join(root, "original")}`,
				`tar -xzpf ${join(root, "runner.tar.gz")} -C ${join(root, "runner")}`,
				"xcrun simctl list devices available --json",
			].slice(0, sites.indexOf(site) + 1),
		);
		expect(existsSync(join(root, "creation-intent.json"))).toBe(false);
		const cleanup = JSON.parse(
			readFileSync(join(root, "evidence/cleanup.json"), "utf8"),
		);
		const seed = JSON.parse(
			readFileSync(join(root, "evidence/seed-replay.json"), "utf8"),
		);
		const { frames, ...summary } = seed;
		expect(summary).toEqual(cleanup.summary);
		expect(frames).toEqual([]);
		expect(summary.failedPhase).toBe(site);
		expect(summary.cause).toBe("command-timeout");
		expect(
			summary.phases.map((phase: { name: string; status: string }) => [
				phase.name,
				phase.status,
			]),
		).toEqual(
			sites
				.slice(0, sites.indexOf(site) + 1)
				.map((name) => [name, name === site ? "failed" : "ok"]),
		);
		expect(summary.runnerFailure).toBeNull();
		expect(Object.values(summary.observations)).toEqual(
			Array(6).fill("UNOBSERVED"),
		);
		expect(cleanup.cleanup).toEqual({
			cleanupComplete: true,
			inventoryAbsent: true,
		});
		for (const file of ["seed-replay.json", "cleanup.json"]) {
			const text = readFileSync(join(root, "evidence", file), "utf8");
			expect(text).not.toContain(sentinel);
			expect(text).not.toContain(process.execPath);
			expect(text).not.toContain("REPLAY_SECRET_TEST");
		}
		expect(readFileSync(join(parent, "supervisor.jsonl"), "utf8")).toContain(
			'"group"',
		);
	},
);
