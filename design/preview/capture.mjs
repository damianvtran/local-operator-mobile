#!/usr/bin/env node
/**
 * Capture the kit preview, the Play feature graphic and the store-screenshot
 * frames with the INSTALLED Chrome, headless, over the DevTools protocol.
 *
 *     node design/preview/capture.mjs                 # preview sheet, both themes
 *     node design/preview/capture.mjs --target feature
 *     node design/preview/capture.mjs --target frames  # writes to an ignored out/
 *
 * Why not a downloaded browser: this project's rules forbid installing one
 * (no `playwright install`, no bundled Chromium), and the preview needs no
 * logins anyway — it is a local file. The installed Chrome is the browser the
 * contributors already have.
 *
 * Why the DevTools protocol rather than `--screenshot` and `--window-size`:
 * measured on this host, `--window-size=390,844` produces a **500x844** frame,
 * because Chrome clamps the flag at a 500-pixel floor and then subtracts
 * window chrome. A capture whose dimensions were assumed rather than set is not
 * evidence of anything, so the viewport is set through
 * `Emulation.setDeviceMetricsOverride`, which also controls devicePixelRatio —
 * which the flag cannot.
 *
 * Chrome is launched with `--use-mock-keychain --password-store=basic` because
 * a throwaway profile under a scratch HOME has no keychain, and without those
 * flags macOS raises a "Keychain Not Found" dialog ON THE OPERATOR'S SCREEN,
 * once per launch, from a process the contributor never sees.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const root = new URL("../", here); // design/
const repoRoot = new URL("../../", here);

/* Where a preview gets put is the SESSION's scratch when one is set, and the
 * system temp otherwise. Never the repository: a stray profile directory in a
 * worktree is the kind of thing that ends up in a commit.
 *
 * The directory carries this process's pid so two runs in one session cannot
 * delete each other's tree on exit — the same per-pid convention the icon
 * generator uses. */
const scratchBase = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? process.env.TMPDIR ?? "/tmp";
const scratch = `${scratchBase.replace(/\/$/, "")}/lo-mobile-capture-${process.pid}`;

const arg = (name, fallback = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? true);
};

/** Injected into every preview capture: animations and transitions disabled.
 *
 * Why this is required rather than cosmetic. The sheet draws real animated
 * affordances (the streaming shimmer, the working-line spinner), and a still of
 * an animation has NO fixed phase — the committed frames differed from run to
 * run from the moment the capture reached the sections that animate, which is
 * why `--check` failed on the two full-height sheets while the 844-tall
 * viewport frames (header, grounds, ink — nothing animated) matched byte for
 * byte. Disabling them makes each still the RESTING frame of every animation,
 * which is also exactly what the reduced-motion contract renders, so the
 * committed artefact is one a reader can compare against. */
const FREEZE_CSS = `*, *::before, *::after {
	animation: none !important;
	transition: none !important;
}`;

/* `--probe <selector>` prints each match's box and computed background. See the
 * use in `openPage` for why a capture tool needs this. */
const probe = arg("probe", null);
/* `--check` re-renders every committed capture and compares it with the file in
 * the tree instead of writing. See the block above `save()`. */
const check = process.argv.includes("--check");
/* `--keep-scratch` leaves the per-run scratch tree (the verify copies and any
 * frames rendered in check mode) in place for inspection instead of deleting it. */
const keepScratch = process.argv.includes("--keep-scratch");

/* `--check` with no explicit target checks EVERY target, and that default is the
 * point rather than a convenience. The documented gate is
 * `node design/preview/capture.mjs --check`, and while it defaulted to
 * `--target preview` it verified four of the five captures this repository
 * commits — the Play feature graphic was silently outside its scope, so a reader
 * of `design/README.md` was told five were covered and four were. A gate whose
 * default scope is narrower than its documentation is the same defect as a gate
 * that cannot fail, one layer up. Generation keeps its narrower default: writing
 * the sheet is the common case, and the feature graphic and the frames are
 * rendered deliberately. */
const explicitTarget = arg("target", null);
const target = explicitTarget ?? (check ? "all" : "preview");

/* ---- Chrome ------------------------------------------------------------ */

const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"google-chrome",
	"chromium",
	"chromium-browser",
];

const findChrome = () => {
	for (const c of CHROME_CANDIDATES) {
		if (c.includes("/") && existsSync(c)) return c;
		try {
			execFileSync("command", ["-v", c], { shell: "/bin/sh", stdio: "ignore" });
			return c;
		} catch {
			/* try the next */
		}
	}
	return null;
};

const chrome = findChrome();
if (!chrome) {
	console.error(
		"No Chrome or Chromium found. Install Google Chrome, or pass a path in CHROME=…\n" +
			"Checked:\n" +
			CHROME_CANDIDATES.map((c) => `  ${c}`).join("\n"),
	);
	process.exit(1);
}

/* A profile name unique to this run, so the teardown sweep can only ever match
 * this script's own Chrome — never a browser the operator is using. */
const profile = `${scratch}/profile-${process.pid}-${Date.now()}`;
mkdirSync(profile, { recursive: true });

const proc = spawn(
	process.env.CHROME ?? chrome,
	[
		"--headless=new",
		`--user-data-dir=${profile}`,
		"--remote-debugging-port=0",
		"--use-mock-keychain",
		"--password-store=basic",
		"--no-first-run",
		"--no-default-browser-check",
		"--hide-scrollbars",
		"--force-color-profile=srgb",
		"about:blank",
	],
	{ stdio: "ignore" },
);

const waitFor = async (fn, { tries = 100, ms = 200 } = {}) => {
	for (let i = 0; i < tries; i++) {
		const v = await fn();
		if (v) return v;
		await new Promise((r) => setTimeout(r, ms));
	}
	return null;
};

const portFile = `${profile}/DevToolsActivePort`;
const portLine = await waitFor(async () =>
	existsSync(portFile) && readFileSync(portFile, "utf8").split("\n")[0].trim()
		? readFileSync(portFile, "utf8").split("\n")[0].trim()
		: null,
);
if (!portLine) {
	console.error("Chrome did not report a DevTools port");
	proc.kill("SIGKILL");
	process.exit(1);
}

const listTargets = async () =>
	await (await fetch(`http://127.0.0.1:${portLine}/json/list`)).json();

const page = await waitFor(async () => {
	try {
		return (await listTargets()).find((t) => t.type === "page") ?? null;
	} catch {
		return null;
	}
});
if (!page) {
	console.error("no page target from Chrome");
	proc.kill("SIGKILL");
	process.exit(1);
}

/* ---- a minimal CDP client --------------------------------------------- */

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
	ws.addEventListener("open", res, { once: true });
	ws.addEventListener("error", rej, { once: true });
});

let nextId = 1;
const pending = new Map();
const events = new Map();
ws.addEventListener("message", (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id !== undefined) {
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
		else p.resolve(msg.result);
		return;
	}
	const waiters = events.get(msg.method);
	if (waiters) {
		events.delete(msg.method);
		for (const w of waiters) w(msg.params);
	}
});

const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});

const onEvent = (method) =>
	new Promise((resolve) => {
		const list = events.get(method) ?? [];
		list.push(resolve);
		events.set(method, list);
	});

await send("Page.enable");
await send("Runtime.enable");

/** Load a local file at a phone viewport, settle, and return a page object with
 * `shot()` for capturing. `settle` exists because a font that swaps in after
 * the load event changes the metrics: capturing on loadEventFired alone gives a
 * frame with the fallback face, which is a still nobody would sign off. */
const openPage = async ({
	file,
	width,
	height,
	dpr,
	theme = null,
	extraCss = "",
	query = null,
}) => {
	await send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: dpr,
		mobile: true,
		screenWidth: width,
		screenHeight: height,
	});
	/* The template reads its own frame from the query string: the caption and the
	 * capture's path are DATA (`design/store-screenshots/frames.json`), so a frame
	 * is re-rendered by passing them, never by editing this file — and never by
	 * pasting base64 into it. `URLSearchParams` does the escaping, because a
	 * headline carries spaces and punctuation. */
	const params = new URLSearchParams();
	if (theme) params.set("theme", theme);
	for (const [name, value] of Object.entries(query ?? {})) params.set(name, value);
	const url = `file://${new URL(file, repoRoot).pathname}${params.size ? `?${params}` : ""}`;
	const loaded = onEvent("Page.loadEventFired");
	await send("Page.navigate", { url });
	await loaded;
	await new Promise((r) => setTimeout(r, 400));
	/* The theme is chosen by the page itself, from the query string, so it is
	 * applied before the first paint. Setting it here instead — after the load
	 * event — is what produced two byte-identical "dark" and "light" captures:
	 * the class landed, but the frame had already been painted from the default
	 * theme, and the page never repainted before the screenshot. */
	if (extraCss)
		await send("Runtime.evaluate", {
			expression: `(() => { const s=document.createElement("style"); s.textContent=${JSON.stringify(extraCss)}; document.head.append(s); })()`,
		});
	/* Wait for fonts and for layout to be quiet, then measure. Two frames of
		 * rAF after fonts.ready is the cheap version of "the page has stopped
		 * moving"; a fixed sleep is what produces a half-drawn capture on a
		 * loaded machine. */
	await send("Runtime.evaluate", {
		expression: "document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))",
		awaitPromise: true,
	});
	const { result } = await send("Runtime.evaluate", {
		expression:
			"JSON.stringify({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth })",
		returnByValue: true,
	});
	/* What the page actually resolved, printed with every capture. A capture that
	 * silently ignored the theme it was asked for is exactly the failure this
	 * script already shipped once (two byte-identical "dark" and "light" files),
	 * and a byte count does not reveal it. This does. */
	const { result: state } = await send("Runtime.evaluate", {
		expression:
			'JSON.stringify({ url: location.href, cls: document.documentElement.className, canvas: getComputedStyle(document.documentElement).getPropertyValue("--lo-canvas").trim(), font: getComputedStyle(document.body).fontFamily })',
		returnByValue: true,
	});
	/* `--probe <selector>` prints each match's box and its computed background,
	 * so a sheet that renders the wrong thing is diagnosed by a NUMBER rather
	 * than by squinting at a PNG: the motion meters in this kit's first sheet
	 * drew as bare tracks, and "the bars look dark" took three crops to turn
	 * into "the fill is not being painted". */
	if (probe) {
		const { result: probed } = await send("Runtime.evaluate", {
			expression: `JSON.stringify([...document.querySelectorAll(${JSON.stringify(probe)})].map((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { tag: el.className, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: s.backgroundColor, display: s.display }; }))`,
			returnByValue: true,
		});
		console.log(`  probe ${probe}:`);
		for (const m of JSON.parse(probed.value))
			console.log(`    ${m.tag} @${m.x},${m.y} ${m.w}x${m.h} bg ${m.bg} (${m.display})`);
	}
	return {
		state: JSON.parse(state.value),
		metrics: JSON.parse(result.value),
		/* Run an expression in the page and get its value back. The store-frame
		 * render uses it to prove the capture it points at actually loaded (a wrong
		 * path is a broken image, and a broken image in a slot is a plausible-
		 * looking blank at exactly the right size). */
		evaluate: async (expression) => {
			const { result: out } = await send("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			return out.value;
		},
		/* Grow the emulated viewport to the document's own height and capture THAT,
		 * instead of asking for a beyond-viewport clip.
		 *
		 * The clip path is not reproducible: the same page captured twice with
		 * `captureBeyondViewport: true` at a 15003-pixel height came back
		 * byte-identical on one run and different on the next, because Chrome tiles
		 * a very tall capture and the tile boundaries land differently run to run.
		 * A committed artefact whose bytes cannot be reproduced cannot be checked,
		 * which is what made the new `--check` fail on whichever of the two full
		 * sheets happened to differ that run. A single-tile viewport capture at the
		 * full height is deterministic, and this sheet uses no `vh` units, so a tall
		 * viewport changes nothing about the layout. */
		resize: async (height) => {
			await send("Emulation.setDeviceMetricsOverride", {
				width,
				height,
				deviceScaleFactor: dpr,
				mobile: true,
				screenWidth: width,
				screenHeight: height,
			});
			await send("Runtime.evaluate", {
				expression:
					"new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
				awaitPromise: true,
			});
		},
		shot: async ({ clip = null } = {}) => {
			const { data } = await send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: Boolean(clip),
				...(clip ? { clip: { ...clip, scale: 1 } } : {}),
			});
			return Buffer.from(data, "base64");
		},
	};
};

/* ---- 1. fonts, when the sibling checkouts are present ------------------ */

/* The sheet wants the REAL typefaces — a preview rendered in the fallback face
 * cannot be used to judge the type scale, which is half of what this sheet is
 * for. The woff2 files live in the site repository, so this writes a local,
 * gitignored @font-face sheet when it can find them and silently skips when it
 * cannot. Nothing is downloaded: the app bundles its own fonts, and a preview
 * that fetched a font from a CDN would be a different rendering from the app's. */
const FONT_DIRS = [
	`${process.env.HOME}/local-operator-site/public/fonts`,
	`${process.env.HOME}/local-operator-ui/public/fonts`,
];
const fontDir = FONT_DIRS.find((d) => existsSync(d));
const fontCssPath = new URL("fonts.local.css", here).pathname;
if (fontDir && !existsSync(fontCssPath)) {
	const face = (family, file, weight) =>
		existsSync(`${fontDir}/${file}`)
			? `@font-face { font-family: "${family}"; src: url("file://${fontDir}/${file}") format("woff2"); font-weight: ${weight}; font-display: block; }\n`
			: "";
	writeFileSync(
		fontCssPath,
		"/* Written by design/preview/capture.mjs, gitignored. Not part of the kit:\n" +
			" * it points @font-face at the sibling site checkout's woff2 files so the\n" +
			" * preview renders the shipped typefaces. Absent in CI, where the page\n" +
			" * falls back to the platform face exactly as the app does. */\n" +
			face("Figtree Variable", "figtree-5.3.0-latin.woff2", "300 900") +
			face("JetBrains Mono Variable", "jetbrains-mono-5.3.0-latin.woff2", "100 800"),
	);
	console.log(`preview fonts: using ${fontDir}`);
} else if (!fontDir) {
	console.log("preview fonts: no sibling checkout found, rendering with the fallback face");
}

/* ---- 2. the kit sheet -------------------------------------------------- */

/* ---- committed-output verification -------------------------------------
 *
 * `--check` re-renders every committed capture and compares it with the file in
 * the tree, so the previews and the Play feature graphic have the same kind of
 * gate the icons have. Without it, these five PNGs were committed artefacts
 * with no way to tell whether they still matched their source page — the exact
 * shape of the round-1 MAJOR on `build-icons.mjs --check`.
 *
 * Comparison is BYTE-level first. Chrome's encoder is deterministic for the
 * same page, viewport and flags, so a byte match is the common case; where bytes
 * differ, the images are decoded and compared pixel-by-pixel, and the output
 * says which of the two comparisons passed. A missing decoder is a FAILURE,
 * never a pass, because "could not prove it differs" and "it differs" must not
 * look the same in a log.
 *
 * The listing frames take their per-pixel tolerance from `frames.json`, per
 * surface (`compareFuzz`; absent means zero), and the values there are measured.
 * Zero tolerance does not hold on a runner for ANY of the three surfaces: on the
 * Chrome 156 runner, re-rendering against frames committed from Chrome 155, the
 * iPhone set differed in 573-790 pixels, Play in 232-327, and the iPad set —
 * whose capture is the one scaled down into a smaller slot (2048 px into 1400) —
 * in 9,026-47,479. A single global 2% hid that: it was looser than the phone and
 * Play surfaces needed and told a reader nothing. Each surface now carries its
 * own number, and the log prints, per frame, the count at zero tolerance and the
 * largest channel difference, so the value can be re-derived rather than trusted.
 * A caption, font or template change is far outside any of these: a one-pixel
 * shift of the whole frame is 157,129 differing pixels and a one-word caption
 * edit about 10,000, against a few hundred from the encoder.
 *
 * Every pixel comparison prints BOTH counts: the pixels past the surface's
 * tolerance (the pass/fail rule) and the pixels that differ at zero tolerance
 * with the worst channel difference beside them (what the tolerance absorbed —
 * zero when it was not needed). One number alone cannot say whether a tolerance
 * was load-bearing, which is how a blanket 2% ended up over 17 frames whose need
 * had never been measured (review round 1, finding 2).
 */

const alphaTool = () =>
	["magick", "convert"].find((bin) => {
		try {
			execFileSync(bin, ["--version"], { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	});

/** How many pixels differ by more than `fuzz` percent.
 *
 * THE RULE, stated because this number goes into the log: a pixel differs when
 * the LARGEST of its channel differences exceeds `fuzz` percent of the channel
 * range. It is computed from the two images directly — difference, per-channel
 * max, threshold, count — so the answer is arithmetic rather than a decoder's
 * rendering or formatting convention.
 *
 * WHY NOT THE DECODER'S METRIC: `compare -metric AE` was the original source and
 * it was not trustworthy across builds. ImageMagick 7.1.2-33 on the CI runner
 * printed `111.119` for a count of 111,119 (a scaled form `parseFloat` read as a
 * fractional pixel count), and its `-highlight-color/-lowlight-color` mask
 * disagreed with its own AE by a factor of 2.5 on the same pair. The arithmetic
 * below has one meaning on any build, which is what a logged number needs.
 *
 * 0 means identical (or every difference under the fuzz); a number means that
 * many pixels are past it; null means no decoder is installed; undefined means
 * the comparison itself failed. Those last three stay deliberately distinct:
 * "no decoder" and "could not run" must never read as a pass in a log. */
const differenceScan = (a, b, tail) => {
	const bin = alphaTool();
	if (!bin) return null;
	try {
		const out = execFileSync(
			bin,
			[
				a,
				"-alpha",
				"off",
				b,
				"-alpha",
				"off",
				"-compose",
				"difference",
				"-composite",
				/* Per-channel abs difference; `-separate` splits the channels and
				 * `-evaluate-sequence max` reduces them to the largest one. */
				"-separate",
				"-evaluate-sequence",
				"max",
				...tail,
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		).trim();
		const value = Number.parseInt(out, 10);
		return Number.isFinite(value) ? value : undefined;
	} catch {
		return undefined;
	}
};

const pixelDifference = (a, b, fuzz) =>
	differenceScan(a, b, ["-threshold", `${fuzz}%`, "-format", "%[fx:round(mean*w*h)]", "info:"]);

/** The largest per-channel difference anywhere between two images, in 8-bit
 * levels. It is what says how much slack a surface plausibly needs: a count alone
 * cannot distinguish hundreds of 1-level encoder shifts from hundreds of 30-level
 * ones, and a tolerance chosen without that is a guess. */
const largestDifference = (a, b) =>
	differenceScan(a, b, ["-format", "%[fx:round(maxima*255)]", "info:"]);

const failures = [];

/* How many isolated pixels may sit beyond a surface's tolerance and still pass.
 *
 * Measured, not chosen for comfort. Cross-Chrome drift on the runner moves
 * 232-327 pixels by 1/255 on the Play set, 573-790 by 1-2/255 on the phone set,
 * and 9,026-47,479 by 2/255 on the iPad set — all absorbed by the per-surface
 * tolerance. One phone frame also carries a single pixel at 14/255, which fails a
 * zero-outlier rule while saying nothing about content. The smallest content
 * change this project has measured is a 10x10 recolour (100 pixels) and a
 * one-character headline edit is 439-770 pixels, so a handful of isolated pixels
 * cannot hide a real edit. Applies only where a surface has a tolerance; the
 * preview sheet and feature graphic keep zero outliers. */
const STRAY_PIXELS = 8;

const stale = (path, why) => {
	console.error(`stale: ${path} — ${why}`);
	failures.push(path);
	process.exitCode = 1;
};

/** In generation mode: write. In `--check`: compare against the committed file
 * and report the strongest comparison that passed. `fuzz` is the surface's own
 * tolerance, passed by the caller from `frames.json`. */
const save = (pngBuffer, outPath, { reencode = null, fuzz = 0 } = {}) => {
	if (!check) {
		writeFileSync(outPath, pngBuffer);
		previewTargets.push(outPath);
		if (reencode) reencode(outPath);
		return;
	}
	const fresh = `${scratchVerify}/${outPath.split("/").pop()}`;
	writeFileSync(fresh, pngBuffer);
	if (reencode) reencode(fresh);
	if (!existsSync(outPath)) return stale(outPath, "missing");
	if (readFileSync(fresh).equals(readFileSync(outPath))) {
		console.log(`  ${outPath.split("/").pop()}: byte-identical`);
		return verified.push(outPath);
	}
	/* Both counts, always. `strict` is the number of pixels that differ from the
	 * committed capture at zero tolerance; `differing` is the same count under the
	 * surface's fuzz, and is the pass/fail rule. Printed together so the log says
	 * whether the fuzz was doing any work on this frame. */
	const name = outPath.split("/").pop();
	const strict = pixelDifference(fresh, outPath, 0);
	const differing = fuzz === 0 ? strict : pixelDifference(fresh, outPath, fuzz);
	/* Measured only where something actually differs — the strict count, the
	 * tolerated count, or both — and used in every message below: how far the worst
	 * pixel moved. Skipped entirely on the pixel-identical path, where it is 0 by
	 * definition and the extra decode would buy nothing. */
	const spread = differing === 0 && strict === 0 ? 0 : largestDifference(fresh, outPath);
	const worst = Number.isFinite(spread) ? `; largest ${spread}/255` : "";
	if (differing === 0) {
		if (fuzz === 0) {
			console.log(
				`  ${name}: pixels identical (bytes differ — the encoder wrote different bytes for the same pixels)`,
			);
		} else if (strict === 0) {
			console.log(
				`  ${name}: pixels identical at zero tolerance as well as within the ${fuzz}% fuzz ` +
					"(bytes differ — the fuzz was not needed on this frame)",
			);
		} else if (Number.isFinite(strict)) {
			console.log(
				`  ${name}: pixels identical within the ${fuzz}% resampling fuzz — ` +
					`${strict} pixel(s) differ at zero tolerance${worst}, so the fuzz was load-bearing (bytes differ)`,
			);
		} else {
			console.log(
				`  ${name}: pixels identical within the ${fuzz}% resampling fuzz (bytes differ; ` +
					"the zero-tolerance count could not be made)",
			);
		}
		return verified.push(outPath);
	}
	if (fuzz > 0 && Number.isFinite(differing) && differing > 0 && differing <= STRAY_PIXELS) {
		console.log(
			`  ${name}: pixels identical within the ${fuzz}% fuzz except ${differing} isolated ` +
				`pixel(s)${worst} — inside the ${STRAY_PIXELS}-pixel encoder allowance (bytes differ)`,
		);
		return verified.push(outPath);
	}
	if (differing === null) {
		return stale(
			outPath,
			"no image decoder is installed, so the pixel comparison could not be made",
		);
	}
	if (differing === undefined) {
		return stale(
			outPath,
			"the pixel comparison itself failed (the decoder ran but produced no count)",
		);
	}
	stale(
		outPath,
		`does not match a fresh render of its own page (${differing} pixel(s) differ beyond ` +
			`${fuzz === 0 ? "zero tolerance" : `a ${fuzz}% fuzz`}` +
			`${fuzz === 0 || !Number.isFinite(strict) ? "" : `, ${strict} at zero tolerance`}${worst})`,
	);
};

const previewTargets = [];
const verified = [];
const scratchVerify = `${scratch}/verify`;
mkdirSync(scratchVerify, { recursive: true });

if (target === "preview" || target === "all") {
	const outDir = new URL("../../docs/design/preview/", here).pathname;
	mkdirSync(outDir, { recursive: true });
	for (const theme of ["dark", "light"]) {
		const pagep = await openPage({
			file: "design/preview/index.html",
			width: 390,
			height: 844,
			dpr: 3,
			theme,
			extraCss: FREEZE_CSS,
		});
		/* The required frame: exactly the phone viewport at 390x844 @3x, which is
		 * what the app's own screenshots are taken at. */
		const viewport = await pagep.shot();
		const viewportPath = `${outDir}kit-${theme}-390x844@3x.png`;
		save(viewport, viewportPath);
		/* And the whole sheet in one image, because the review needs the parts
		 * that are below the fold on a 844-tall screen. Captured by growing the
		 * viewport to the document height rather than with a beyond-viewport clip —
		 * see `resize()` for why the clip was not reproducible. */
		await pagep.resize(pagep.metrics.h);
		const full = await pagep.shot();
		const fullPath = `${outDir}kit-${theme}-full@3x.png`;
		save(full, fullPath);
		console.log(
			`${theme}: viewport ${viewport.length} B, full sheet ${pagep.metrics.h}pt -> ${full.length} B`,
		);
		console.log(
			`  resolved: ${pagep.state.cls || (theme === "light" ? "(no theme class)" : "NO THEME CLASS")} canvas ${pagep.state.canvas} · ${pagep.state.font.split(",")[0]}`,
		);
	}
}

/* ---- the 24-bit strip, shared by every store asset --------------------- */

/* Play requires JPEG or 24-bit PNG with NO alpha channel, and App Store Connect
 * rejects transparency; the capture always comes back RGBA (colour type 6). The
 * strip is part of the artefact, so it is applied to the fresh render too when
 * checking — otherwise the comparison would be between two different encodings
 * and would always fail. */
const stripAlpha24 = (path) => {
	const bin = alphaTool();
	if (!bin) {
		console.warn(
			`warning: no ImageMagick, so ${path} may keep an alpha channel — run \`magick ${path} -alpha off PNG24:${path}\``,
		);
		process.exitCode = 1;
		return;
	}
	/* Drop the timestamp chunks for the same reason the icon generator does:
	 * a `tIME` chunk makes a byte gate impossible for no benefit. */
	execFileSync(
		bin,
		[path, "-alpha", "off", "-define", "png:exclude-chunks=time,date", `PNG24:${path}`],
		{ stdio: "pipe" },
	);
	const bytes = readFileSync(path);
	if (bytes[25] === 6) {
		console.error(`PROBLEM: ${path} is still RGBA after the strip`);
		process.exitCode = 1;
	}
};

/* ---- 3. the Play feature graphic -------------------------------------- */

if (target === "feature" || target === "all") {
	const pagep = await openPage({
		file: "design/app-icon/store/play-feature-graphic.html",
		width: 1024,
		height: 500,
		dpr: 1,
		theme: "dark",
	});
	const png = await pagep.shot();
	const outPath = new URL("app-icon/store/play-feature-graphic-1024x500.png", root).pathname;
	const hasAlpha = png[25] === 6; /* PNG colour type: 6 = RGBA, 2 = RGB (byte 25 of IHDR) */
	console.log(
		`feature graphic: ${png.length} B, alpha channel: ${hasAlpha ? "present" : "none"}`,
	);
	save(png, outPath, { reencode: hasAlpha ? stripAlpha24 : null });
}

/* ---- 4. store-screenshot frames --------------------------------------- */

if (target === "frames" || target === "all") {
	/* A template rendered with no query is not a listing: it is the empty slot,
	 * and it is rendered only so its canvas can be asserted against the store's
	 * spec. One surface at a time, from frames.json, so a template and the
	 * committed set rendered from it cannot disagree about a canvas. */
	const outDir = check
		? `${scratch}/frames`
		: new URL("store-screenshots/out/", root).pathname;
	mkdirSync(outDir, { recursive: true });
	const set = JSON.parse(
		readFileSync(new URL("store-screenshots/frames.json", root), "utf8"),
	);
	for (const surface of set.surfaces) {
		const pagep = await openPage({
			file: `design/store-screenshots/${surface.template}`,
			width: surface.canvas.width,
			height: surface.canvas.height,
			dpr: 1,
			theme: "dark",
		});
		const png = await pagep.shot();
		const path = `${outDir}/${surface.id}.png`;
		writeFileSync(path, png);
		const { width: w, height: h } = pngDimensions(png);
		const ok = w === surface.canvas.width && h === surface.canvas.height;
		console.log(
			`${surface.id}: ${w}x${h} ${ok ? "(matches the required size)" : `(PROBLEM: expected ${surface.canvas.width}x${surface.canvas.height})`}`,
		);
		if (!ok) process.exitCode = 1;
		previewTargets.push(path);
	}

	/* The committed listings: one PNG per frame in `frames.json`, rendered from
	 * the surface's template with that frame's caption and capture as data. These
	 * ARE committed artefacts (the set the store takes), so `--check` verifies
	 * every surface's frames byte-for-byte like the preview sheet, and the canvas
	 * size is asserted on every one — an off-size listing is rejected by the
	 * store, not resized. */
	for (const surface of set.surfaces) {
		const frameDir = new URL(`store-screenshots/${surface.outDir}/`, root).pathname;
		if (!check) mkdirSync(frameDir, { recursive: true });
		for (const frame of surface.frames) {
			const capture = `${surface.capture.dir}/${frame.slug}.png`;
			const query = {
				eyebrow: frame.eyebrow,
				headline: frame.headline,
				capture,
			};
			/* Play's slot is taller than a phone screen, so the capture is anchored
			 * to the top or bottom edge inside it and the template crops the rest
			 * (`frames.json` names the edge per shot); the App Store templates have
			 * no crop and are not sent one. */
			if (frame.crop) query.crop = frame.crop;
			const pagep = await openPage({
				file: `design/store-screenshots/${surface.template}`,
				width: surface.canvas.width,
				height: surface.canvas.height,
				dpr: 1,
				theme: "dark",
				query,
			});
			/* The slot's image is decoded before the shot is taken, and its OWN
			 * pixel size is asserted against the capture spec: a wrong path renders a
			 * broken image, which is a plausible blank at exactly the right canvas
			 * size. */
			await pagep.evaluate(
				"Promise.all([...document.images].map((i) => i.decode().catch(() => null)))",
			);
			const shown = await pagep.evaluate(
				'(() => { const i = document.getElementById("capture"); return i === null ? null : { w: i.naturalWidth, h: i.naturalHeight }; })()',
			);
			if (
				shown === null ||
				shown.w !== surface.capture.pixels.width ||
				shown.h !== surface.capture.pixels.height
			) {
				console.error(
					`PROBLEM: ${surface.id}/${frame.slug} — the slot shows ` +
						`${shown === null ? "no image" : `${shown.w}x${shown.h}`} where ${capture} should be ` +
						`${surface.capture.pixels.width}x${surface.capture.pixels.height}`,
				);
				process.exitCode = 1;
				continue;
			}
			/* No build metadata on a store asset. The templates used to draw a spec
			 * block ("App Store · 6.9\"", "1320 × 2868 @1x", the alt-size list) beside
			 * their wordmark; that describes the FILE to a maintainer and would have
			 * shipped inside every listing (review round 1, Q1). Asserted here rather
			 * than trusted to stay deleted: the canvas size and the alt sizes belong in
			 * this script's own output, not in the image. */
			const meta = await pagep.evaluate(`(() => {
				const hit = /(\\d{3,4}\\s*×\\s*\\d{3,4})|@1x|\\balt:/i.exec(document.body.innerText);
				return { hit: hit === null ? null : hit[0], spec: document.querySelector(".spec") !== null };
			})()`);
			if (meta === null || meta.hit !== null || meta.spec) {
				console.error(
					`PROBLEM: ${surface.id}/${frame.slug} — the composed frame carries build metadata ` +
						`(${meta === null ? "the check could not run" : meta.spec ? "a .spec block" : JSON.stringify(meta.hit)})`,
				);
				process.exitCode = 1;
				continue;
			}
			const png = await pagep.shot();
			const { width: w, height: h } = pngDimensions(png);
			const ok = w === surface.canvas.width && h === surface.canvas.height;
			console.log(
				`${surface.id}/${frame.slug}: ${w}x${h} ${ok ? "(matches the required size)" : `(PROBLEM: expected ${surface.canvas.width}x${surface.canvas.height})`} · capture ${shown.w}x${shown.h}`,
			);
			if (!ok) {
				process.exitCode = 1;
				continue;
			}
			save(png, `${frameDir}${frame.slug}.png`, {
				reencode: stripAlpha24,
				fuzz: surface.compareFuzz ?? 0,
			});
		}
	}
}

function pngDimensions(buf) {
	return {
		width: buf.readUInt32BE(16),
		height: buf.readUInt32BE(20),
	};
}

/* ---- teardown ---------------------------------------------------------- */

ws.close();
/* SIGTERM to the browser PID alone is not enough (measured: 0-5 helper
 * processes survive, varying run to run), so the profile path is the scope —
 * it is unique to this run, which is what keeps this from ever matching a
 * browser the operator is using. The count is asserted rather than trusted. */
proc.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 2000));
try {
	execFileSync("pkill", ["-f", profile], { stdio: "ignore" });
} catch {
	/* pkill exits 1 when nothing matched, which is the good case */
}
const left = (() => {
	try {
		return execFileSync("pgrep", ["-f", profile], { encoding: "utf8" }).trim().split("\n")
			.filter(Boolean).length;
	} catch {
		return 0;
	}
})();
rmSync(profile, { recursive: true, force: true });

/* Registered at exit rather than called on the success path, because the scratch
 * tree also survives a FAILING run: the check-mode verify copies and any frames
 * rendered for their size assertion are written before the verdict, so a
 * `process.exit(1)` at the end left a whole tree behind on every failure — five
 * of them accumulated across the first round's failing cases. A cleanup that only
 * runs when nothing went wrong is the one case that never needs it. */
process.on("exit", () => {
	if (!keepScratch) rmSync(scratch, { recursive: true, force: true });
});
if (left > 0) {
	console.error(`PROBLEM: ${left} Chrome process(es) still alive for ${profile}`);
	process.exitCode = 1;
} else {
	console.log("teardown: 0 processes left, profile removed");
}

/* ---- report ------------------------------------------------------------ */

if (check) {
	if (process.exitCode) {
		console.error(
			`\n${verified.length} of ${verified.length + failures.length} committed captures verified, ` +
				`${failures.length} stale`,
		);
		process.exit(1);
	}
	console.log(
		`${verified.length} committed captures verified against a fresh render (no files written)`,
	);
	console.log("captures are current");
} else if (previewTargets.length) {
	console.log(`\nwrote:\n${previewTargets.map((p) => `  ${p}`).join("\n")}`);
}
