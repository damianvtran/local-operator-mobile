import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	STAGE_B_BUNDLE,
	type StageBProofConfig,
	validateStageBProof,
} from "../../src/testing/stage-b-draft-transport.ts";

/** Add callback-entry observation ONLY to the ephemeral proof checkout. The
 * ordinary Computers source stays byte-identical; no production runtime flag,
 * hook import, identity or callback argument is introduced into the shipped app.
 * A source mismatch is a pre-build failure, not a silently uninstrumented run. */
export function instrumentStageBComputerPick(source: string): string {
	const marker = "setPicked(computer.tunnelId);";
	if (source.includes("__stageBRowPress") || source.split(marker).length !== 2)
		throw new Error("proof row callback instrumentation source mismatch");
	return source.replace(
		marker,
		`try { (globalThis as { __stageBRowPress?: () => void }).__stageBRowPress?.(); } catch { /* Proof diagnostics cannot veto the real pick. */ }\n\t\t\t${marker}`,
	);
}

/** Revision snapshots alone miss a lease cancelled by provider unmount. Tag
 * only selectComputer's five existing superseded returns in the proof overlay;
 * preserve every predicate/return and fail before build if that source drifts. */
export function instrumentStageBSelectionFences(source: string): string {
	const start = source.indexOf("\tconst selectComputer = useCallback(");
	const end = source.indexOf("\n\tconst ", start + 1);
	if (start < 0 || end < 0)
		throw new Error("proof selection fence source mismatch");
	let span = source.slice(start, end);
	for (const [guard, count] of [
		["if (!admission.isCurrent()) return;", 4],
		["if (admission && !admission.isCurrent()) return;", 1],
	] as const) {
		if (span.split(guard).length !== count + 1)
			throw new Error("proof selection fence source mismatch");
		span = span.replaceAll(
			guard,
			guard.replace(
				"return;",
				`{ try { (globalThis as { __stageBSelectionSuperseded?: () => void }).__stageBSelectionSuperseded?.(); } catch { /* Proof telemetry cannot alter the fence. */ } return; }`,
			),
		);
	}
	return source.slice(0, start) + span + source.slice(end);
}

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
const proof = require('./src/testing/stage-b-draft-bootstrap.ts');
const initialize = proof.installStageBDraftProof(${literal});
require('@expo/metro-runtime');
const React = require('react');
const { View, Text, ActivityIndicator } = require('react-native');
const { renderRootComponent } = require('expo-router/build/renderRootComponent');
let startup;
let stage = 'registered';
let gateSplashHidden = false;
function hideGateSplash() {
  // The real router hides on navigation-ready, which deliberately cannot occur
  // before seed completion. Reveal this laid-out diagnostic gate independently.
  if (!gateSplashHidden) {
    require('expo-router/build/utils/splash').hide();
    gateSplashHidden = true;
  }
}
function StageBProofRoot() {
  const [state, setState] = React.useState({ ready: false, stage, error: null });
  React.useEffect(() => {
    let active = true;
    (startup ??= initialize((next) => { stage = next; if (active) setState((previous) => ({ ...previous, stage })); })).then(
      () => { if (active) setState({ ready: true, stage: 'complete', error: null }); },
      (reason) => {
        const error = proof.stageBSeedFailure(reason);
        console.error('Stage B seed failed stage=' + stage + ' cause=' + error.name + ': ' + error.message);
        if (active) setState({ ready: false, stage, error });
      }
    );
    return () => { active = false; };
  }, []);
  const status = 'stage=' + state.stage + ' cause=' + (state.error ? state.error.name + ': ' + state.error.message : 'pending');
  if (!state.ready) return React.createElement(View, { testID: 'stage-b-proof-gate', accessible: true, accessibilityLabel: status, onLayout: hideGateSplash }, React.createElement(Text, { testID: 'stage-b-proof-status' }, status), state.error ? null : React.createElement(ActivityIndicator));
  const { App } = require('expo-router/build/qualified-entry');
  return React.createElement(App);
}
// Synchronous registration: async seed/receipts cannot postpone native main.
renderRootComponent(StageBProofRoot);
`,
		config: `import { createRequire } from 'node:module';\nimport { join } from 'node:path';\nconst fromExpo = createRequire(require.resolve('expo/package.json'));\nconst { getDynamicConfig } = fromExpo('@expo/config/build/getConfig.js');\nconst proof = ${literal};\nexport default (context) => { const evaluated = getDynamicConfig(join(__dirname, ${originalConfig}), context); if (!evaluated?.config) throw new Error('Original Expo config could not be evaluated'); const base = evaluated.config; return { ...base, name: 'Stage B Draft Proof', scheme: 'stagebdraftproof', ios: { ...base.ios, bundleIdentifier: '${STAGE_B_BUNDLE}', infoPlist: { ...base.ios?.infoPlist, StageBProofSourceSha: proof.sourceSha, StageBProofNonce: proof.nonce, StageBProofFlavor: proof.flavor, NSAppTransportSecurity: { ...base.ios?.infoPlist?.NSAppTransportSecurity, NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true, NSExceptionDomains: { ...base.ios?.infoPlist?.NSAppTransportSecurity?.NSExceptionDomains, '127.0.0.1': { ...base.ios?.infoPlist?.NSAppTransportSecurity?.NSExceptionDomains?.['127.0.0.1'], NSExceptionAllowsInsecureHTTPLoads: true } } } } }, extra: { ...base.extra, stageBProof: proof } }; };\n`,
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
	const computersPath = join(root, "src/features/auth/computers.tsx");
	const instrumentedComputers = instrumentStageBComputerPick(
		readFileSync(computersPath, "utf8"),
	);
	const providerPath = join(root, "src/features/auth/connection-provider.tsx");
	const instrumentedProvider = instrumentStageBSelectionFences(
		readFileSync(providerPath, "utf8"),
	);
	const sources = stageBGeneratedSource(config);
	const manifest = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	) as Record<string, unknown>;
	writeFileSync(computersPath, instrumentedComputers);
	writeFileSync(providerPath, instrumentedProvider);
	renameSync(join(root, "app.config.ts"), backup);
	writeFileSync(join(root, "app.config.ts"), sources.config);
	writeFileSync(join(root, "stage-b-proof-entry.js"), sources.entry);
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ ...manifest, main: "stage-b-proof-entry.js" }, null, 2)}\n`,
	);
}
