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

const config: ExpoConfig = {
	name: "Local Operator",
	slug: "local-operator-mobile",
	version: "0.0.0",
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
		[
			"expo-font",
			{
				// The kit's faces, embedded in the native binary rather than fetched at
				// runtime: a client of a relay on the user's own computer can be launched
				// with no network at all, and a font that has to be downloaded is a
				// screen in the platform's face on first run.
				//
				// One file per WEIGHT, not the variable file, because React Native selects
				// a face by family + weight rather than by a variation axis, and the
				// upstream Figtree variable file additionally names its family
				// "Figtree Light" (its typographic family is `Figtree`, its family record is
				// not), which is a family a style asking for `Figtree` never matches.
				// The weights are exactly the ones the type ramp uses, so no step renders a
				// synthesised weight. The web target uses the woff2 files instead — see
				// `design/fonts/README.md`.
				fonts: [
					"./design/fonts/Figtree-Regular.ttf",
					"./design/fonts/Figtree-Medium.ttf",
					"./design/fonts/Figtree-SemiBold.ttf",
					"./design/fonts/JetBrainsMono-Regular.ttf",
					"./design/fonts/JetBrainsMono-SemiBold.ttf",
				],
			},
		],
		"expo-image",
	],
	experiments: {
		typedRoutes: true,
	},
};

export default config;
