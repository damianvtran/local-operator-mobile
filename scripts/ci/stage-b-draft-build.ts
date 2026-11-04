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
	// Expo transpiles its selected dynamic config, not arbitrary Node imports.
	// Evaluate the backup through that same pinned Expo API and forward context:
	// native ESM loses __dirname, while extensionless Node require cannot find TS.
	const originalConfig = JSON.stringify("app.stage-b-original.ts");
	return {
		// Match entry-classic's real App/renderRootComponent APIs, but defer importing
		// App until seed completion. Importing the real provider earlier races its
		// cold credential restore; awaiting seed before registration races native main.
		entry: `// Dedicated CI artifact only. Install transport BEFORE real app imports.
const initialize = require('./src/testing/stage-b-draft-bootstrap.ts').installStageBDraftProof(${literal});
require('@expo/metro-runtime');
const React = require('react');
const { View, ActivityIndicator } = require('react-native');
const { renderRootComponent } = require('expo-router/build/renderRootComponent');
let startup;
function StageBProofRoot() {
  const [state, setState] = React.useState({ ready: false, error: null });
  React.useEffect(() => {
    let active = true;
    (startup ??= initialize()).then(
      () => { if (active) setState({ ready: true, error: null }); },
      () => { if (active) setState({ ready: false, error: new Error('Dedicated Stage B bootstrap failed') }); }
    );
    return () => { active = false; };
  }, []);
  if (state.error) throw state.error;
  if (!state.ready) return React.createElement(View, { testID: 'stage-b-bootstrap-loading' }, React.createElement(ActivityIndicator));
  const { App } = require('expo-router/build/qualified-entry');
  return React.createElement(App);
}
// Synchronous registration: async seed/receipts cannot postpone native main.
renderRootComponent(StageBProofRoot);
`,
		config: `import { createRequire } from 'node:module';\nimport { join } from 'node:path';\nconst fromExpo = createRequire(require.resolve('expo/package.json'));\nconst { getDynamicConfig } = fromExpo('@expo/config/build/getConfig.js');\nconst proof = ${literal};\nexport default (context) => { const evaluated = getDynamicConfig(join(__dirname, ${originalConfig}), context); if (!evaluated?.config) throw new Error('Original Expo config could not be evaluated'); const base = evaluated.config; return { ...base, name: 'Stage B Draft Proof', scheme: 'stagebdraftproof', ios: { ...base.ios, bundleIdentifier: '${STAGE_B_BUNDLE}', infoPlist: { ...base.ios?.infoPlist, StageBProofSourceSha: proof.sourceSha, StageBProofNonce: proof.nonce, StageBProofFlavor: proof.flavor, NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } }, extra: { ...base.extra, stageBProof: proof } }; };\n`,
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
