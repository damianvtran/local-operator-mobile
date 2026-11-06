import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** 42078247373 proved PhotoKit ingest cannot be made to work here: the fresh
 * simulator library rebuilds thumbnails inside assetsd while holding the changes
 * transaction in an untimed CMPhoto HEIF transcode, so every `addmedia` waits
 * forever (core stack recorded on the PR). The attachment proof therefore uses
 * the Files document picker, which needs no Photos ingest. */
export const STAGE_B_DOCUMENT_NAME = "stage-b-seed.txt";
/** iOS spells the seeded file's extension out in the accessibility tree: run
 * 42132547421 captured resource-id "stage-b-seed, txt" and accessibilityText
 * "stage-b-seed, txt, 12:54 AM, 34 bytes", so an exact ".txt" match never
 * lands. Anchored on our own synthetic name, so no other Files row can match. */
export const STAGE_B_DOCUMENT_ROW = `${STAGE_B_DOCUMENT_NAME.replace(
	".",
	", ",
)}(,.*)?`;
/** The picker CELL's own resource-id, exactly as run 42132547421 captured it
 * ("stage-b-seed, txt"). Selecting by id rather than by a text regex is what run
 * 42262867379 needed: its text-regex tap completed on a label that does not
 * select, and the picker stayed open with no Open button. */
export const STAGE_B_DOCUMENT_ROW_ID = STAGE_B_DOCUMENT_NAME.replace(".", ", ");
/** Synthetic, non-secret content. A canary would leak into a public artifact
 * through the file name alone, and the attachment strip proves the same thing. */
export const STAGE_B_DOCUMENT_CONTENT = "Stage B synthetic attachment seed\n";
export const STAGE_B_CLOUD_DOCS =
	"Library/Mobile Documents/com~apple~CloudDocs";
/** iOS 17+ Files' local provider ("On My iPhone") is the File Provider
 * LocalStorage group's `File Provider Storage` directory. Run 42119022926 showed
 * `containerPresent: false` for CloudDocs on a fresh simulator, so this is the
 * location that actually exists there; CloudDocs stays preferred when present. */
export const STAGE_B_LOCAL_STORAGE_GROUP =
	"group.com.apple.FileProvider.LocalStorage";
export const STAGE_B_LOCAL_STORAGE_DIR = "File Provider Storage";

export type StageBDocumentProvider = "cloud" | "local";
/** Labels, not host paths: the receipt is uploaded, so an absolute /Users/...
 * device path is an unnecessary disclosure (review R29-2). */
export const STAGE_B_PROVIDER_PROSE: Readonly<
	Record<StageBDocumentProvider, string>
> = {
	cloud: "iCloud Drive (Documents/com~apple~CloudDocs)",
	local: "On My iPhone (File Provider Storage)",
};
export interface StageBDocumentSeed {
	provider: StageBDocumentProvider;
	/** Providers probed, in order; safe to upload. */
	checked: StageBDocumentProvider[];
	/** Simulator-relative path, safe to upload. */
	path: string;
	bytes: number;
	sha256: string;
	containerPresent: boolean;
}
export interface StageBSeedLookup {
	/** True when the simulator's iCloud Drive container already exists. */
	cloudPresent: () => boolean;
	/** The LocalStorage group's `File Provider Storage` directory, if any. */
	localStorageDir: () => string | null;
}
/** Reads each App Group's container metadata rather than guessing a UUID: the
 * group identifier is the only stable name, and a wrong directory would seed a
 * file the browser never shows. Bounded to a shallow listing of the shared
 * container directory the simulator itself maintains. */
const readGroupIdentifier = (directory: string): string | null => {
	try {
		return execFileSync(
			"plutil",
			[
				"-extract",
				"MCMMetadataIdentifier",
				"raw",
				"-o",
				"-",
				join(directory, ".com.apple.mobile_container_manager.metadata.plist"),
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
	} catch {
		return null;
	}
};
export const simulatorSeedLookup = (
	dataRoot: string,
	/** Injected in tests: the real reader shells out to plutil. */
	readIdentifier: (directory: string) => string | null = readGroupIdentifier,
): StageBSeedLookup => ({
	cloudPresent: () => existsSync(join(dataRoot, STAGE_B_CLOUD_DOCS)),
	localStorageDir: () => {
		const groups = join(dataRoot, "Containers/Shared/AppGroup");
		if (!existsSync(groups)) return null;
		for (const entry of readdirSync(groups)) {
			const directory = join(groups, entry);
			const storage = join(directory, STAGE_B_LOCAL_STORAGE_DIR);
			if (
				readIdentifier(directory) === STAGE_B_LOCAL_STORAGE_GROUP &&
				existsSync(storage)
			)
				return storage;
		}
		return null;
	},
});
/** The device data root is the owned simulator's own directory; a caller that
 * cannot prove it owns that UDID must never reach this function. */
/** Every write goes through this, whichever provider won: the guard the module
 * documents must cover the write it performs, not only the cloud candidate
 * (review R29-4). */
export function containedSeedTarget(
	dataRoot: string,
	directory: string,
): string {
	const path = join(directory, STAGE_B_DOCUMENT_NAME);
	if (!path.startsWith(`${dataRoot}/`))
		throw new Error("document seed path escaped the owned simulator");
	return path;
}
export function stageBDocumentSeedPath(dataRoot: string): string {
	return containedSeedTarget(dataRoot, join(dataRoot, STAGE_B_CLOUD_DOCS));
}
export function seedStageBDocument(
	dataRoot: string,
	lookup: StageBSeedLookup = simulatorSeedLookup(dataRoot),
	/** Warm-up outcome, so a still-missing provider fails with the wait named. */
	registration?: {
		needed: boolean;
		filesApp: string | null;
		filesStage?: string;
		filesDetail?: string;
		elapsedMs: number;
		polls: number;
	},
): StageBDocumentSeed {
	const cloud = join(dataRoot, STAGE_B_CLOUD_DOCS);
	// Captured BEFORE any seeding: the field means "the cloud container already
	// existed", not "we chose cloud" (review R29-3).
	const cloudPresent = lookup.cloudPresent();
	const local = lookup.localStorageDir();
	// CloudDocs first: it is the canonical iCloud Drive location and needs no
	// provider scan. A fresh simulator has none, which run 42119022926 measured.
	const [provider, directory] = cloudPresent
		? (["cloud", cloud] as const)
		: local
			? (["local", local] as const)
			: (() => {
					throw new Error(
						`document-seed failed: no Files location exists; checked ${STAGE_B_PROVIDER_PROSE.cloud} and ${STAGE_B_PROVIDER_PROSE.local}; providerRegistration: unavailable${
							registration
								? ` (warm-up ${registration.needed ? "launched" : "skipped"} ` +
									`${registration.filesApp ?? "no Files app resolved"}, ` +
									`waited ${registration.elapsedMs}ms over ${registration.polls} polls)`
								: ""
						}`,
					);
				})();
	mkdirSync(directory, { recursive: true });
	const target = containedSeedTarget(dataRoot, directory);
	writeFileSync(target, STAGE_B_DOCUMENT_CONTENT);
	// Read back through the same path: a seeding bug must fail here, not on the
	// device, where the only symptom would be an empty document browser.
	const written = readFileSync(target);
	if (written.toString() !== STAGE_B_DOCUMENT_CONTENT)
		throw new Error("seeded document did not read back");
	return {
		provider,
		checked: provider === "cloud" ? ["cloud"] : ["cloud", "local"],
		path: target.slice(dataRoot.length + 1),
		bytes: written.byteLength,
		sha256: createHash("sha256").update(written).digest("hex"),
		containerPresent: cloudPresent,
	};
}
