import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	STAGE_B_BUNDLE,
	type StageBProofConfig,
	validateStageBProof,
} from "../../src/testing/stage-b-draft-transport.ts";

/** Generates a proof-only entry in an ephemeral owned CI checkout. Ordinary
 * package.main/app.config are never committed or given a runtime proof flag. */
export function stageBGeneratedSource(config: StageBProofConfig) {
	validateStageBProof(config);
	const literal = JSON.stringify(config);
	return {
		entry: `// Dedicated CI artifact only. Install transport BEFORE real app imports.\nrequire('./src/testing/stage-b-draft-bootstrap.ts').bootStageBDraftProof(${literal}).then(() => require('expo-router/entry')).catch(() => { throw new Error('Dedicated Stage B bootstrap failed'); });\n`,
		config: `import base from './app.stage-b-original';\nconst proof = ${literal};\nexport default { ...base, name: 'Stage B Draft Proof', scheme: 'stagebdraftproof', ios: { ...base.ios, bundleIdentifier: '${STAGE_B_BUNDLE}', infoPlist: { ...base.ios?.infoPlist, StageBProofSourceSha: proof.sourceSha, StageBProofNonce: proof.nonce, StageBProofFlavor: proof.flavor, NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } }, extra: { ...base.extra, stageBProof: proof } };\n`,
	};
}
export function prepareStageBProof(
	root: string,
	config: StageBProofConfig,
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (
		env.CI !== "true" ||
		env.GITHUB_ACTIONS !== "true" ||
		env.GITHUB_REPOSITORY !== "damianvtran/local-operator-mobile" ||
		env.GITHUB_EVENT_NAME !== "pull_request" ||
		env.STAGE_B_NATIVE_APPROVED !== "true"
	)
		throw new Error(
			"dedicated native proof requires its approved trusted PR lane",
		);
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	if (head !== config.sourceSha || head !== env.STAGE_B_SOURCE_SHA)
		throw new Error("native proof source SHA mismatch");
	if (
		execFileSync("git", ["status", "--porcelain"], {
			cwd: root,
			encoding: "utf8",
		}).trim()
	)
		throw new Error("native proof needs a clean owned CI checkout");
	const backup = join(root, "app.stage-b-original.ts");
	if (existsSync(backup) || existsSync(join(root, "stage-b-proof-entry.js")))
		throw new Error("proof generation already exists");
	const sources = stageBGeneratedSource(config);
	const manifest = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	) as Record<string, unknown>;
	renameSync(join(root, "app.config.ts"), backup);
	writeFileSync(join(root, "app.config.ts"), sources.config);
	writeFileSync(join(root, "stage-b-proof-entry.js"), sources.entry);
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ ...manifest, main: "stage-b-proof-entry.js" }, null, 2)}\n`,
	);
}
