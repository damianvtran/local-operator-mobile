import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type Authority,
	authorizeSystemAlert,
	inspectRetainedTar,
	inspectTarBytes,
	RETAINED,
	SYSTEM_TITLE,
	validateMembers,
	verifyArtifactMetadata,
	verifyHostedReuse,
} from "./retirement-ui-guards.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const now = 1800000000,
	udid = "11111111-1111-1111-1111-111111111111";
const authority = (): Authority => ({
	scope: "owned-retirement-proof-system-open-alert-v1",
	deviceUDID: udid,
	leaseUDID: udid,
	proofPID: 123,
	observedPID: 123,
	sourceSHA: RETAINED.sourceSHA,
	bundleSHA256: RETAINED.bundleSHA256,
	tarSHA256: RETAINED.tarSHA256,
	flavor: "auth-retirement-proof",
	bundleID: "com.localoperator.mobile.retirementproof",
	artifactID: RETAINED.artifactID,
	artifactPresent: true,
	artifactExpired: false,
	expiresAt: now + 60,
	checkedAt: now,
	openURLAt: now,
	expectedTitle: SYSTEM_TITLE,
	titleAttested: true,
});
const alert = () => ({
	title: SYSTEM_TITLE,
	buttons: ["Cancel", "Open"],
	count: 1,
});
const metadata = () => ({
	id: RETAINED.artifactID,
	expired: false,
	expires_at: new Date((now + 60) * 1000).toISOString(),
	workflow_run: { id: RETAINED.runID, head_sha: RETAINED.sourceSHA },
});
function tar(name: string, type = "0", link = "", body = Buffer.alloc(0)) {
	const header = Buffer.alloc(512);
	header.write(name, 0, 100, "utf8");
	header.write("0000644\0", 100);
	header.write("0000000\0", 108);
	header.write("0000000\0", 116);
	header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
	header.fill(32, 148, 156);
	header.write(type, 156);
	header.write(link, 157, 100, "utf8");
	header.write("ustar\0", 257);
	let sum = 0;
	for (const byte of header) sum += byte;
	header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
	return Buffer.concat([
		header,
		body,
		Buffer.alloc((512 - (body.length % 512)) % 512),
	]);
}
const end = Buffer.alloc(1024);
describe("independent system-alert runner source/setup guards (NO SDK/replay)", () => {
	it("accepts only an exactly scoped, fresh owned identity and exact single alert", () => {
		expect(authorizeSystemAlert(authority(), udid, now, alert())).toBe(true);
	});
	it.each([
		["wrong PID", { observedPID: 124 }],
		["zero PID", { proofPID: 0 }],
		["wrong device", { deviceUDID: "other" }],
		["wrong lease", { leaseUDID: "other" }],
		["wrong source", { sourceSHA: "b".repeat(40) }],
		["wrong bundle", { bundleSHA256: "b".repeat(64) }],
		["wrong tar", { tarSHA256: "b".repeat(64) }],
		["wrong flavor", { flavor: "production" }],
		["absent artifact", { artifactPresent: false }],
		["expired artifact", { artifactExpired: true }],
		["expired server date", { expiresAt: now }],
		["stale process sample", { checkedAt: now - 61 }],
		["future sample", { checkedAt: now + 1 }],
		["stale URL window", { openURLAt: now - 61 }],
		["unattested title", { titleAttested: false }],
	] as const)("refuses %s without any driver action", (_name, change) => {
		let taps = 0;
		if (authorizeSystemAlert({ ...authority(), ...change }, udid, now, alert()))
			taps++;
		expect(taps).toBe(0);
	});
	it.each([
		["straight quotes", { title: 'Open in "Local Operator"?' }],
		["wrong title", { title: "Allow access?" }],
		["missing button", { buttons: ["Open"] }],
		["extra button", { buttons: ["Cancel", "Open", "Always"] }],
		["duplicates", { buttons: ["Open", "Open"] }],
		["multiple alerts", { count: 2 }],
		["missing alert", { count: 0 }],
	])("refuses %s with no fallback", (_name, change) => {
		expect(
			authorizeSystemAlert(authority(), udid, now, { ...alert(), ...change }),
		).toBe(false);
	});
	it("requires fresh server presence even if cached archive bytes are supplied", async () => {
		let calls = 0;
		const denied = async () => {
			calls++;
			return new Response("", { status: 404 });
		};
		await expect(
			verifyHostedReuse(
				Buffer.from("cached"),
				"fixture-only",
				denied as typeof fetch,
			),
		).rejects.toThrow("refused");
		expect(calls).toBe(1);
		expect(() =>
			verifyArtifactMetadata({ ...metadata(), expired: true }, now * 1000),
		).toThrow();
		expect(() =>
			verifyArtifactMetadata(
				{ ...metadata(), expires_at: new Date(now * 1000).toISOString() },
				now * 1000,
			),
		).toThrow();
		expect(() =>
			inspectRetainedTar(
				Buffer.from("not-exact-retained-tar"),
				metadata(),
				now * 1000,
			),
		).toThrow();
	});
	it("permits ordinary members but refuses every dangerous archive naming/type control", () => {
		expect(
			validateMembers([
				{ name: "Synthetic.app", type: "directory", size: 0 },
				{ name: "Synthetic.app/file", type: "file", size: 2 },
				{ name: "Synthetic.app/link", type: "symlink", link: "file", size: 0 },
			]),
		).toHaveLength(3);
		for (const name of ["/absolute", "../escape", "Synthetic.app/../escape"]) {
			expect(() =>
				validateMembers([{ name, type: "file", size: 0 }]),
			).toThrow();
		}
		expect(() =>
			validateMembers([
				{ name: "same", type: "file", size: 0 },
				{ name: "same", type: "file", size: 0 },
			]),
		).toThrow();
		expect(() =>
			validateMembers([
				{ name: "link", type: "symlink", link: "../escape", size: 0 },
			]),
		).toThrow();
		expect(() =>
			validateMembers([
				{ name: "link/child", type: "file", size: 0 },
				{ name: "link", type: "symlink", link: "target", size: 0 },
			]),
		).toThrow();
		expect(() =>
			validateMembers([{ name: "huge", type: "file", size: 1024 ** 3 + 1 }]),
		).toThrow();
	});
	it.each([
		["link", ".."],
		["dir/link", "../.."],
	] as const)(
		"R15 direct member rejects exact-parent destination %s -> %s",
		(name, link) => {
			expect(() =>
				validateMembers([{ name, type: "symlink", link, size: 0 }]),
			).toThrow("refused");
		},
	);
	it.each([
		["link", ".."],
		["dir/link", "../.."],
	] as const)(
		"R15 tar header rejects exact-parent destination %s -> %s",
		(name, link) => {
			expect(() =>
				inspectTarBytes(Buffer.concat([tar(name, "2", link), end])),
			).toThrow("refused");
		},
	);
	it.each([
		["link", ".."],
		["dir/link", "../.."],
	] as const)(
		"R15 PAX linkpath rejects exact-parent destination %s -> %s",
		(name, link) => {
			const value = `linkpath=${link}\n`;
			let length = value.length + 2;
			while (String(length).length + 1 + value.length !== length)
				length = String(length).length + 1 + value.length;
			expect(() =>
				inspectTarBytes(
					Buffer.concat([
						tar("PaxHeader", "x", "", Buffer.from(`${length} ${value}`)),
						tar(name, "2", "safe"),
						end,
					]),
				),
			).toThrow("refused");
		},
	);
	it("parses real tar headers/checksums before extraction and refuses hardlinks/specials/PAX escapes", () => {
		expect(
			inspectTarBytes(
				Buffer.concat([
					tar("Synthetic.app/", "5"),
					tar("Synthetic.app/file", "0", "", Buffer.from("fixture")),
					tar("Synthetic.app/link", "2", "file"),
					end,
				]),
			),
		).toHaveLength(3);
		for (const type of ["1", "3", "4", "6", "L", "g"]) {
			expect(() =>
				inspectTarBytes(Buffer.concat([tar("bad", type), end])),
			).toThrow();
		}
		expect(() =>
			inspectTarBytes(Buffer.concat([tar("same"), tar("same"), end])),
		).toThrow();
		const value = "path=../escape\n";
		let length = value.length + 2;
		while (String(length).length + 1 + value.length !== length)
			length = String(length).length + 1 + value.length;
		expect(() =>
			inspectTarBytes(
				Buffer.concat([
					tar("PaxHeader", "x", "", Buffer.from(`${length} ${value}`)),
					tar("safe"),
					end,
				]),
			),
		).toThrow();
		const corrupt = tar("file");
		corrupt[0] = 0xff;
		expect(() => inspectTarBytes(Buffer.concat([corrupt, end]))).toThrow();
	});
	it("generates deterministic independent target/scheme using stdlib only, without invoking Xcode", () => {
		const root = mkdtempSync(join(tmpdir(), "retirement-ui-project-"));
		roots.push(root);
		const generator = new URL("./retirement-ui-setup.py", import.meta.url)
			.pathname;
		const program =
			"import runpy,sys;from pathlib import Path;m=runpy.run_path(sys.argv[1],run_name='source_fixture');m['project'](Path(sys.argv[2]))";
		const first = join(root, "one.xcodeproj"),
			second = join(root, "two.xcodeproj");
		for (const output of [first, second])
			execFileSync("/usr/bin/python3", ["-c", program, generator, output], {
				timeout: 5000,
			});
		const pbx = readFileSync(join(first, "project.pbxproj"), "utf8");
		expect(pbx).toBe(readFileSync(join(second, "project.pbxproj"), "utf8"));
		expect(pbx).toContain(
			'productType="com.apple.product-type.bundle.ui-testing"',
		);
		expect(pbx).toContain("dependencies=()");
		expect(pbx).not.toContain("PBXShellScriptBuildPhase");
		expect(pbx).not.toContain("PBXNativeTarget; name=LocalOperator");
	});
	it("actual setup CLI rejects a replay mode before creating outputs or invoking native tools", () => {
		const root = mkdtempSync(join(tmpdir(), "retirement-cli-negative-"));
		roots.push(root);
		const output = join(root, "must-not-exist");
		const result = spawnSync(
			"/usr/bin/python3",
			[
				new URL("./retirement-ui-setup.py", import.meta.url).pathname,
				"--mode",
				"replay",
				"--output",
				output,
			],
			{ encoding: "utf8", timeout: 5000 },
		);
		expect(result.status).toBe(2);
		expect(existsSync(output)).toBe(false);
	});
	it("setup workflow has ONLY compile mode; driver identity precedes any SpringBoard access and capture precedes tap", () => {
		const workflow = readFileSync(
			new URL(
				"../../.github/workflows/retirement-ui-setup.yml",
				import.meta.url,
			),
			"utf8",
		);
		expect(workflow).toContain("options: [setup]");
		expect(workflow).toContain("default: setup");
		expect(workflow).toContain("timeout-minutes: 10");
		expect(workflow).toContain("retention-days: 1");
		expect(workflow).not.toContain("test-without-building");
		expect(workflow).not.toContain("download-artifact");
		expect(workflow).not.toContain("simctl");
		const swift = readFileSync(
			new URL("./retirement-ui/RetainedReplayTests.swift", import.meta.url),
			"utf8",
		);
		expect(swift.indexOf("try host.useQuery(query)")).toBeGreaterThan(-1);
		expect(swift.indexOf("try host.useQuery(query)")).toBeLessThan(
			swift.indexOf("let springboard"),
		);
		expect(
			swift.indexOf('capture("owned-system-alert-before")'),
		).toBeGreaterThan(-1);
		expect(swift.indexOf('capture("owned-system-alert-before")')).toBeLessThan(
			swift.indexOf(".tap()"),
		);
		expect(swift.indexOf('if mode == "observe-only" { return }')).toBeLessThan(
			swift.indexOf('host.request("authorize-tap"'),
		);
		expect(swift.indexOf("try host.consume")).toBeLessThan(
			swift.indexOf(".tap()"),
		);
		expect(swift).not.toContain("LO_REPLAY_AUTHORITY_JSON");
		expect(swift.match(/\.tap\(\)/g)).toHaveLength(1);
		expect(swift).not.toContain("addUIInterruptionMonitor");
		const model = readFileSync(
			new URL("./retirement-ui/ReplayGuards.swift", import.meta.url),
			"utf8",
		);
		for (const value of [
			RETAINED.sourceSHA,
			RETAINED.bundleSHA256,
			RETAINED.tarSHA256,
			SYSTEM_TITLE,
		])
			expect(model).toContain(value);
	});

	it("plain loopback transport and actual-use guards share the compiled Swift fixtures", () => {
		const client = readFileSync(
			new URL("./retirement-ui/ReplayHostClient.swift", import.meta.url),
			"utf8",
		);
		const model = readFileSync(
			new URL("./retirement-ui/ReplayGuards.swift", import.meta.url),
			"utf8",
		);
		const fixture = readFileSync(
			new URL("./retirement-ui/ReplayGuardTests.swift", import.meta.url),
			"utf8",
		);
		expect(client.match(/ReplayGuards.permit\(/g)).toHaveLength(2);
		expect(client).toContain('kind: "query"');
		expect(client).toContain('kind: "tap"');
		expect(client).toContain("consumed = true");
		expect(client.indexOf("consumed = true")).toBeLessThan(
			client.lastIndexOf("ReplayGuards.permit("),
		);
		expect(client).toContain("URLSessionConfiguration.ephemeral");
		expect(client).toContain("configuration.urlCredentialStorage = nil");
		expect(client).toContain("completionHandler(nil)");
		expect(client).not.toMatch(
			/LO_REPLAY_AUTHORITY_JSON|PUBLIC_KEY|signature|Curve25519/,
		);
		expect(model).toContain("grant.session == session");
		expect(model).toContain("now < grant.expiresAt");
		expect(model).toContain("uptime >= received");
		expect(model).toContain("grant.identity == identity");
		expect(fixture).toContain("testActualUseExpiryIdentityAndClockBoundaries");
		expect(fixture).toContain(
			"testActualClientConsumesOneLocalTapAndFailedAttemptCannotRetry",
		);
	});
});
