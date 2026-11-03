import { describe, expect, it } from "vitest";
import { verifyAndroidBackupDumps } from "./stage-b-backup-rules";

const manifest = `E: manifest\n  E: application\n    A: android:fullBackupContent(0x010104eb)=@0x7f120000\n    A: android:dataExtractionRules(0x0101063e)=@0x7f120001`;
const resources = `resource 0x7f120000 xml/secure_store_backup_rules\n  () (file) res/xml/secure_store_backup_rules.xml type=XML\nresource 0x7f120001 xml/secure_store_data_extraction_rules\n  () (file) res/xml/secure_store_data_extraction_rules.xml type=XML`;
const scope = (indent: string) =>
	`${indent}E: include\n${indent}  A: domain="sharedpref"\n${indent}  A: path="."\n${indent}E: exclude\n${indent}  A: domain="sharedpref"\n${indent}  A: path="SecureStore"`;
const legacy = `E: full-backup-content\n${scope("  ")}`;
const extraction = `E: data-extraction-rules\n  E: cloud-backup\n${scope("    ")}\n  E: device-transfer\n${scope("    ")}`;
const generatedManifest =
	'<application android:fullBackupContent="@xml/secure_store_backup_rules" android:dataExtractionRules="@xml/secure_store_data_extraction_rules" />';
const input = () => ({
	manifest,
	resources,
	generatedManifest,
	xml: (path: string) =>
		path.endsWith("/secure_store_backup_rules.xml") ? legacy : extraction,
});
describe("packaged Android backup exclusions", () => {
	it("checks resolved packaged legacy, cloud and transfer policies plus generated manifest selection", () => {
		expect(verifyAndroidBackupDumps(input())).toMatchObject({
			secureStoreExcluded: true,
			vaultFileDomainExcluded: true,
			sentinelCacheNotIncluded: true,
		});
	});
	it("refuses a missing, unresolved or conflicting manifest resource", () => {
		for (const broken of [
			manifest.replace("android:fullBackupContent", "android:unknown"),
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
