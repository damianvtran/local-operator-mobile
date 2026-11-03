"use strict";
/** Proof-flavor instrumentation ONLY. Installed Expo57 uses a plain AppDelegate
 * (no scene manifest), so observe its native openURL entry without changing
 * forwarding. Native ingress and JS/HTTP progress are independent observations;
 * a missing HTTP marker may be a transport failure, not missing native ingress. */
const { withAppDelegate } = require("expo/config-plugins");
const INGRESS = "loretirementproof-native-ingress";
const READY = "loretirementproof-native-log-ready";
const RETURN =
	"return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)";
function unique(source, pattern) {
	const matches = [...source.matchAll(pattern)];
	if (matches.length !== 1)
		throw new Error("Unsupported or ambiguous proof AppDelegate target");
	return matches[0];
}
function instrument(contents, language) {
	if (language !== "swift")
		throw new Error("Proof native markers require Swift AppDelegate");
	let source = contents;
	const open =
		/public override func application\(\s*_ app: UIApplication,\s*open url: URL,\s*options: \[UIApplication.OpenURLOptionsKey: Any\] = \[:\]\s*\) -> Bool \{/g;
	const launch =
		/public override func application\(\s*_ application: UIApplication,\s*didFinishLaunchingWithOptions launchOptions: \[UIApplication.LaunchOptionsKey: Any\]\? = nil\s*\) -> Bool \{/g;
	const handler = unique(source, open),
		forward = source.indexOf(RETURN),
		end = source.indexOf("\n  }", handler.index + handler[0].length);
	if (
		forward < handler.index + handler[0].length ||
		end < 0 ||
		forward > end ||
		source.indexOf(RETURN, forward + 1) !== -1
	)
		throw new Error("Unsupported proof forwarding return");
	const ingress = `NSLog("${INGRESS}")`;
	const ingressCount = source.split(INGRESS).length - 1;
	if (ingressCount === 0)
		source =
			source.slice(0, forward) + ingress + "\n    " + source.slice(forward);
	else if (
		ingressCount !== 1 ||
		!source.slice(handler.index, forward).endsWith(ingress + "\n    ")
	)
		throw new Error("Ambiguous proof ingress marker");
	const startup = unique(source, launch),
		at = startup.index + startup[0].length;
	const ready = `\n    NSLog("${READY}")`;
	const readyCount = source.split(READY).length - 1;
	if (readyCount === 0) source = source.slice(0, at) + ready + source.slice(at);
	else if (readyCount !== 1 || !source.slice(at).startsWith(ready))
		throw new Error("Ambiguous proof calibration marker");
	return source;
}
function withProofNativeMarkers(config) {
	if (
		config.ios?.bundleIdentifier !==
			"com.localoperator.mobile.retirementproof" ||
		process.env.EXPO_PUBLIC_RETIREMENT_PROOF_FLAVOR !== "auth-retirement-proof"
	)
		throw new Error("Dedicated proof flavor required for native markers");
	return withAppDelegate(config, (mod) => {
		mod.modResults.contents = instrument(
			mod.modResults.contents,
			mod.modResults.language,
		);
		return mod;
	});
}
module.exports = withProofNativeMarkers;
module.exports.instrument = instrument;
