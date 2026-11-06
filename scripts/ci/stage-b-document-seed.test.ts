import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	containedSeedTarget,
	STAGE_B_CLOUD_DOCS,
	STAGE_B_DOCUMENT_CONTENT,
	STAGE_B_DOCUMENT_NAME,
	STAGE_B_DOCUMENT_ROW,
	STAGE_B_LOCAL_STORAGE_DIR,
	STAGE_B_LOCAL_STORAGE_GROUP,
	seedStageBDocument,
	simulatorSeedLookup,
	stageBDocumentSeedPath,
} from "./stage-b-document-seed";

const roots: string[] = [];
const ownedRoot = () => {
	const root = mkdtempSync(join(tmpdir(), "stage-b-seed-"));
	roots.push(root);
	return root;
};
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
describe("host-side document seed for the Files picker", () => {
	it("prefers the existing iCloud Drive container and reads the file back", () => {
		const root = ownedRoot();
		mkdirSync(join(root, STAGE_B_CLOUD_DOCS), { recursive: true });
		const seed = seedStageBDocument(root);
		expect(seed.provider).toBe("cloud");
		expect(seed.containerPresent).toBe(true);
		expect(seed.bytes).toBe(Buffer.byteLength(STAGE_B_DOCUMENT_CONTENT));
		expect(seed.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(seed.path).toBe(join(STAGE_B_CLOUD_DOCS, STAGE_B_DOCUMENT_NAME));
		expect(seed.checked).toEqual(["cloud"]);
		// Only relative paths leave this module: the receipt is uploaded (R29-2).
		expect(JSON.stringify(seed)).not.toContain(root);
	});
	it("falls back to the File Provider LocalStorage group on a fresh simulator", () => {
		const root = ownedRoot();
		// 42119022926 measured containerPresent: false for CloudDocs on a fresh
		// device; the local provider's File Provider Storage is what Files shows.
		const storage = join(
			root,
			"Containers/Shared/AppGroup/GROUP-UUID",
			STAGE_B_LOCAL_STORAGE_DIR,
		);
		mkdirSync(storage, { recursive: true });
		const seed = seedStageBDocument(root, {
			cloudPresent: () => false,
			localStorageDir: () => storage,
		});
		expect(seed.provider).toBe("local");
		// containerPresent reports the CLOUD container's presence, not the choice (R29-3).
		expect(seed.containerPresent).toBe(false);
		expect(seed.checked).toEqual(["cloud", "local"]);
		expect(seed.path).toContain(
			join(STAGE_B_LOCAL_STORAGE_DIR, STAGE_B_DOCUMENT_NAME),
		);
		expect(readdirSync(storage)).toEqual([STAGE_B_DOCUMENT_NAME]);
	});
	it("names both probed locations when neither Files location exists", () => {
		const root = ownedRoot();
		expect(() =>
			seedStageBDocument(root, {
				cloudPresent: () => false,
				localStorageDir: () => null,
			}),
		).toThrow(
			/no Files location exists; checked .*com~apple~CloudDocs.*File Provider Storage/,
		);
	});
	it("refuses writes outside the owned simulator on both providers", () => {
		// The writer calls containedSeedTarget for whichever directory won, so the
		// assertion belongs on that helper — not only on the cloud-only wrapper.
		expect(containedSeedTarget("/owned", "/owned/app")).toContain(
			"/owned/app/",
		);
		expect(() => containedSeedTarget("/owned", "/elsewhere/app")).toThrow(
			"escaped the owned simulator",
		);
	});
	it("derives the picker row selector from the seeded name", () => {
		// Run 42132547421 captured the row as "stage-b-seed, txt"; the selector is
		// built from the name so a rename cannot leave it silently stale.
		expect(STAGE_B_DOCUMENT_ROW).toBe("stage-b-seed, txt(,.*)?");
		const stem = STAGE_B_DOCUMENT_NAME.split(".")[0] ?? "";
		expect(stem).not.toBe("");
		expect(STAGE_B_DOCUMENT_ROW.startsWith(stem)).toBe(true);
	});
	it("names the file without a secret, so public artifacts stay clean", () => {
		expect(STAGE_B_DOCUMENT_NAME).not.toMatch(/[0-9a-f]{16,}/);
		expect(STAGE_B_DOCUMENT_CONTENT).not.toMatch(/Bearer|canary|nonce/i);
	});
});

describe("Files provider resolution from the device's own container metadata", () => {
	// The scan shells out to plutil for each Apple group; the mock returns the
	// identifier the real plist declares, keyed by the directory asked about.
	const deviceRoot = () => {
		const root = mkdtempSync(join(tmpdir(), "stage-b-lookup-"));
		roots.push(root);
		const groups = join(root, "Containers/Shared/AppGroup");
		// Alphabetical order puts NOT-OURS first; a directory-order scan would
		// therefore pick the wrong group, so only identifier matching can pass.
		for (const name of ["AAA-NOT-OURS", "ZZZ-LOCAL-STORAGE"]) {
			mkdirSync(join(groups, name, STAGE_B_LOCAL_STORAGE_DIR), {
				recursive: true,
			});
			writeFileSync(
				join(
					groups,
					name,
					".com.apple.mobile_container_manager.metadata.plist",
				),
				"plist",
			);
		}
		return root;
	};
	it("selects the File Provider LocalStorage group by identifier, not order", () => {
		const root = deviceRoot();
		// The reader is injected: the real one shells out to plutil, and an ESM
		// namespace export cannot be spied on.
		const lookup = simulatorSeedLookup(root, (directory) =>
			directory.includes("ZZZ-LOCAL-STORAGE")
				? STAGE_B_LOCAL_STORAGE_GROUP
				: "group.com.apple.SomethingElse",
		);
		expect(lookup.cloudPresent()).toBe(false);
		expect(lookup.localStorageDir()).toBe(
			join(
				root,
				"Containers/Shared/AppGroup/ZZZ-LOCAL-STORAGE",
				STAGE_B_LOCAL_STORAGE_DIR,
			),
		);
	});
	it("reports no location when no group matches and CloudDocs is absent", () => {
		const root = deviceRoot();
		const lookup = simulatorSeedLookup(root, () => null);
		expect(lookup.localStorageDir()).toBeNull();
		expect(() => seedStageBDocument(root, lookup)).toThrow(
			/no Files location exists/,
		);
	});
});

describe("the real group reader shells out to plutil", () => {
	const hasPlutil = (() => {
		try {
			execFileSync("plutil", ["-help"], { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	})();
	it.skipIf(!hasPlutil)(
		"resolves the group whose plist declares the identifier",
		() => {
			const root = mkdtempSync(join(tmpdir(), "stage-b-realplist-"));
			roots.push(root);
			const groups = join(root, "Containers/Shared/AppGroup");
			const ours = join(groups, "ZZZ-OURS");
			const theirs = join(groups, "AAA-THEIRS");
			for (const [directory, identifier] of [
				[ours, STAGE_B_LOCAL_STORAGE_GROUP],
				[theirs, "group.com.apple.SomethingElse"],
			] as const) {
				mkdirSync(join(directory, STAGE_B_LOCAL_STORAGE_DIR), {
					recursive: true,
				});
				writeFileSync(
					join(directory, ".com.apple.mobile_container_manager.metadata.plist"),
					`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>MCMMetadataIdentifier</key><string>${identifier}</string></dict></plist>
`,
				);
			}
			// No injected reader: this runs readGroupIdentifier and execFileSync.
			expect(simulatorSeedLookup(root).localStorageDir()).toBe(
				join(ours, STAGE_B_LOCAL_STORAGE_DIR),
			);
		},
	);
});
