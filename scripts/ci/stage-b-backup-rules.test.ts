import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseAaptXmlTree,
	verifyAndroidBackupDumps,
} from "./stage-b-backup-rules";

// AOSP Debug.cpp XML printer emits namespace URI + ':' + attr.name.
// https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Debug.cpp
const android = "http://schemas.android.com/apk/res/android:";
const manifest = `N: android=http://schemas.android.com/apk/res/android (line=1)\n  E: manifest (line=1)\n    E: application (line=2)\n      A: ${android}fullBackupContent(0x010104eb)=@0x7f120000 (Raw: "@xml/not_the_compiled_reference")\n      A: ${android}dataExtractionRules(0x0101063e)=@0x7f120001`;
const resources = `resource 0x7f120000 xml/secure_store_backup_rules\n  () (file) res/xml/secure_store_backup_rules.xml type=XML\nresource 0x7f120001 xml/secure_store_data_extraction_rules\n  () (file) res/xml/secure_store_data_extraction_rules.xml type=XML`;
const scope = (indent: string) =>
	`${indent}E: include (line=3)\n${indent}  A: domain="sharedpref"\n${indent}  A: path="."\n${indent}E: exclude (line=4)\n${indent}  A: domain="sharedpref"\n${indent}  A: path="SecureStore"`;
const legacy = `E: full-backup-content (line=1)\n${scope("  ")}`;
const extraction = `E: data-extraction-rules (line=1)\n  E: cloud-backup (line=2)\n${scope("    ")}\n  E: device-transfer (line=5)\n${scope("    ")}`;
const generatedManifest =
	'<application android:fullBackupContent="@xml/secure_store_backup_rules" android:dataExtractionRules="@xml/secure_store_data_extraction_rules" />';
const input = () => ({
	manifest,
	resources,
	generatedManifest,
	xml: (path: string) =>
		path.endsWith("/secure_store_backup_rules.xml") ? legacy : extraction,
});
const owned: string[] = [];
afterEach(() => {
	for (const directory of owned.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function instrument(policy: string) {
	const directory = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"stage-b-aapt-fixture-",
		),
	);
	owned.push(directory);
	const apk = join(directory, "synthetic.apk");
	writeFileSync(apk, "synthetic artifact, not native proof");
	const tool = join(directory, "aapt-fixture.mjs");
	const dumps = {
		resources,
		"AndroidManifest.xml": manifest,
		"res/xml/secure_store_backup_rules.xml": policy,
		"res/xml/secure_store_data_extraction_rules.xml": extraction,
	};
	writeFileSync(
		tool,
		`#!${process.execPath}\nconst dumps = ${JSON.stringify(dumps)};\nprocess.stdout.write(dumps[process.argv.includes('resources') ? 'resources' : process.argv.at(-1)] ?? '');\n`,
		{ mode: 0o700 },
	);
	const receipt = join(directory, "receipt", "receipt.json");
	const command = () =>
		execFileSync(
			process.execPath,
			[
				join(import.meta.dirname, "stage-b-backup-rules.ts"),
				"--apk",
				apk,
				"--aapt2",
				tool,
				"--source",
				"a".repeat(40),
				"--variant",
				"debug",
				"--output",
				receipt,
			],
			{ encoding: "utf8", stdio: "pipe", timeout: 30000 },
		);
	return { directory: join(directory, "receipt"), receipt, command };
}
describe("packaged Android backup exclusions", () => {
	it.each(["id", "name", "qualified-name"])(
		"resolves compiled %s references rather than their Raw annotation",
		(form) => {
			let text = manifest;
			if (form !== "id")
				text = text
					.replace(
						"@0x7f120000",
						`@${form === "qualified-name" ? "com.example:" : ""}xml/secure_store_backup_rules`,
					)
					.replace(
						"@0x7f120001",
						`@${form === "qualified-name" ? "com.example:" : ""}xml/secure_store_data_extraction_rules`,
					);
			const table =
				form === "qualified-name"
					? resources.replaceAll(" xml/", " com.example:xml/")
					: resources;
			expect(
				verifyAndroidBackupDumps({
					...input(),
					manifest: text,
					resources: table,
				}).selected.fullBackupContent,
			).toBe("secure_store_backup_rules");
		},
	);
	it("rejects unknown namespaces, short invented prefixes, malformed attributes and duplicates", () => {
		for (const bad of [
			manifest.replace(android, "http://unknown.example/android:"),
			manifest.replace(android, "android:"),
			manifest +
				`\n      A: ${android}fullBackupContent(0x010104eb)=@0x7f120000`,
			`${manifest}\n      A: ???`,
		])
			expect(() => parseAaptXmlTree(bad)).toThrow();
		expect(() =>
			verifyAndroidBackupDumps({
				...input(),
				resources: `${resources}\nresource 0x7f120000 xml/other`,
			}),
		).toThrow("ambiguous");
	});
	it.each([true, false])(
		"retains manifest, resources and BOTH XML dumps when the CLI passes=%s",
		(pass) => {
			const x = instrument(
				pass
					? legacy
					: legacy.replaceAll('domain="sharedpref"', 'domain="file"'),
			);
			if (pass) expect(x.command()).toContain("PASS packaged debug");
			else expect(x.command).toThrow();
			expect(
				readFileSync(join(x.directory, "manifest.xmltree.txt"), "utf8"),
			).toBe(manifest);
			expect(readFileSync(join(x.directory, "resources.txt"), "utf8")).toBe(
				resources,
			);
			const index = JSON.parse(
				readFileSync(join(x.directory, "xml-index.json"), "utf8"),
			) as Record<string, string>;
			expect(Object.keys(index)).toHaveLength(2);
			for (const filename of Object.values(index))
				expect(readdirSync(x.directory)).toContain(filename);
			const receipt = JSON.parse(readFileSync(x.receipt, "utf8"));
			if (pass) expect(receipt.releaseVariantVerified).toBe(false);
			else expect(receipt).toMatchObject({ passed: false });
		},
	);
	it("checks resolved packaged legacy, cloud and transfer policies plus generated manifest selection", () => {
		expect(verifyAndroidBackupDumps(input())).toMatchObject({
			secureStoreExcluded: true,
			vaultFileDomainExcluded: true,
			sentinelCacheNotIncluded: true,
		});
	});
	it("refuses a missing, unresolved or conflicting manifest resource", () => {
		for (const broken of [
			manifest.replace(`${android}fullBackupContent`, `${android}unknown`),
			manifest.replace("0x7f120000", "0x7f999999"),
		])
			expect(() =>
				verifyAndroidBackupDumps({ ...input(), manifest: broken }),
			).toThrow();
		expect(() =>
			verifyAndroidBackupDumps({
				...input(),
				generatedManifest: generatedManifest.replace(
					"@xml/secure_store_backup_rules",
					"@xml/unsafe_backup",
				),
			}),
		).toThrow("different rules");
	});
	it("refuses missing device transfer, exposed key material and file-domain backups", () => {
		for (const broken of [
			extraction.replace("device-transfer", "missing-transfer"),
			extraction.replaceAll('path="SecureStore"', 'path="Other"'),
			extraction.replaceAll('domain="sharedpref"', 'domain="file"'),
		])
			expect(() =>
				verifyAndroidBackupDumps({
					...input(),
					xml: (path) =>
						path.endsWith("/secure_store_backup_rules.xml") ? legacy : broken,
				}),
			).toThrow();
	});
	it("refuses ambiguous qualifier variants and an unreadable instrument", () => {
		expect(() =>
			verifyAndroidBackupDumps({
				...input(),
				resources: resources.replace(
					"type=XML",
					"type=XML\n () (file) res/xml-v31/secure_store_backup_rules.xml type=XML",
				),
			}),
		).toThrow("ambiguous");
		expect(() =>
			verifyAndroidBackupDumps({ ...input(), xml: () => "" }),
		).toThrow("not decoded");
	});
});
