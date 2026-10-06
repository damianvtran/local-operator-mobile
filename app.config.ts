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

/* DERIVED, NOT REMEMBERED (ADR 0004, "Versioning").
 *
 * Every build path in `.github/workflows` runs `scripts/ci/version.ts --write`
 * before `expo prebuild`, and that script exports these two values into the job:
 * the git tag supplies the human-facing version, and the build number is the
 * repository-global sequence `docs/ci.md` documents (an internal build claims the
 * last release's counter plus the commits since; a release claims the counter
 * itself) — never `github.run_number`, which is per workflow. Nothing else may set
 * them, or two builds of the same commit could claim the same version.
 *
 * UNSET IS THE LOCAL CASE, and it is deliberately the previous behaviour: a
 * contributor's `expo start` or local `expo prebuild` sees no variables, so the
 * version stays the placeholder and the platforms supply their own build number.
 * That is why this reads the environment rather than a generated file — a
 * generated file would have to exist for local development too, and would then be
 * a committed number that two branches can disagree about.
 *
 * The values are strings on the way in and typed on the way out: `ios.buildNumber`
 * is a string and `android.versionCode` is an integer, and neither is set at all
 * when there is no build number, so an unset variable is genuinely absent from
 * the generated project instead of present and empty.
 */
const version = process.env.LOCAL_OPERATOR_MOBILE_VERSION ?? "0.0.0";
const buildNumber = Number(
	process.env.LOCAL_OPERATOR_MOBILE_VERSION_CODE ?? "0",
);
if (!Number.isInteger(buildNumber) || buildNumber < 0) {
	// A non-numeric build number would reach `expo prebuild` and be written into
	// the native projects, where the stores reject it at upload — a failure that
	// costs a whole release cycle to discover. Fail here instead, where the value
	// entered.
	throw new Error(
		`LOCAL_OPERATOR_MOBILE_VERSION_CODE must be a non-negative integer, got ${process.env.LOCAL_OPERATOR_MOBILE_VERSION_CODE}`,
	);
}

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
		// `CFBundleVersion`. Omitted when there is no build number, so a local
		// prebuild keeps whatever the template generates.
		...(buildNumber > 0 ? { buildNumber: String(buildNumber) } : {}),
		// The Apple team automatic signing resolves against. Omitted when unset, so a
		// contributor without a team id still prebuilds and Xcode falls back to the
		// local default. CI sets `APPLE_TEAM_ID` from the repository secret and
		// `ios.yml` reads this field back out of the resolved config and fails when
		// the two disagree — the WIRING is the part that was missing (review M4: the
		// variable sat in a step's environment with no reader anywhere, which is the
		// same defect class as the version wiring).
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
		// The microphone CAPABILITY DECLARATION, not a privacy-label change: the
		// recorded audio is relayed to the reader's own computer for one transcription
		// and not retained (mobile-stt design §1), so the store privacy labels are
		// unchanged. The string is the prompt iOS shows at the moment the reader
		// presses the mic — never at first launch.
		infoPlist: {
			NSMicrophoneUsageDescription:
				"Record a voice message and transcribe it on your own computer. The recording is sent for one transcription and not kept.",
			// The local-network ACCESS declaration (ADR 0002 §5). iOS shows this
			// string in its one-time "allow this app on your network" alert, which
			// appears the first time the app reaches a local address — for this app,
			// the relay on the reader's own computer at a same-Wi-Fi address such as
			// http://192.168.1.50:4098 — never at launch. TN3179 is explicit that an
			// app which accesses the local network adds the key, and that a direct
			// TCP connection is a triggering operation. The permission is per-app and
			// recorded, so a reader sees this alert at most once; when the app fails
			// instead, the connection copy names the Settings path (tunnel-verdict).
			NSLocalNetworkUsageDescription:
				"Connect to the relay running on your own computer when it is on the same Wi-Fi network. The app reaches only the address you enter, and does not scan your network.",
			// ATS for the same case, configured to be SAFE UNDER BOTH READINGS of
			// Apple's own page, because that page carries two that disagree (quoted
			// and kept in ADR 0002 §5): one says iOS 17+ "no longer allows
			// connections to IP addresses by default" and directs you to add "IP
			// addresses … in the NSExceptionDomains dictionary"; the other says the
			// local networking exception enables "IP addresses that they would
			// otherwise restrict". So this ships BOTH mechanisms: the boolean, and
			// one CIDR exception for each literal private range the app's own URL
			// validation accepts (connection/profile.ts). NSAllowsArbitraryLoads is
			// false and the exception entries touch no TLS requirement.
			//
			// The trade, stated rather than discovered: the CIDR entries are the
			// whole list — an address outside them still depends on the boolean
			// being read the lenient way, and Android's equivalent flag is app-wide,
			// so a public http:// host stays refused on iOS where Android would
			// allow it. That asymmetry is recorded in ADR 0002 §5, and the device
			// procedure that settles which mechanism the OS honours is §7 S10.
			NSAppTransportSecurity: {
				NSAllowsArbitraryLoads: false,
				NSAllowsLocalNetworking: true,
				NSExceptionDomains: {
					"10.0.0.0/8": { NSExceptionAllowsInsecureHTTPLoads: true },
					"100.64.0.0/10": { NSExceptionAllowsInsecureHTTPLoads: true },
					"169.254.0.0/16": { NSExceptionAllowsInsecureHTTPLoads: true },
					"172.16.0.0/12": { NSExceptionAllowsInsecureHTTPLoads: true },
					"192.168.0.0/16": { NSExceptionAllowsInsecureHTTPLoads: true },
				},
			},
		},
	},
	android: {
		package: BUNDLE_ID,
		// The value both stores compare for monotonicity. Omitted when there is no
		// build number, for the same reason as `ios.buildNumber`.
		...(buildNumber > 0 ? { versionCode: buildNumber } : {}),
		// The Android half of the same declaration. Expo's plugin adds it from the
		// recorder's own manifest anyway; declared here so the capability is visible in
		// this file rather than implied by a dependency.
		//
		// ACCESS_LOCAL_NETWORK is the local-network permission the Android 17
		// enforcement (targetSdk 37) requires before an app may connect to a device
		// on the reader's network. It is DECLARED now and deliberately not yet
		// requested: while the app targets API 36 the platform grants it implicitly
		// to legacy apps, and Google's guidance is explicit — "Don't request
		// ACCESS_LOCAL_NETWORK at runtime prior to targeting SDK 37" — so the
		// runtime request lands in the same change as the targetSdk bump, where it
		// means something. The cleartext half of the Android configuration (what
		// makes http:// to a private address possible at all) is
		// `plugins/with-android-local-network.js`, because no app.config field
		// writes it.
		permissions: ["RECORD_AUDIO", "ACCESS_LOCAL_NETWORK"],
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
		[
			"expo-notifications",
			{
				// The Android status-bar small icon: monochrome and alpha-only
				// (brand-kit § 6.6), so it reads on every shade. The accent is the
				// static build colour for the icon and app name in the shade;
				// per-event colours belong to the notification classes the cloud
				// payload names (S7) and are not fixed here.
				icon: "./design/app-icon/android/ic_notification.png",
				color: color("accent.accent", "light"),
				// `enableBackgroundRemoteNotifications` stays OFF, deliberately: the
				// silent attention wake (ADR 0006 §1.5) is the one push that needs
				// the mode, and its handler is S6/S7 work — declaring the mode
				// before anything handles it would make this build claim more than
				// it does, and it is a one-line flip when that handler lands.
			},
		],
		// RELEASE SIGNING, and the only thing that makes `bundleRelease` produce a
		// signed AAB. Without it the generated project keeps Expo's template release
		// `signingConfig`, which points at the DEBUG keystore, so a "release" build
		// is debug-signed and Play rejects it. The plugin reads the keystore and its
		// passwords from the environment at build time (docs/ci.md, "Secrets") and
		// leaves the debug build untouched, so a contributor with no signing material
		// can still build and test.
		"./plugins/with-android-release-signing.js",
		// The cleartext half of the local-network configuration: `http://` to the
		// reader's own computer on the same Wi-Fi. Without it the API-36 target
		// refuses cleartext by default and the app's own insecure-connection switch
		// would promise something the platform refuses. Its comment has the why of
		// the shape (app-wide; a user-typed host cannot be narrowed at build time).
		"./plugins/with-android-local-network.js",
	],
	experiments: {
		typedRoutes: true,
	},
};

export default config;
