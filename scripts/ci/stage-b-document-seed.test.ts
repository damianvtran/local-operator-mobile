import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	STAGE_B_CLOUD_DOCS,
	STAGE_B_DOCUMENT_CONTENT,
	STAGE_B_DOCUMENT_NAME,
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
	it("writes the synthetic file inside the owned simulator data root only", () => {
		const root = ownedRoot();
		const seed = seedStageBDocument(root);
		expect(seed.containerPresent).toBe(false);
		expect(seed.bytes).toBe(Buffer.byteLength(STAGE_B_DOCUMENT_CONTENT));
		expect(seed.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(seed.path).toBe(join(STAGE_B_CLOUD_DOCS, STAGE_B_DOCUMENT_NAME));
		// Nothing was written outside the CloudDocs container it created.
		expect(readdirSync(root)).toEqual(["Library"]);
		// Second call reports the container as pre-existing and stays idempotent.
		expect(seedStageBDocument(root).containerPresent).toBe(true);
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
