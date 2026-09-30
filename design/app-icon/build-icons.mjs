#!/usr/bin/env node
/**
 * Build the app icon, launcher, splash and notification assets from the existing
 * Local Operator mark.
 *
 *     node design/app-icon/build-icons.mjs
 *     node design/app-icon/build-icons.mjs --check   # verify without writing
 *
 * ## The one rule
 *
 * **The mark is not redrawn here.** The geometry below is the site's own
 * (`local-operator-site/src/components/ui/logo-mark.tsx`), which was itself
 * traced from the source raster rather than interpreted. A "cleaned up" icon is
 * a different logo, and this repository does not get to have one.
 *
 * ## Why a rasterizer is required, and what happens without one
 *
 * The brand kit's rule is that the mark is one monochrome, resolution-independent
 * SVG, and every raster here is a *rendering* of it at a size the platform asked
 * for. Rendering needs one of: `rsvg-convert` (librsvg), ImageMagick 7 (`magick`),
 * or ImageMagick 6 (`convert`). The script detects what is present and, if
 * nothing is, **exits non-zero with the install line for each** rather than
 * writing a placeholder nobody looks at. The generated PNGs are committed, so a
 * contributor who only wants to build the app never needs a rasterizer; the
 * script exists so a future palette change can regenerate them reproducibly.
 *
 * Reference generation, 2026-09-29, on the project's macOS host: ImageMagick 7
 * (which delegates SVG to `rsvg-convert`). Recorded because an icon that is
 * re-rendered by a different rasterizer is not bit-identical, and a diff in a
 * committed binary should be explainable.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
/* Every call site writes `design/app-icon/...` because those are the paths a
 * reader and a pull-request diff see. This resolves them against THIS directory
 * rather than the working directory, so the script works from anywhere — and it
 * strips the prefix that is already implied, because the first version of this
 * file resolved them as-is and wrote a second
 * `design/app-icon/design/app-icon/` tree instead of the intended one. */
const out = (p) => new URL(p.replace(/^design\/app-icon\//, ""), here).pathname;
const check = process.argv.includes("--check");

/* ---- the palette these assets are built from --------------------------- */

/* Hard-coded rather than read from tokens.json, deliberately: an app icon is a
 * pinned artefact, not a themed surface. It must not change because someone
 * nudged a token. The values are the brand kit's, and the file that changes them
 * is this one. */
const C = {
	lightGround: "#f2ede3", // tokens.json color.surface.canvas.light
	lightMark: "#211e18", // color.ink.light
	darkGround: "#14110c", // the kit's `island` — see docs/design/brand-kit.md § 6.3
	darkMark: "#f1eee6", // color.ink.dark
	androidBackground: "#22201c", // the app's own dark canvas
	androidMark: "#f1eee6",
};

/* ---- the mark geometry, once ------------------------------------------- */

/** The mark's strokes, ready to drop inside a `<g>`. `colour` is applied to the
 * group, never to an individual stroke, so the mark can never be half-recoloured. */
const markGroup = (colour, strokeWidth = null) => `
	<g stroke="${colour}" stroke-width="${strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round" fill="none">
		<circle cx="490" cy="355" r="78" stroke-width="35" />
		<circle cx="720" cy="326" r="42" stroke-width="29" />
		<circle cx="368" cy="686" r="41" stroke-width="29" />
		<path d="M370 645 V545 a90 90 0 0 1 90 -90 h60 a78 78 0 0 1 66 44" stroke-width="33" />
		<path d="M590 498 V750" stroke-width="33" />
		<path d="M600 492 C 646 512 686 480 706 400 L 712 378" stroke-width="33" />
	</g>`;

const MARK_VIEWBOX = "285 253 520 520";
/** Round a canvas coordinate for the emitted SVG.
 *
 * A float artefact is not a rendering bug — Icon Composer reads the numbers — but
 * `15.999999999999998` in a committed SVG shows up in every future diff of that
 * file, and a transform a human has to decode is a transform nobody reviews. Two
 * decimals is well under a device pixel at a 1024 canvas. */
const coord = (n) => String(Math.round(n * 100) / 100);

/** The artwork's own aspect, used to centre it: the viewBox is already cropped
 * to the mark plus even padding, so a square render centred in a square canvas
 * is centred on the mark. */
const svg = ({ size, ground, mark, markScale = 1, transparent = false }) => {
	const inset = (1 - markScale) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
	<title>Local Operator</title>
	${transparent ? "" : `<rect x="0" y="0" width="100" height="100" fill="${ground}"/>`}
	<svg x="${coord(inset * 100)}" y="${coord(inset * 100)}" width="${coord(markScale * 100)}" height="${coord(markScale * 100)}"
	     viewBox="${MARK_VIEWBOX}" fill="none">${markGroup(mark)}</svg>
</svg>`;
};

/* ---- the rasterizer --------------------------------------------------- */

const RENDERERS = [
	{ bin: "rsvg-convert", args: (svgPath, pngPath, size) => ["-w", String(size), "-h", String(size), "-o", pngPath, svgPath], install: "brew install librsvg" },
	{ bin: "magick", args: (svgPath, pngPath, size) => ["-background", "none", "-density", "384", "-resize", `${size}x${size}`, svgPath, pngPath], install: "brew install imagemagick" },
	{ bin: "convert", args: (svgPath, pngPath, size) => ["-background", "none", "-density", "384", "-resize", `${size}x${size}`, svgPath, pngPath], install: "brew install imagemagick@6" },
];

const findRenderer = () => {
	for (const r of RENDERERS) {
		try {
			execFileSync(r.bin, ["--version"], { stdio: "ignore" });
			return r;
		} catch {
			/* try the next one */
		}
	}
	return null;
};

/* The Play listing icon is the one asset Google specifies as "32-bit PNG (with
 * alpha)" (Play Console help, `support.google.com/googleplay/android-developer
 * /answer/9866151`, read 2026-09-29), and `rsvg-convert` emits an RGB PNG when
 * nothing in the artwork is transparent — measured on the generated file,
 * channels `srgb` with no alpha. A fully opaque RGBA file is what Play wants:
 * the requirement is about the FILE, not about the artwork having see-through
 * pixels. This re-writes it as PNG32 when ImageMagick is present, and says so
 * rather than silently shipping a file that fails the upload check. */
const alphaTool = () =>
	["magick", "convert"].find((bin) => {
		try {
			execFileSync(bin, ["--version"], { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	});

const forceAlphaChannel = (pngPath) => {
	const bin = alphaTool();
	if (!bin) {
		console.warn(
			`warning: no ImageMagick, so ${pngPath} cannot be re-encoded as PNG32 — Play asks for a 32-bit PNG WITH an alpha channel (\`magick ${pngPath} -alpha set PNG32:${pngPath}\`)`,
		);
		return false;
	}
	/* `-define png:exclude-chunks=time,date` is what makes this reproducible. The
	 * encoder writes a `tIME` chunk by default, so re-running the generator one
	 * second later produced a DIFFERENT file with identical pixels — the committed
	 * Play icon showed up as modified after every regeneration, and a byte gate
	 * could never pass on it without the pixel fallback. Dropping the timestamp
	 * chunks makes the encode a function of the pixels alone. */
	execFileSync(
		bin,
		[
			pngPath,
			"-alpha",
			"set",
			"-define",
			"png:exclude-chunks=time,date",
			`PNG32:${pngPath}`,
		],
		{ stdio: "pipe" },
	);
	return true;
};

const renderer = findRenderer();
if (!renderer) {
	/* No rasterizer means `--check` CANNOT verify the PNGs, which is a failure
	   of the instrument rather than a pass — the whole point of M1 in the round-1
	   review. Generation needs it for the same reason, so both paths stop. */
	console.error(
		"No SVG rasterizer found. One of these is required to generate the icon PNGs " +
			"and to verify them in --check mode (verifying means re-rendering and comparing):\n" +
			RENDERERS.map((r) => `  ${r.bin.padEnd(14)} ${r.install}`).join("\n") +
			"\n\nThe committed PNGs are already in the tree — this is only needed to regenerate them " +
			"or to check them.",
	);
	process.exit(2);
}

/* ---- the build -------------------------------------------------------- */

const scratch = `${process.env.LOCAL_OPERATOR_SCRATCHPAD ?? "/tmp"}/lo-icons-${process.pid}`;
mkdirSync(scratch, { recursive: true });

const written = [];
const problems = [];
const verified = [];

/** Record a check failure. Every one of these prints the path AND the reason,
 * because "stale" without a path is the message that made the first version of
 * this gate useless. */
const stale = (path, why) => {
	problems.push(`${path} — ${why}`);
	process.exitCode = 1;
};

const write = (path, contents) => {
	const target = out(path);
	if (check) {
		if (!existsSync(target)) return stale(path, "missing");
		const current = readFileSync(target, "utf8");
		if (current !== contents) return stale(path, "different text");
		return verified.push(`${path} (text)`);
	}
	mkdirSync(new URL(".", new URL(out(path), "file://")).pathname, { recursive: true });
	writeFileSync(target, contents);
	written.push(path);
};

/* A rasterizer that silently clamps (ImageMagick's SVG delegate has done
 * exactly that) would otherwise ship a wrong-sized icon, so every render is
 * measured after it is produced. */
const pngSize = (path) => {
	const b = readFileSync(path);
	if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47)
		return { width: 0, height: 0 };
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

/** Pixel-identical rather than byte-identical, for the one asset an external
 * tool re-encodes. Returns `true`/`false`, or `null` when no ImageMagick is
 * available to decode with — and `null` is treated as a FAILURE by the caller,
 * never as a pass. */
const pixelsIdentical = (a, b) => {
	const bin = alphaTool();
	if (!bin) return null;
	try {
		execFileSync(bin, ["compare", "-metric", "AE", a, b, "null:"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		return true; /* exit 0 = zero differing pixels */
	} catch (e) {
		/* `compare` exits 1 and prints the count of differing pixels on stderr
		   when the images differ, which is a real difference, not a tool error. */
		const said = String(e.stderr ?? "");
		if (/^\s*\d+\s*$/.test(said.trim()) || /^\s*\d+\s*\(/.test(said.trim())) return false;
		return null;
	}
};

/**
 * Render one SVG string and reconcile it with the committed PNG.
 *
 * In generation mode the render lands in the tree. In `--check` mode it lands
 * in the scratch dir and is compared against the committed file, so the gate
 * verifies the PIXELS a reader will see rather than the text of an SVG.
 *
 * The first version of this function returned immediately under `--check`, so
 * `--check` never opened a PNG: replacing all sixteen committed icons with
 * `\x89PNG...CORRUPTED` still printed "icon assets are current" and exited 0.
 * A gate that cannot fail is worse than no gate, and the failure mode is
 * documented in this repository's own rules ("a dead instrument returns a
 * reading, not an error").
 */
const render = (svgString, pngPath, size, { reencodeAlpha = false } = {}) => {
	const target = out(pngPath);
	const stem = pngPath.replaceAll("/", "_");
	const svgPath = `${scratch}/${stem}.svg`;
	const scratchPng = `${scratch}/${stem}`;
	writeFileSync(svgPath, svgString);
	execFileSync(renderer.bin, renderer.args(svgPath, scratchPng, size), { stdio: "pipe" });

	/* The Play icon is re-encoded after rendering (see `forceAlphaChannel`), and
	 * the re-encode is part of the artefact. Applying it to the scratch render
	 * too is what makes the comparison apples-to-apples. */
	if (reencodeAlpha && !forceAlphaChannel(scratchPng))
		return stale(pngPath, "cannot reproduce: no ImageMagick to re-encode the alpha channel");

	const { width, height } = pngSize(scratchPng);
	if (width !== size || height !== size)
		return stale(
			pngPath,
			`the renderer produced ${width}x${height}, not ${size}x${size} (a rasterizer that clamps silently) — the check cannot trust its own output`,
		);

	if (check) {
		if (!existsSync(target)) return stale(pngPath, "missing");
		const fresh = readFileSync(scratchPng);
		const committed = readFileSync(target);
		if (fresh.equals(committed)) return verified.push(`${pngPath} (byte-identical)`);
		/* Bytes differ, which is expected for exactly one asset: an external
		   encoder's PNG metadata is not reproducible. Decode both and compare
		   pixels before calling it stale, and say WHICH comparison passed. */
		if (pixelsIdentical(scratchPng, target) === true)
			return verified.push(`${pngPath} (pixels identical; bytes differ by encoder metadata)`);
		return stale(
			pngPath,
			`does not match a fresh render of its own SVG (bytes differ and pixels differ, or no decoder is available to prove the pixels match)`,
		);
	}

	mkdirSync(new URL(".", new URL(target, "file://")).pathname, { recursive: true });
	writeFileSync(target, readFileSync(scratchPng));
	written.push(pngPath);
};

/* ---- 1. the master mark ----------------------------------------------- */

write(
	"design/app-icon/mark.svg",
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="none" role="img" aria-label="Local Operator mark">
	<title>Local Operator mark</title>
	<!-- GENERATED by design/app-icon/build-icons.mjs — edit the geometry there.
	     The site's own geometry, traced from the source raster rather than
	     redrawn. Monochrome and stroke-only, so it inherits the ink of
	     whatever surface it lands on: one asset for both themes. -->
${markGroup(C.lightMark)}
</svg>
`,
);

/* ---- 2. iOS ----------------------------------------------------------- */

/* The mark occupies 68% of the canvas: the platform's continuous-corner mask
 * takes the corners, and Apple's guidance is that the artwork should sit inside
 * a square that survives the mask with breathing room. 68% is measured off the
 * existing shipped icon.png, whose mark spans 318 of its 464-pixel-wide circle. */
const IOS_MARK_SCALE = 0.68;

write(
	"design/app-icon/ios/icon-light.svg",
	svg({ size: 1024, ground: C.lightGround, mark: C.lightMark, markScale: IOS_MARK_SCALE }),
);
write(
	"design/app-icon/ios/icon-dark.svg",
	svg({ size: 1024, ground: C.darkGround, mark: C.darkMark, markScale: IOS_MARK_SCALE }),
);
/* Tinted: GREYSCALE ON A TRANSPARENT CANVAS, by definition — iOS 26 derives the
 * hue from the user's wallpaper, so a coloured tinted icon is a category error,
 * and an opaque ground would defeat the tint entirely. */
write(
	"design/app-icon/ios/icon-tinted.svg",
	svg({ size: 1024, ground: null, mark: "#ffffff", markScale: IOS_MARK_SCALE, transparent: true }),
);
for (const variant of ["light", "dark", "tinted"])
	render(readFileSync(out(`design/app-icon/ios/icon-${variant}.svg`), "utf8"), `design/app-icon/ios/icon-${variant}-1024.png`, 1024);

/* Icon Composer layers: flat, opaque, one object per layer, background at the
 * bottom of the z-stack. Nothing is blurred, shadowed or glassed here — those
 * are Icon Composer's job, and baking them into the source removes the ability
 * to tune them per appearance. See the layers README for the ordering rule. */
for (const [name, ground, mark] of [
	["01-background", C.darkGround, null],
	["02-mark", null, C.darkMark],
]) {
	write(
		`design/app-icon/ios/layers/${name}.svg`,
		`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">
	<title>Local Operator — ${name}</title>
	<!-- Layer ${name === "01-background" ? "1 of 2 (backmost)" : "2 of 2 (frontmost)"}.
	     Flat and opaque on purpose: depth, blur, specular and refraction belong to
	     Icon Composer, not to the source art. -->
	${ground ? `<rect width="100" height="100" fill="${ground}"/>` : ""}
	${mark ? `<svg x="${coord((1 - IOS_MARK_SCALE) * 50)}" y="${coord((1 - IOS_MARK_SCALE) * 50)}" width="${coord(IOS_MARK_SCALE * 100)}" height="${coord(IOS_MARK_SCALE * 100)}" viewBox="${MARK_VIEWBOX}" fill="none">${markGroup(mark)}</svg>` : ""}
</svg>
`,
	);
}

/* ---- 3. Android ------------------------------------------------------- */

/* Adaptive icons: the launcher may mask the 108 dp canvas down to a 72 dp
 * circle, so the documented safe zone is a centred 66 dp square. Artwork is
 * scaled to 66/108 = 0.611 of the canvas at 432 px (4x of 108 dp), which leaves
 * the foot node inside every mask shape including a circle. */
const ANDROID_SAFE = 66 / 108;

write(
	"design/app-icon/android/ic_launcher_foreground.svg",
	svg({ size: 432, ground: null, mark: C.androidMark, markScale: ANDROID_SAFE, transparent: true }),
);
write(
	"design/app-icon/android/ic_launcher_background.svg",
	`<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 100 100">
	<title>Local Operator — adaptive background</title>
	<!-- A FLAT ground, no gradient and no vignette: the launcher parallaxes this
	     layer against the foreground, and a gradient shifts its apparent material
	     as it moves. -->
	<rect width="100" height="100" fill="${C.androidBackground}"/>
</svg>
`,
);
/* Monochrome (themed) icon: alpha only, one colour, no ground. Android tints it
 * from the wallpaper's palette, so any baked colour is thrown away — and a baked
 * GROUND would tint the whole square instead of the mark. */
write(
	"design/app-icon/android/ic_launcher_monochrome.svg",
	svg({ size: 432, ground: null, mark: "#ffffff", markScale: ANDROID_SAFE, transparent: true }),
);
render(readFileSync(out("design/app-icon/android/ic_launcher_foreground.svg"), "utf8"), "design/app-icon/android/ic_launcher_foreground-432.png", 432);
render(readFileSync(out("design/app-icon/android/ic_launcher_background.svg"), "utf8"), "design/app-icon/android/ic_launcher_background-432.png", 432);
render(readFileSync(out("design/app-icon/android/ic_launcher_monochrome.svg"), "utf8"), "design/app-icon/android/ic_launcher_monochrome-432.png", 432);

/* Legacy launcher icons for pre-API-26 devices: the whole icon in one image,
 * dark ground and light mark, matching what the shipped desktop icon looks like.
 * Google still asks for these; they are cheap and their absence is a visible
 * white square on an older phone. */
for (const [dir, px] of [
	["mipmap-mdpi", 48],
	["mipmap-hdpi", 72],
	["mipmap-xhdpi", 96],
	["mipmap-xxhdpi", 144],
	["mipmap-xxxhdpi", 192],
]) {
	const scale = px >= 96 ? IOS_MARK_SCALE : 0.72; // small sizes need a slightly larger mark to stay legible
	write(
		`design/app-icon/android/${dir}/ic_launcher.svg`,
		svg({ size: px, ground: C.androidBackground, mark: C.androidMark, markScale: scale }),
	);
	render(readFileSync(out(`design/app-icon/android/${dir}/ic_launcher.svg`), "utf8"), `design/app-icon/android/${dir}/ic_launcher.png`, px);
}

/* The notification small icon. Android masks it to a solid silhouette and draws
 * it in the system's own colour, so: ONE colour, alpha only, NO ground, and a
 * mark large enough that the silhouette survives at 24 dp. This is the asset
 * most often shipped wrong (a full-colour launcher icon in its place renders as
 * a white blob), which is why it has its own file and its own comment. */
write(
	"design/app-icon/android/ic_notification.svg",
	svg({ size: 96, ground: null, mark: "#ffffff", markScale: 0.92, transparent: true }),
);
render(readFileSync(out("design/app-icon/android/ic_notification.svg"), "utf8"), "design/app-icon/android/ic_notification.png", 96);

/* ---- 4. splash -------------------------------------------------------- */

/* Transparent and mark-only: the splash's BACKGROUND is a colour the app config
 * sets (expo-splash-screen `backgroundColor`), so baking a ground here would
 * double up and break the dark variant's ability to follow the theme. The mark
 * sits at 34% of the canvas height, which is the size the desktop app's launch
 * frame reads at. */
for (const [variant, mark] of [
	["light", C.lightMark],
	["dark", C.darkMark],
]) {
	write(
		`design/app-icon/splash/splash-${variant}.svg`,
		svg({ size: 1024, ground: null, mark, markScale: 0.34, transparent: true }),
	);
	render(readFileSync(out(`design/app-icon/splash/splash-${variant}.svg`), "utf8"), `design/app-icon/splash/splash-${variant}.png`, 1024);
}

/* ---- 5. store icon ---------------------------------------------------- */

/* Google Play's listing icon: 512x512, 32-bit PNG WITH alpha, no rounded corners
 * and no drop shadow (Play renders both itself, and baking them doubles the
 * corner). The mark is drawn full-bleed on the Play brand ground with more
 * padding than the iOS icon, because Play crops to a circle on some surfaces. */
write(
	"design/app-icon/store/play-icon-512.svg",
	svg({ size: 512, ground: C.androidBackground, mark: C.androidMark, markScale: 0.62 }),
);
render(readFileSync(out("design/app-icon/store/play-icon-512.svg"), "utf8"), "design/app-icon/store/play-icon-512.png", 512, {
	reencodeAlpha: true,
});

/* ---- report ---------------------------------------------------------- */

/* Clean up the scratch renders on EVERY exit path, including the failures.
 *
 * This was called at the end of the two success paths, so a stale-file exit(1) or
 * a missing-rasterizer exit(2) left a full 33-file tree behind, and five had
 * accumulated before the round-2 review found them. A per-pid directory means
 * they do not collide, but they do add up: the tree is ~272 KB and the host this
 * runs on is shared, so `process.on("exit")` is the right place for it, not the
 * happy path. */
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

if (check) {
	for (const line of problems) console.error(`stale: ${line}`);
	if (problems.length) {
		console.error(
			`\n${problems.length} of ${problems.length + verified.length} generated files do not match their source ` +
				`— run \`node design/app-icon/build-icons.mjs\``,
		);
		process.exit(1);
	}
	console.log(`${verified.length} generated files verified against a fresh derivation (renderer: ${renderer.bin})`);
	console.log("icon assets are current");
	process.exit(0);
}
if (written.length === 0) console.log("nothing to do");
console.log(`wrote ${written.length} files (renderer: ${renderer.bin})`);
