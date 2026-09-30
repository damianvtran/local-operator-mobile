import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";

/**
 * App configuration.
 *
 * Native config is JSON-shaped on purpose — Expo evaluates this file in a plain
 * Node process, so it cannot import the app's TypeScript theme module. What it
 * CAN do is read the design kit's tokens directly, which is why this is
 * `app.config.ts` rather than `app.json`: the splash and adaptive-icon grounds
 * are the same `canvas` role the app renders on, and hardcoding a second copy of
 * that hex here is exactly the drift the token file exists to prevent.
 *
 * Resolution follows the contract documented in tokens.json `$meta.themeContract`:
 * every colour token is either `{ value }` (theme-invariant) or `{ light, dark }`,
 * and a reader resolves a theme with `value ?? token[theme]`.
 */
type Token = { value?: string; light?: string; dark?: string };

const tokens = JSON.parse(
	readFileSync(join(__dirname, "design/tokens/tokens.json"), "utf8"),
) as { color: Record<string, Record<string, Token>> };

/** Read a colour role by its dotted path, e.g. `surface.canvas`. */
const color = (path: string, theme: "light" | "dark"): string => {
	const parts = path.split(".");
	let node: unknown = tokens.color;
	for (const part of parts) {
		node = (node as Record<string, unknown>)[part];
	}
	const token = node as Token | undefined;
	const value = token?.value ?? token?.[theme];
	if (!value) {
		throw new Error(
			`app.config.ts: no colour token at color.${path} for the ${theme} theme`,
		);
	}
	return value;
};

// A placeholder reverse-DNS identity. Store submission needs a package name
// registered to the publisher, which is an account decision rather than a code
// one (docs/publishing/checklist.md item B2) — changing it later is a store-side
// operation, and nothing in the app depends on the value.
const BUNDLE_ID = "com.localoperator.mobile";

/* CI derives the version from the git tag; these two lines are the
 * local-development placeholder (ADR 0004, "Versioning"). `scripts/ci/version.mjs`
 * exports both variables, and every build workflow runs it before
 * `expo prebuild`, so a release's version is never a committed number that two
 * branches can disagree about.
 *
 * The placeholder is numeric (`0.0.0`) and deliberately NOT `0.0.0-dev.<run>`:
 * this value leaves here as Android's `versionName` and iOS's
 * `CFBundleShortVersionString`, and Apple rejects a non-numeric short version at
 * upload. Monotonicity rides on the build number instead, which is what both
 * stores actually compare. docs/ci.md, "Versioning", has the whole rule. */
const version = process.env.LOCAL_OPERATOR_MOBILE_VERSION ?? "0.0.0";
const buildNumber = Number(
	process.env.LOCAL_OPERATOR_MOBILE_VERSION_CODE ?? "0",
);

const config: ExpoConfig = {
	name: "Local Operator",
	slug: "local-operator-mobile",
	version,
	// `scheme` is what makes `localoperator://s/<sessionId>` deep links resolve
	// (docs/ux/flows.md § 11); expo-router derives its linking config from it.
	scheme: "localoperator",
	orientation: "portrait",
	userInterfaceStyle: "automatic",
	// No `newArchEnabled`: the new architecture is the only architecture in SDK 57,
	// and the flag was removed from the config type rather than left as a no-op.
	icon: "./design/app-icon/ios/icon-light-1024.png",
	assetBundlePatterns: ["**/*"],
	ios: {
		bundleIdentifier: BUNDLE_ID,
		supportsTablet: true,
		// CI exports APPLE_TEAM_ID for the signed archive; a contributor without it
		// still gets a simulator build, which needs no signing at all. Spread rather
		// than a conditional value, so an unset variable is genuinely ABSENT from the
		// config instead of present and empty.
		...(buildNumber > 0 ? { buildNumber: String(buildNumber) } : {}),
		...(process.env.APPLE_TEAM_ID
			? { appleTeamId: process.env.APPLE_TEAM_ID }
			: {}),
		// iOS 26 renders icons through Liquid Glass; the three appearances are
		// authored assets (brand-kit § 6.4). The tinted variant is greyscale by
		// definition — a coloured one is wrong, not merely worse.
		icon: {
			light: "./design/app-icon/ios/icon-light-1024.png",
			dark: "./design/app-icon/ios/icon-dark-1024.png",
			tinted: "./design/app-icon/ios/icon-tinted-1024.png",
		},
	},
	android: {
		package: BUNDLE_ID,
		// Monotonic across every build of the repository and never reused, which is
		// the one property Play enforces at upload time (ADR 0004).
		versionCode: buildNumber,
		adaptiveIcon: {
			foregroundImage:
				"./design/app-icon/android/ic_launcher_foreground-432.png",
			backgroundImage:
				"./design/app-icon/android/ic_launcher_background-432.png",
			monochromeImage:
				"./design/app-icon/android/ic_launcher_monochrome-432.png",
		},
	},
	web: {
		bundler: "metro",
		// A single-page output, not static pre-rendering: the app is a live client
		// of a relay on the user's own computer, and the session routes are
		// per-session dynamic segments with no build-time set of ids to enumerate.
		// "static" would require inventing generateStaticParams for routes that
		// have no honest static form. The harness serves this SPA with a
		// fallback-to-index so a deep link still boots the right screen.
		output: "single",
	},
	plugins: [
		"expo-router",
		// Adds the release signing config the Expo template does not ship. Without
		// it, `bundleRelease` produces an AAB signed with the debug key, which no
		// store accepts. The plugin reads the keystore and its passwords from the
		// environment and leaves the debug build untouched, so a contributor with no
		// signing material can still build and test the app.
		// See plugins/with-android-release-signing.js.
		"./plugins/with-android-release-signing",
		"expo-secure-store",
		"expo-web-browser",
		[
			"expo-splash-screen",
			{
				// The splash ground is `canvas` — the same paper the app then renders
				// on, so the launch does not flash a different colour.
				image: "./design/app-icon/splash/splash-light.png",
				imageDark: "./design/app-icon/splash/splash-dark.png",
				backgroundColor: color("surface.canvas", "light"),
				dark: { backgroundColor: color("surface.canvas", "dark") },
				resizeMode: "contain",
			},
		],
		"expo-font",
		"expo-image",
	],
	experiments: {
		typedRoutes: true,
	},
};

export default config;
