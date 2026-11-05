/** Retain only the newly built dedicated synthetic proof, never a production
 * app or a relabelled earlier run. Original identity JSONs stay inside the
 * sensitive archive; its public manifest is deliberately coarser. */
import { createHash } from "node:crypto";
import {
	copyFileSync,
	createReadStream,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	statfsSync,
	statSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ObservationRun,
	observationRun,
} from "./auth-retirement-capture.ts";
import { immutableBundleDigest } from "./auth-retirement-ios-proof.ts";
import { writeEvidenceAtomic } from "./auth-retirement-progress.ts";
import { assertProofBuild } from "./auth-retirement-proof-contract.ts";
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 50000;
/** Symlinks are retained as links, but may never escape this synthetic app.
 * Bound files and metadata before tar/extraction; reject devices/sockets and
 * credential-looking files rather than silently modifying the frozen bundle. */
export function bundleInventory(app: string) {
	let bytes = 0,
		entries = 0;
	const modes: Record<string, number> = {};
	function walk(path: string) {
		const stat = lstatSync(path),
			name = relative(app, path);
		if (++entries > MAX_ENTRIES) throw new Error("Proof bundle entry limit");
		modes[name] = stat.mode & 0o777;
		if (stat.isSymbolicLink()) {
			const target = readlinkSync(path);
			if (
				isAbsolute(target) ||
				relative(app, resolve(dirname(path), target)).startsWith("..")
			)
				throw new Error("Proof bundle external symlink");
		} else if (stat.isDirectory()) {
			for (const child of readdirSync(path)) walk(join(path, child));
		} else if (stat.isFile()) {
			if (
				/^(?:\.env(?:\..*)?|.*\.(?:p12|pfx|key|pem)|credentials.*)$/i.test(
					basename(path),
				)
			)
				throw new Error("Sensitive proof bundle entry");
			bytes += stat.size;
			if (bytes > MAX_EXTRACTED_BYTES)
				throw new Error("Proof bundle extracted size limit");
		} else throw new Error("Unsupported proof bundle entry");
	}
	walk(app);
	return { bytes, entries, modes };
}
export async function archiveProof(
	app: string,
	root: string,
	sourceSha: string,
	run: ObservationRun = observationRun,
) {
	const frozen = JSON.parse(
			readFileSync(join(root, "frozen-artifact.json"), "utf8"),
		),
		build = JSON.parse(readFileSync(join(root, "build-identity.json"), "utf8"));
	if (
		!/^[a-f0-9]{40}$/.test(sourceSha) ||
		sourceSha !== frozen.sourceSha ||
		frozen.sourceSha !== build.sourceSha ||
		resolve(app) !== resolve(frozen.appPath)
	)
		throw new Error("Proof archive source mismatch");
	assertProofBuild(frozen, { ...build, bundleSha256: frozen.bundleSha256 });
	if (
		frozen.schemeRegistered !== true ||
		immutableBundleDigest(app) !== frozen.bundleSha256
	)
		throw new Error("Proof archive content mismatch");
	const inventory = bundleInventory(app),
		fs = statfsSync(root);
	if (fs.bavail * fs.bsize < inventory.bytes * 3 + MAX_ARCHIVE_BYTES)
		throw new Error("Proof archive local space preflight");
	const transport = join(root, "proof-bundle");
	mkdirSync(transport);
	const stage = join(transport, "stage");
	mkdirSync(stage);
	copyFileSync(
		join(root, "frozen-artifact.json"),
		join(stage, "frozen-artifact.json"),
	);
	copyFileSync(
		join(root, "build-identity.json"),
		join(stage, "build-identity.json"),
	);
	const archive = join(transport, "synthetic-proof-app.tar.gz");
	// tar defaults preserve symlinks; do NOT add -h/--dereference. No retry.
	await run(
		"tar",
		[
			"-czpf",
			archive,
			"-C",
			dirname(app),
			basename(app),
			"-C",
			stage,
			"frozen-artifact.json",
			"build-identity.json",
		],
		30000,
	);
	const archiveBytes = statSync(archive).size;
	const provenance = {
		sourceSha,
		bundleSha256: frozen.bundleSha256,
		platform: "ios-simulator",
		flavor: frozen.flavor,
		archiveBytes,
		extractedBytes: inventory.bytes,
		quotaAvailability: "UNOBSERVED",
		quotaReason: "billing-storage-api-unavailable",
		retentionDays: 1,
	};
	if (archiveBytes > MAX_ARCHIVE_BYTES) {
		const result = {
			...provenance,
			status: "skipped",
			reason: "compressed-size-limit",
		};
		writeEvidenceAtomic(root, "archive-provenance.json", result);
		return result;
	}
	const extracted = join(transport, "verified");
	mkdirSync(extracted);
	await run("tar", ["-xzpf", archive, "-C", extracted], 30000);
	const restored = join(extracted, basename(app));
	if (
		immutableBundleDigest(restored) !== frozen.bundleSha256 ||
		JSON.stringify(bundleInventory(restored)) !== JSON.stringify(inventory) ||
		!readFileSync(join(extracted, "frozen-artifact.json")).equals(
			readFileSync(join(root, "frozen-artifact.json")),
		) ||
		!readFileSync(join(extracted, "build-identity.json")).equals(
			readFileSync(join(root, "build-identity.json")),
		)
	)
		throw new Error("Proof archive roundtrip mismatch");
	const transportHash = createHash("sha256");
	for await (const chunk of createReadStream(archive))
		transportHash.update(chunk);
	const result = {
		...provenance,
		status: "verified-for-upload",
		transportSha256: transportHash.digest("hex"),
	};
	writeEvidenceAtomic(root, "archive-provenance.json", result);
	return result;
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [app, root, source] = process.argv.slice(2);
	if (!app || !root || !source)
		throw new Error("Proof archive arguments required");
	try {
		const result = await archiveProof(resolve(app), resolve(root), source);
		if (result.status === "skipped")
			console.warn(
				"::warning::Synthetic proof archive skipped: compressed-size-limit; bundle NOT retained",
			);
		if (process.env.GITHUB_OUTPUT) {
			const { appendFileSync } = await import("node:fs");
			appendFileSync(
				process.env.GITHUB_OUTPUT,
				`upload=${result.status === "verified-for-upload"}\n`,
			);
		}
	} catch {
		writeEvidenceAtomic(resolve(root), "archive-provenance.json", {
			status: "error",
			quotaAvailability: "UNOBSERVED",
		});
		process.exitCode = 1;
	}
}
