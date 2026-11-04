#!/usr/bin/env node
/**
 * Export the ten built-in notification sounds from a Local Operator checkout
 * into this app's bundle, with a sha256 parity manifest.
 *
 *     node scripts/sounds/export-mobile.ts --core ~/local-operator
 *     node scripts/sounds/export-mobile.ts --core ~/local-operator --check
 *
 * WHY THE SOURCE IS THE CORE'S SHIPPED FLAC. The computer's selection travels
 * in the push payload (`data.sound`, ADR 0006 §3.2) and the phone plays the
 * same id, so the phone's file must be the computer's sound, not a lookalike.
 * The core ships each sound as 16-bit FLAC (`local_operator/notifications/
 * sounds/`, derived from its reviewed masters by `assets/notification-sounds/
 * export.py`) and records each file's sha256 in `catalog.json`. This script
 * refuses a FLAC whose bytes disagree with that catalog, decodes it to 16-bit
 * PCM WAV (FLAC → WAV at the same bit depth is sample-exact: no resample, no
 * requantisation, no dither) and writes `assets/notification-sounds/
 * manifest.json` naming the core sha it came from. So a sound re-mastered in
 * the core shows up here as a manifest mismatch under `--check`, instead of
 * the phone quietly playing the old take.
 *
 * WHY WAV. iOS notification sounds must be aiff, wav or caf (Apple,
 * `UNNotificationSound`); FLAC is not accepted. IMA4-CAF would be ~3.4×
 * smaller but ADPCM is lossy, which the operator ruled out (design §2, table
 * "Mobile app bundle"). Ten WAVs are ~0.8 MB, negligible in an app bundle.
 *
 * WHY THE FILE STEM USES UNDERSCORES (`soft_pulse.wav` for id `soft-pulse`).
 * expo-notifications' config plugin takes ONE `sounds:` list for both
 * platforms and copies it into Android `res/raw`, whose resource names must
 * match `[a-z][a-z0-9_]*`: the plugin calls `assertValidAndroidAssetName` and
 * fails prebuild on a hyphen, and at run time `SoundResolver` looks a channel's
 * sound up with `getIdentifier(<stem>, "raw")`. The ADR's iOS mapping names the
 * same stem (`aps.sound = "<id with - → _>.wav"`). The catalog id itself keeps
 * its hyphen everywhere else (payload, Android channel id `sound.<id>`).
 *
 * WHY BIT-EXACT. `-fflags +bitexact -map_metadata -1` keep the encoder's
 * version string out of the RIFF header, so re-running this with another
 * ffmpeg build does not churn the committed bytes or their sha256.
 *
 * Needs ffmpeg (`--ffmpeg PATH` to override); the app build itself does not —
 * the WAVs are committed, and this runs only when the core's sounds change.
 * Runs directly under Node's native type stripping (erasable syntax only).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	bundledSoundFile,
	type SoundManifest,
	type SoundManifestEntry,
} from "../../src/notifications/sound-catalog.ts";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = join(REPO, "assets", "notification-sounds");

type CoreCatalogEntry = {
	id: string;
	file: string;
	sha256: string;
	duration_s: number;
	channels: number;
};

type CoreCatalog = {
	schema: number;
	default: string;
	sounds: CoreCatalogEntry[];
};

const sha256 = (bytes: Buffer): string =>
	createHash("sha256").update(bytes).digest("hex");

const expandHome = (path: string): string =>
	path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;

function argument(argv: string[], name: string): string | null {
	const index = argv.indexOf(name);
	if (index === -1) return null;
	const value = argv[index + 1];
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`${name} needs a value`);
	}
	return value;
}

function findFfmpeg(explicit: string | null): string {
	if (explicit !== null) return explicit;
	if (existsSync("/opt/homebrew/bin/ffmpeg")) return "/opt/homebrew/bin/ffmpeg";
	return "ffmpeg";
}

function decode(ffmpeg: string, flac: string, wav: string): void {
	execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-y",
			"-i",
			flac,
			"-map_metadata",
			"-1",
			"-fflags",
			"+bitexact",
			"-flags:a",
			"+bitexact",
			"-c:a",
			"pcm_s16le",
			wav,
		],
		{ stdio: ["ignore", "inherit", "inherit"] },
	);
}

function main(argv: string[]): number {
	const coreArg = argument(argv, "--core");
	if (coreArg === null) {
		process.stderr.write(
			"usage: node scripts/sounds/export-mobile.ts --core <local-operator checkout> [--check] [--ffmpeg PATH]\n",
		);
		return 2;
	}
	const check = argv.includes("--check");
	const ffmpeg = findFfmpeg(argument(argv, "--ffmpeg"));
	const soundsDir = join(
		resolve(expandHome(coreArg)),
		"local_operator",
		"notifications",
		"sounds",
	);
	const catalog = JSON.parse(
		readFileSync(join(soundsDir, "catalog.json"), "utf8"),
	) as CoreCatalog;
	if (catalog.schema !== 1) {
		throw new Error(`unknown core catalog schema ${catalog.schema}`);
	}

	// In --check mode the WAVs are decoded to a scratch directory and compared,
	// so a check never rewrites the committed tree.
	const target = check
		? join(tmpdir(), `lop-mobile-sounds-check-${process.pid}`)
		: OUT;
	mkdirSync(target, { recursive: true });

	const entries: SoundManifestEntry[] = [];
	for (const sound of catalog.sounds) {
		const flacPath = join(soundsDir, sound.file);
		const flacSha = sha256(readFileSync(flacPath));
		if (flacSha !== sound.sha256) {
			throw new Error(
				`${sound.file}: sha256 ${flacSha} disagrees with the core catalog (${sound.sha256})`,
			);
		}
		const file = bundledSoundFile(sound.id);
		const wavPath = join(target, file);
		decode(ffmpeg, flacPath, wavPath);
		const wav = readFileSync(wavPath);
		entries.push({
			id: sound.id,
			file,
			sha256: sha256(wav),
			bytes: wav.length,
			duration_s: sound.duration_s,
			channels: sound.channels,
			source_file: sound.file,
			source_sha256: sound.sha256,
		});
		process.stdout.write(
			`${sound.id.padEnd(17)} ${sound.channels}ch ${String(wav.length).padStart(7)} B  ${file}\n`,
		);
	}
	const manifest: SoundManifest = {
		schema: 1,
		default: catalog.default,
		sounds: entries,
	};
	const text = `${JSON.stringify(manifest, null, "\t")}\n`;
	const manifestPath = join(OUT, "manifest.json");
	if (check) {
		rmSync(target, { recursive: true, force: true });
		const committed = existsSync(manifestPath)
			? readFileSync(manifestPath, "utf8")
			: "";
		if (committed !== text) {
			process.stderr.write(
				"assets/notification-sounds/manifest.json is stale against the core's sounds; re-run without --check\n",
			);
			return 1;
		}
		process.stdout.write("manifest matches the core catalog\n");
		return 0;
	}
	writeFileSync(manifestPath, text);
	const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
	process.stdout.write(
		`total ${total} B (${(total / 1048576).toFixed(3)} MiB)\n`,
	);
	return 0;
}

process.exitCode = main(process.argv.slice(2));
