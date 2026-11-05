import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 42078247373 proved PhotoKit ingest cannot be made to work here: the fresh
 * simulator library rebuilds thumbnails inside assetsd while holding the changes
 * transaction in an untimed CMPhoto HEIF transcode, so every `addmedia` waits
 * forever (core stack recorded on the PR). The attachment proof therefore uses
 * the Files document picker, which needs no Photos ingest. The file is seeded
 * host-side into the simulator's iCloud Drive container — the smallest location
 * the document browser can show without app config changes (file sharing in
 * Info.plist would be a product change) and without a Photos library write. */
export const STAGE_B_DOCUMENT_NAME = "stage-b-seed.txt";
/** Synthetic, non-secret content. A canary would leak into a public artifact
 * through the file name alone, and the attachment strip proves the same thing. */
export const STAGE_B_DOCUMENT_CONTENT = "Stage B synthetic attachment seed\n";
export const STAGE_B_CLOUD_DOCS =
	"Library/Mobile Documents/com~apple~CloudDocs";

export interface StageBDocumentSeed {
	/** Simulator-relative path, safe to upload. */
	path: string;
	bytes: number;
	sha256: string;
	containerPresent: boolean;
}
/** The device data root is the owned simulator's own directory; a caller that
 * cannot prove it owns that UDID must never reach this function. */
export function stageBDocumentSeedPath(dataRoot: string): string {
	if (!join(dataRoot, STAGE_B_CLOUD_DOCS).startsWith(dataRoot))
		throw new Error("document seed path escaped the owned simulator");
	return join(dataRoot, STAGE_B_CLOUD_DOCS, STAGE_B_DOCUMENT_NAME);
}
export function seedStageBDocument(dataRoot: string): StageBDocumentSeed {
	const directory = join(dataRoot, STAGE_B_CLOUD_DOCS);
	const path = stageBDocumentSeedPath(dataRoot);
	const containerPresent = existsSync(directory);
	mkdirSync(directory, { recursive: true });
	writeFileSync(path, STAGE_B_DOCUMENT_CONTENT);
	// Read back through the same path: a seeding bug must fail here, not on the
	// device, where the only symptom would be an empty document browser.
	const written = readFileSync(path);
	if (written.toString() !== STAGE_B_DOCUMENT_CONTENT)
		throw new Error("seeded document did not read back");
	return {
		path: join(STAGE_B_CLOUD_DOCS, STAGE_B_DOCUMENT_NAME),
		bytes: written.byteLength,
		sha256: createHash("sha256").update(written).digest("hex"),
		containerPresent,
	};
}
