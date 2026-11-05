import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	STAGE_B_CLOUD_DOCS,
	STAGE_B_DOCUMENT_CONTENT,
	STAGE_B_DOCUMENT_NAME,
	STAGE_B_LOCAL_STORAGE_DIR,
	seedStageBDocument,
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
		expect(seed.containerPresent).toBe(false);
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
	it("refuses a path that escapes the owned simulator", () => {
		expect(() => stageBDocumentSeedPath("/owned/../../etc")).toThrow(
			"escaped the owned simulator",
		);
	});
	it("names the file without a secret, so public artifacts stay clean", () => {
		expect(STAGE_B_DOCUMENT_NAME).not.toMatch(/[0-9a-f]{16,}/);
		expect(STAGE_B_DOCUMENT_CONTENT).not.toMatch(/Bearer|canary|nonce/i);
	});
});
