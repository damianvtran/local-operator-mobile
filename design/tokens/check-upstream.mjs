#!/usr/bin/env node
/**
 * The design-kit upstream check (ADR 0007 § Decision 2).
 *
 *     node design/tokens/check-upstream.mjs
 *
 * TWO CHECKS, TWO MESSAGES. They fail for different reasons, and whoever reads
 * a red run needs to know which one fired:
 *
 *   (a) the slice equals the kit at the locked ref — "the pin is lying".
 *       `design/tokens/upstream/*.json` are byte copies of
 *       `damianvtran/local-operator-design` at the ref `design-kit.lock.json`
 *       names. This fetches each file from raw.githubusercontent.com at that
 *       ref — public→public, anonymous, fork-safe: no credentials belong in
 *       this path — and asserts fetched == slice == the lock's hashes. Needs
 *       the network.
 *
 *   (b) `tokens.json` equals the slice — "someone edited brand values in this
 *       repository". Every colour role this file shares with the app family is
 *       compared per theme; hex case and whitespace are not significant. Local
 *       and offline.
 *
 * THE STANDING DIFFERENCES. Two roles differ between this file and the app
 * family today. They are not drift to be quietly absorbed, and this check does
 * not wave them through: each is PINNED below with both values and a reason,
 * and a pin fails if either side moves. That is the same discipline the kit's
 * divergence register uses — a recorded difference is re-checked on every run
 * and cannot outlive the values it describes — applied at the point where this
 * repository can enforce it. A difference that should outlive this file belongs
 * in the kit's register (`design/tokens/upstream/divergences.json`) and lands
 * there at a kit release; until then the pin is the record. A pin is not a
 * mute button.
 *
 * No dependencies, no build step, plain `node` >= 18.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const lock = JSON.parse(
	readFileSync(new URL("../../design-kit.lock.json", here), "utf8"),
);
const tokens = JSON.parse(readFileSync(new URL("./tokens.json", here), "utf8"));
const sliceDir = new URL("./upstream/", here);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const norm = (v) => String(v).replace(/\s+/g, " ").trim().toLowerCase();
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/* ---- the standing differences, pinned both ways ------------------------ */

const PINNED = [
	{
		role: "hairline-strong",
		app: { light: "#c9c3b6", dark: "#4d4633" },
		family: { light: "#BDB8AE", dark: "#454031" },
		why:
			"This app authored its value at the token file's inception (2026-09-29, the first commit\n" +
			"      of tokens.json); the desktop app's role, which the app family mirrors, landed with a\n" +
			"      different value two days later (local-operator-ui #621, 2026-09-30; its derivation is a\n" +
			"      5% step of hairline toward inkDim reaching >=1.5:1 on sunken, per palette-contract.ts).\n" +
			"      The role is decorative in both files and unconsumed by app code. Reconciling the values\n" +
			"      is a brand change that regenerates every committed artefact; it belongs to a deliberate\n" +
			"      brand pass (or a kit release), not to this check. Pinned so neither side moves unnoticed.",
	},
	{
		role: "scrim",
		app: { value: "#0b0a08b3" },
		family: { light: "rgb(20 17 12 / 0.35)", dark: "rgb(0 0 0 / 0.6)" },
		why:
			"This app ships its scrim as a theme-invariant literal (tokens.json § fixed, 'literal values\n" +
			"      the system commits to') — a warm-black at 70% — with the recorded reason that a scrim's\n" +
			"      job does not change with the theme. The register role is per-theme (a warm overlay in\n" +
			"      light, black at 60% in dark), so the shape differs as well as the value. Pinned so neither\n" +
			"      side moves unnoticed; a reconciliation is a brand change, not an edit to this check.",
	},
];

/* ---- (a) the pin: slice == kit at the locked ref ----------------------- */

const aProblems = [];

async function checkPin() {
	console.log(
		`(a) the pin — slice vs ${lock.kit}@${lock.ref} (raw.githubusercontent.com, anonymous)`,
	);
	const base = `https://raw.githubusercontent.com/${lock.kit}/${lock.ref}`;
	for (const [name, expected] of Object.entries(lock.files)) {
		const url = `${base}/${name}`;
		let fetched;
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
			if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
			fetched = Buffer.from(await res.arrayBuffer());
		} catch (err) {
			aProblems.push(
				`${name}: could not fetch ${url} (${err.message}) — the pin check needs the network`,
			);
			continue;
		}
		const fetchedHash = sha256(fetched);
		let localHash;
		try {
			localHash = sha256(readFileSync(new URL(name, sliceDir)));
		} catch (err) {
			aProblems.push(`${name}: missing from the slice (${err.message})`);
			continue;
		}
		if (localHash !== expected) {
			aProblems.push(
				`${name}: the slice does not match the lock — slice sha256 ${localHash}, lock ${expected}`,
			);
		}
		if (fetchedHash !== expected) {
			aProblems.push(
				`${name}: the kit at ${lock.ref} does not match the lock — fetched sha256 ${fetchedHash}, lock ${expected}`,
			);
		}
		if (localHash === expected && fetchedHash === expected) {
			console.log(
				`    ${name.padEnd(18)} ${expected.slice(0, 12)}…  slice == lock == kit@${lock.ref}`,
			);
		}
	}
}

/* ---- (b) the parity: tokens.json == the slice -------------------------- */

const bProblems = [];

function* roleLeaves(o, path = "") {
	if (o === null || typeof o !== "object") return;
	if ("role" in o && ("light" in o || "value" in o)) {
		yield [path, o];
		return;
	}
	for (const [k, v] of Object.entries(o)) {
		if (k.startsWith("$")) continue;
		yield* roleLeaves(v, path ? `${path}/${k}` : k);
	}
}

function checkParity() {
	const slice = JSON.parse(readFileSync(new URL("app-family.json", sliceDir), "utf8"));
	const light = slice.palettes.localOperatorLight.values;
	const dark = slice.palettes.localOperatorDark.values;
	const pinned = new Map(PINNED.map((p) => [p.role, p]));
	const leaves = [...roleLeaves(tokens.color)];
	const shipped = new Set(leaves.map(([p]) => camel(p.split("/").pop())));

	let equal = 0;
	const appOnly = [];
	let appOwnRoles = 0;

	for (const [path, token] of leaves) {
		const name = path.split("/").pop();
		const key = camel(name);
		if (!(key in light)) {
			if (!pinned.has(name)) appOwnRoles++;
			continue;
		}
		const pin = pinned.get(name);

		if (pin) {
			/* a pinned difference: both sides must equal their pins */
			const appSide =
				token.value !== undefined
					? { value: token.value }
					: { light: token.light, dark: token.dark };
			for (const [field, wanted] of Object.entries(pin.app)) {
				if (norm(appSide[field] ?? "") !== norm(wanted)) {
					bProblems.push(
						`${name}: this app's pinned value moved — ${field} is now ${appSide[field] ?? "(missing)"}, pin records ${wanted}`,
					);
				}
			}
			for (const field of Object.keys(appSide)) {
				if (!(field in pin.app)) {
					bProblems.push(
						`${name}: pinned difference changed shape — unexpected \`${field}\` on this app's side`,
					);
				}
			}
			const familyGot = { light: light[key], dark: dark[key] };
			for (const [field, wanted] of Object.entries(pin.family)) {
				if (norm(familyGot[field] ?? "") !== norm(wanted)) {
					bProblems.push(
						`${name}: the app family's pinned value moved — ${field} is now ${familyGot[field] ?? "(missing)"}, pin records ${wanted}`,
					);
				}
			}
			continue;
		}

		/* an unpinned shared role: the two sides must be equal, per theme */
		if (token.value !== undefined) {
			bProblems.push(
				`${name}: this app ships a single value (${token.value}) where the app family has a per-theme role (light ${light[key]}, dark ${dark[key]}) — shapes differ and no pin records it`,
			);
			continue;
		}
		const mismatches = [];
		if (norm(token.light) !== norm(light[key])) mismatches.push(`light ${token.light} ≠ ${light[key]}`);
		if (norm(token.dark) !== norm(dark[key])) mismatches.push(`dark ${token.dark} ≠ ${dark[key]}`);
		if (mismatches.length) {
			bProblems.push(`${name}: ${mismatches.join("; ")}`);
		} else {
			equal++;
		}
	}

	for (const key of Object.keys(light)) {
		if (!shipped.has(key)) {
			appOnly.push(key);
		}
	}

	console.log("(b) the parity — design/tokens/tokens.json vs the slice (local, offline)");
	console.log(
		`    ${equal} shared brand roles equal in both themes; ${appOwnRoles} roles are this app's own; ` +
			`${appOnly.length} slice roles are not shipped here (${appOnly.join(", ")}); ${PINNED.length} pinned differences:`,
	);
	for (const p of PINNED) {
		const appSide = p.app.value !== undefined ? `${p.app.value} (theme-invariant)` : `${p.app.light} / ${p.app.dark}`;
		const familySide =
			p.family.value !== undefined ? `${p.family.value}` : `${p.family.light} / ${p.family.dark}`;
		console.log(`      ${p.role.padEnd(16)} this app ${appSide}  ≠  app family ${familySide}`);
	}
}

/* ---- run --------------------------------------------------------------- */

await checkPin();
checkParity();

const failures = [
	...aProblems.map((p) => `(a) the pin is lying: ${p}`),
	...bProblems.map((p) => `(b) tokens.json does not match the slice: ${p}`),
];

if (failures.length) {
	console.error(`\n${failures.length} failure(s):`);
	for (const f of failures) console.error(`  ${f}`);
	console.error(
		"\nFix (a) by re-vendoring the slice from the kit at the lock's ref (a pin bump updates ref, commit, slice and hashes together). " +
			"Fix (b) by restoring the value the slice carries — if (a) failed too, restore the slice first, because (b) compares against the slice as it is — " +
			"or, if the difference is deliberate, record it as a pin in design/tokens/check-upstream.mjs with its reason (and, if it should outlive this file, in the kit's divergence register at a release).",
	);
	process.exit(1);
}
for (const p of PINNED) {
	/* the pins are printed with their reason on every run: a standing
	   difference is a decision the run should show, not one it should keep. */
	console.log(`\npinned difference: ${p.role} —\n      ${p.why}`);
}
console.log("\nUpstream check holds.");
