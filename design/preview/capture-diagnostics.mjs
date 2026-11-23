/** Diagnostic-only listing evidence. Never reads HOME, environment dumps or browser
 * profiles: the upload contains only the manifest's synthetic store frames and
 * explicitly selected renderer facts. Verdicts remain owned by capture.mjs. */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SURFACES = new Set(["appstore-iphone-6.9", "appstore-ipad-13", "play-phone"]);
const SLUGS = new Set([
	"01-session-transcript", "02-session-diff", "03-approval-card", "04-checkpoint-rail",
	"05-session-search", "06-sessions-remote", "07-move-receipt", "08-new-chat", "09-sign-in",
]);
export const FONT_FILES = ["figtree-variable-latin.woff2", "jetbrains-mono-variable.woff2"];

export const fontHashes = (directory) => Object.fromEntries(FONT_FILES.map((name) => [
	name, createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"),
]));

/** Deliberately no arbitrary metadata object: CDP can expose command lines, paths
 * and profile details. Only these renderer fields can reach the public artifact. */
export const rendererFacts = (version = {}, info = {}) => ({
	product: version.product ?? null,
	gpuInfoAvailable: Boolean(info.gpu),
	revision: version.revision ?? null,
	jsVersion: version.jsVersion ?? null,
	gpu: (info.gpu?.devices ?? []).map((device) => Object.fromEntries([
		"vendorId", "deviceId", "vendorString", "deviceString", "driverVendor", "driverVersion",
	].filter((key) => device[key] !== undefined).map((key) => [key, device[key]]))),
	graphics: Object.fromEntries(["glRenderer", "glVendor", "glVersion", "skiaBackendType"].filter(
		(key) => info.gpu?.auxAttributes?.[key] !== undefined,
	).map((key) => [key, info.gpu.auxAttributes[key]])),
});

/** The four-part Chrome version in either spelling the job sees it: CDP's
 * `product` ("HeadlessChrome/157.0.8103.80") or the binary's `--version`
 * ("Google Chrome 157.0.8103.80"). Null when there is none to compare. */
export const rendererVersion = (text) => /\b(\d+\.\d+\.\d+\.\d+)\b/.exec(String(text ?? ""))?.[1] ?? null;

/** The one `renderer:` line every `capture.mjs --check` prints. Never throws:
 * anything short of a product string is "unavailable", so a CDP hiccup is
 * visible in the log without being able to change the gate's verdict. */
export const rendererLine = (facts) => {
	const version = rendererVersion(facts?.product);
	if (!facts || facts.unavailable || !version) return "renderer: unavailable";
	return `renderer: ${facts.product} skiaBackendType=${facts.graphics?.skiaBackendType ?? "unknown"}`;
};

/** Artifact I/O is observational: never turn a stale verdict into an exception,
 * nor change a passing verdict if the diagnostic disk/decoder is unavailable. */
export const retainSafely = (retain, evidence, warn = console.warn) => {
	if (!retain || !evidence) return;
	try {
		retain(evidence);
	} catch {
		warn("listing diagnostics: evidence incomplete (gate verdict unchanged)");
	}
};

export const createDiagnostics = ({ directory, invocation, renderer, fonts, makeDifference }) => {
	if (!["all", "frames"].includes(invocation)) throw new Error("Invalid diagnostic invocation");
	const run = join(directory, `${invocation}-${process.pid}`);
	mkdirSync(run, { recursive: true });
	writeFileSync(join(run, "renderer.json"), `${JSON.stringify({
		command: ["node", "design/preview/capture.mjs", ...(invocation === "frames" ? ["--target", "frames"] : []), "--check"],
		capture: { format: "png", captureBeyondViewport: false, deviceScaleFactor: 1, mobile: true, colorProfile: "srgb" },
		browserFlags: ["--headless=new", "--remote-debugging-port=0", "--use-mock-keychain", "--password-store=basic", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-color-profile=srgb"],
		renderer, fonts,
	}, null, 2)}\n`);
	return ({ surface, slug, fresh, reference, metrics, faces = [] }) => {
		if (!SURFACES.has(surface) || !SLUGS.has(slug) || (surface === "play-phone" && slug === "09-sign-in")) {
			throw new Error("Frame is outside the synthetic listing asset whitelist");
		}
		const target = join(run, surface, slug);
		mkdirSync(target, { recursive: true });
		copyFileSync(fresh, join(target, "actual.png"));
		// Keep passing actuals too: the two invocations disagree within one job.
		writeFileSync(join(target, "comparison.json"), `${JSON.stringify({
			strict: metrics.strict, beyondFuzz: metrics.beyondFuzz, largest: metrics.largest,
			fuzz: metrics.fuzz, stale: metrics.stale,
			faces: faces.filter((face) => ["Figtree", "JetBrains Mono"].includes(face.family)).map(
				({ family, status, weight }) => ({ family, status, weight }),
			),
		}, null, 2)}\n`);
		if (metrics.stale) {
			copyFileSync(reference, join(target, "reference.png"));
			/* The fast Checks lane can have Chrome without ImageMagick. Its original
			 * stale-frame verdict still works (null means no decoder), but a delta PNG
			 * cannot be manufactured there. Record that prerequisite, never claim a
			 * pixel comparison or silently omit the diagnostic. The design lane installs
			 * the decoder and must still produce the actual delta. */
			if (metrics.beyondFuzz === null) {
				writeFileSync(join(target, "delta-status.json"), `${JSON.stringify({
					available: false, reason: "image-decoder-unavailable",
				})}\n`);
			} else {
				makeDifference(fresh, reference, join(target, "delta.png"));
			}
		}
	};
};
