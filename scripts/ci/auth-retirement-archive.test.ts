import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	archiveProof,
	bundleInventory,
	MAX_ARCHIVE_BYTES,
	MAX_EXTRACTED_BYTES,
} from "./auth-retirement-archive.ts";
import { immutableBundleDigest } from "./auth-retirement-ios-proof.ts";

const roots: string[] = [];
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "proof-archive-"));
	roots.push(root);
	const app = join(root, "Synthetic.app");
	mkdirSync(app);
	writeFileSync(join(app, "Executable"), "synthetic-not-native");
	chmodSync(join(app, "Executable"), 0o755);
	symlinkSync("Executable", join(app, "ExecutableLink"));
	const source = "a".repeat(40);
	const identity = {
		flavor: "auth-retirement-proof",
		bundleId: "com.localoperator.mobile.retirementproof",
		sourceSha: source,
		nonce: "b".repeat(32),
		receiverPort: 23456,
		bundleSha256: immutableBundleDigest(app),
	};
	writeFileSync(join(root, "build-identity.json"), JSON.stringify(identity));
	writeFileSync(
		join(root, "frozen-artifact.json"),
		JSON.stringify({ ...identity, schemeRegistered: true, appPath: app }),
	);
	return { root, app, source };
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
describe("fresh synthetic proof bundle retention", () => {
	it("real tar roundtrip preserves symlinks, executable modes, immutable digest and ORIGINAL frozen identities", async () => {
		const f = fixture(),
			result = await archiveProof(f.app, f.root, f.source);
		expect(result).toMatchObject({
			status: "verified-for-upload",
			sourceSha: f.source,
			quotaAvailability: "UNOBSERVED",
			retentionDays: 1,
		});
		const restored = join(f.root, "proof-bundle/verified/Synthetic.app");
		expect(lstatSync(join(restored, "ExecutableLink")).isSymbolicLink()).toBe(
			true,
		);
		expect(readlinkSync(join(restored, "ExecutableLink"))).toBe("Executable");
		expect(lstatSync(join(restored, "Executable")).mode & 0o777).toBe(0o755);
		expect(immutableBundleDigest(restored)).toBe(immutableBundleDigest(f.app));
		expect(
			readFileSync(join(f.root, "proof-bundle/verified/frozen-artifact.json")),
		).toEqual(readFileSync(join(f.root, "frozen-artifact.json")));
		const text = readFileSync(join(f.root, "archive-provenance.json"), "utf8");
		expect(text).not.toContain('"nonce"');
		expect(text).not.toContain(f.app);
	});
	it.each(["source", "flavor", "bundle", "bytes"])(
		"rejects %s tampering before tar",
		async (kind) => {
			const f = fixture();
			if (kind === "bytes")
				writeFileSync(join(f.app, "Executable"), "tampered");
			else if (kind === "flavor" || kind === "bundle") {
				const path = join(f.root, "frozen-artifact.json"),
					data = JSON.parse(readFileSync(path, "utf8"));
				data[kind === "flavor" ? "flavor" : "bundleId"] = "production";
				writeFileSync(path, JSON.stringify(data));
			}
			let calls = 0;
			await expect(
				archiveProof(
					f.app,
					f.root,
					kind === "source" ? "c".repeat(40) : f.source,
					async () => {
						calls++;
					},
				),
			).rejects.toThrow();
			expect(calls).toBe(0);
		},
	);
	it("guards compressed512MiB and extracted1GiB, skips oversized archives explicitly without extraction", async () => {
		expect(MAX_ARCHIVE_BYTES).toBe(512 * 1024 * 1024);
		expect(MAX_EXTRACTED_BYTES).toBe(1024 * 1024 * 1024);
		const f = fixture();
		let calls = 0;
		const result = await archiveProof(
			f.app,
			f.root,
			f.source,
			async (_exe, args) => {
				calls++;
				const { openSync, ftruncateSync, closeSync } = await import("node:fs");
				const fd = openSync(args[1]!, "w");
				try {
					ftruncateSync(fd, MAX_ARCHIVE_BYTES + 1);
				} finally {
					closeSync(fd);
				}
			},
		);
		expect(result).toMatchObject({
			status: "skipped",
			reason: "compressed-size-limit",
		});
		expect(calls).toBe(1);
	});
	it("archive failure and roundtrip tampering remain visible without altering proof failures", async () => {
		const f = fixture();
		writeFileSync(
			join(f.root, "failure.json"),
			JSON.stringify({ phaseFailure: { cause: "receipt-timeout" } }),
		);
		const before = readFileSync(join(f.root, "failure.json"));
		await expect(
			archiveProof(f.app, f.root, f.source, async () => {
				throw new Error("PRIVATE_TOKEN");
			}),
		).rejects.toThrow();
		expect(readFileSync(join(f.root, "failure.json"))).toEqual(before);
		const g = fixture();
		const { observationRun } = await import("./auth-retirement-capture.ts");
		let calls = 0;
		await expect(
			archiveProof(g.app, g.root, g.source, async (exe, args, budget) => {
				await observationRun(exe, args, budget);
				if (++calls === 2)
					writeFileSync(
						join(g.root, "proof-bundle/verified/Synthetic.app/Executable"),
						"tampered",
					);
			}),
		).rejects.toThrow("roundtrip mismatch");
	});
	it("rejects credential-like files and links outside the bundle", () => {
		const f = fixture();
		symlinkSync("../outside", join(f.app, "BadLink"));
		expect(() => bundleInventory(f.app)).toThrow("external symlink");
		const g = fixture();
		writeFileSync(join(g.app, ".env"), "SYNTHETIC_PRIVATE");
		expect(() => bundleInventory(g.app)).toThrow("Sensitive");
	});
	it("round14 BOTH upload blocks independently specify one-day retention", () => {
		const workflow = readFileSync(
			new URL("../../.github/workflows/ios.yml", import.meta.url),
			"utf8",
		);
		for (const label of [
			"Upload redacted native primitive evidence",
			"Upload sensitive synthetic proof bundle (one day only)",
		]) {
			const block = workflow
				.split(`      - name: ${label}\n`)[1]
				?.split("\n      - name:")[0];
			expect(block).toBeDefined();
			expect(block).toContain("retention-days: 1");
		}
	});
	it("workflow keeps tiny diagnostics independent, archive upload always-visible and one-day only", () => {
		const workflow = readFileSync(
			new URL("../../.github/workflows/ios.yml", import.meta.url),
			"utf8",
		);
		expect(workflow).toContain("steps.proof_archive.outputs.upload == 'true'");
		expect(workflow).toContain(
			"name: sensitive-synthetic-retirement-proof-app",
		);
		expect(workflow).toContain("retention-days: 1");
		expect(workflow).toContain("steps.proof_freeze.outcome == 'success'");
		expect(workflow).toContain("auth-retirement-proof/captures/*.png");
		expect(workflow).not.toMatch(/continue-on-error:\s*true/);
		expect(
			workflow.indexOf("Archive the dedicated synthetic proof"),
		).toBeLessThan(
			workflow.indexOf("Native durable retirement and restore primitives"),
		);
	});
});
