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
 * worktree is the kind of thing that ends up in a commit. */
const scratchBase = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? process.env.TMPDIR ?? "/tmp";
const scratch = `${scratchBase.replace(/\/$/, "")}/lo-mobile-capture`;

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

const target = arg("target", "preview");
/* `--probe <selector>` prints each match's box and computed background. See the
 * use in `openPage` for why a capture tool needs this. */
const probe = arg("probe", null);
/* `--check` re-renders every committed capture and compares it with the file in
 * the tree instead of writing. See the block above `save()`. */
const check = process.argv.includes("--check");
/* `--keep-scratch` leaves the per-run scratch tree (the verify copies and any
 * frames rendered in check mode) in place for inspection instead of deleting it. */
const keepScratch = process.argv.includes("--keep-scratch");

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
const openPage = async ({ file, width, height, dpr, theme = null, extraCss = "" }) => {
	await send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: dpr,
		mobile: true,
		screenWidth: width,
		screenHeight: height,
	});
	const url = `file://${new URL(file, repoRoot).pathname}${theme ? `?theme=${theme}` : ""}`;
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

const pixelsIdentical = (a, b) => {
	const bin = alphaTool();
	if (!bin) return null;
	try {
		execFileSync(bin, ["compare", "-metric", "AE", a, b, "null:"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		return true;
	} catch (e) {
		const said = String(e.stderr ?? "").trim();
		if (/^\d+/.test(said)) return false;
		return null;
	}
};

const stale = (path, why) => {
	console.error(`stale: ${path} — ${why}`);
	process.exitCode = 1;
};

/** In generation mode: write. In `--check`: compare against the committed file
 * and report the strongest comparison that passed. */
const save = (pngBuffer, outPath, { reencode = null } = {}) => {
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
	if (pixelsIdentical(fresh, outPath) === true) {
		console.log(
			`  ${outPath.split("/").pop()}: pixels identical (bytes differ — either encoder metadata or a real content change of sub-threshold pixels)`,
		);
		return verified.push(outPath);
	}
	stale(
		outPath,
		"does not match a fresh render of its own page (bytes and pixels both differ, or no decoder is available to prove the pixels match)",
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
	/* Play requires JPEG or 24-bit PNG with NO alpha channel, and the capture
	 * always comes back RGBA. The strip is part of the artefact, so it is applied
	 * to the fresh render too when checking — otherwise the comparison would be
	 * between two different encodings and would always fail. */
	const stripAlpha = (path) => {
		const bin = alphaTool();
		if (!bin) {
			console.warn(
				`warning: no ImageMagick, so ${path} may keep an alpha channel — run \`magick ${path} -alpha off PNG24:${path}\``,
			);
			process.exitCode = 1;
			return;
		}
		execFileSync(bin, [path, "-alpha", "off", `PNG24:${path}`], { stdio: "pipe" });
		const bytes = readFileSync(path);
		if (bytes[25] === 6) {
			console.error(`PROBLEM: ${path} is still RGBA after the strip`);
			process.exitCode = 1;
		}
	};
	const hasAlpha = png[25] === 6; /* PNG colour type: 6 = RGBA, 2 = RGB (byte 25 of IHDR) */
	console.log(
		`feature graphic: ${png.length} B, alpha channel: ${hasAlpha ? "present" : "none"}`,
	);
	save(png, outPath, { reencode: hasAlpha ? stripAlpha : null });
}

/* ---- 4. store-screenshot frames --------------------------------------- */

if (target === "frames" || target === "all") {
	/* Frames are scratch output, not committed artefacts, so `--check` renders
	 * them only to assert their SIZES against the store specs — the templates are
	 * what is committed, and the frames are what an implementation pass fills in. */
	const outDir = check
		? `${scratch}/frames`
		: new URL("store-screenshots/out/", root).pathname;
	mkdirSync(outDir, { recursive: true });
	const specs = [
		["iphone-6.9", 1320, 2868, 1],
		["ipad-13", 2064, 2752, 1],
		["play-phone", 1080, 1920, 1],
	];
	for (const [name, width, height, dpr] of specs) {
		const pagep = await openPage({
			file: `design/store-screenshots/${name}.html`,
			width,
			height,
			dpr,
			theme: "dark",
		});
		const png = await pagep.shot();
		const path = `${outDir}/${name}.png`;
		writeFileSync(path, png);
		const { width: w, height: h } = pngDimensions(png);
		const ok = w === width && h === height;
		console.log(
			`${name}: ${w}x${h} ${ok ? "(matches the required size)" : `(PROBLEM: expected ${width}x${height})`}`,
		);
		if (!ok) process.exitCode = 1;
		previewTargets.push(path);
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
			`\n${verified.length} of ${verified.length + 1} committed captures verified; the rest did not match`,
		);
		process.exit(1);
	}
	console.log(
		`${verified.length} committed captures verified against a fresh render (no files written)`,
	);
	console.log("captures are current");
	if (!keepScratch) rmSync(scratch, { recursive: true, force: true });
} else if (previewTargets.length) {
	console.log(`\nwrote:\n${previewTargets.map((p) => `  ${p}`).join("\n")}`);
}
