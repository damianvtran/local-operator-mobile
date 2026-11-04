import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-sound Android channel set and the bundle it plays from.
 *
 * What is pinned, and why each one matters:
 *  1. exactly twelve channels — `sound.<id>` ×10, `sound.default`,
 *     `sound.none` — because the cloud maps `data.sound` straight to a channel
 *     id (ADR 0006 §3.2) and FCM silently reroutes an id the app never created;
 *  2. each built-in channel names its own `res/raw` file, `sound.default`
 *     carries NO `sound` key (expo reads an absent key as the system default)
 *     and `sound.none` carries `sound: null` (silence) — swapping those two is
 *     the "sound off still rings" failure;
 *  3. the committed WAVs, the export manifest and the id list agree, so a sound
 *     cannot be registered with the plugin and missing a channel, or vice versa;
 *  4. one failing channel does not stop the rest, and the legacy `default`
 *     channel is removed.
 */

const platform = vi.hoisted(() => ({ OS: "android" as string }));
vi.mock("react-native", () => ({ Platform: platform }));

type ChannelCall = [string, Record<string, unknown>];
const calls: ChannelCall[] = [];
const deleted: string[] = [];
let failId: string | null = null;

vi.mock("expo-notifications", () => ({
	AndroidImportance: { DEFAULT: 3 },
	setNotificationChannelAsync: async (
		id: string,
		input: Record<string, unknown>,
	) => {
		if (id === failId) throw new Error("synthetic failure");
		calls.push([id, input]);
		return null;
	},
	deleteNotificationChannelAsync: async (id: string) => {
		deleted.push(id);
	},
}));

const {
	BUILTIN_SOUND_IDS,
	bundledSoundFile,
	LEGACY_ALERT_CHANNEL_ID,
	soundChannelSpecs,
} = await import("@/notifications/sound-catalog");
const { ensureAndroidSoundChannels } = await import("@/notifications/native");

const WAV_SUFFIX = /\.wav$/;
/** Android `res/raw` resource-name rule (`assertValidAndroidAssetName`). */
const ANDROID_RAW_NAME = /^[a-z][a-z0-9_]*$/;
/** An unrendered catalogue key: a name that is the key, not its text. */
const RAW_KEY = /^mobile\./;

const ASSETS = new URL("../../assets/notification-sounds/", import.meta.url);

beforeEach(() => {
	calls.length = 0;
	deleted.length = 0;
	failId = null;
	platform.OS = "android";
});

describe("soundChannelSpecs", () => {
	it("is the twelve channels the cloud can name", () => {
		expect(soundChannelSpecs().map((spec) => spec.id)).toEqual([
			"sound.soft-pulse",
			"sound.two-note-chime",
			"sound.felt-marimba",
			"sound.hum-swell",
			"sound.task-complete",
			"sound.signal-handshake",
			"sound.tape-warble",
			"sound.bubble-chord",
			"sound.airy-whistle",
			"sound.bubble-pulse",
			"sound.default",
			"sound.none",
		]);
	});

	it("names a valid Android raw resource for every built-in", () => {
		for (const id of BUILTIN_SOUND_IDS) {
			const stem = bundledSoundFile(id).replace(WAV_SUFFIX, "");
			expect(stem).toMatch(ANDROID_RAW_NAME);
		}
		expect(bundledSoundFile("soft-pulse")).toBe("soft_pulse.wav");
	});
});

describe("ensureAndroidSoundChannels", () => {
	it("creates all twelve with the right sound for each", async () => {
		await ensureAndroidSoundChannels();
		const byId = new Map(calls);
		expect([...byId.keys()]).toHaveLength(12);
		for (const id of BUILTIN_SOUND_IDS) {
			expect(byId.get(`sound.${id}`)?.sound).toBe(bundledSoundFile(id));
		}
		// Absent key = the system default sound; present-and-null = silent.
		expect(byId.get("sound.default")).not.toHaveProperty("sound");
		expect(byId.get("sound.none")).toHaveProperty("sound", null);
		for (const [, input] of calls) {
			expect(input.importance).toBe(3);
			expect(typeof input.name).toBe("string");
			expect(input.name).not.toMatch(RAW_KEY);
			expect(input.description).not.toMatch(RAW_KEY);
		}
		expect(byId.get("sound.soft-pulse")?.name).toBe("Soft pulse");
		expect(byId.get("sound.none")?.name).toBe("Silent");
		expect(deleted).toEqual([LEGACY_ALERT_CHANNEL_ID]);
	});

	it("keeps going when one channel cannot be created", async () => {
		failId = "sound.hum-swell";
		await ensureAndroidSoundChannels();
		expect(calls.map(([id]) => id)).toHaveLength(11);
		expect(calls.map(([id]) => id)).toContain("sound.none");
	});

	it("does nothing off Android", async () => {
		platform.OS = "ios";
		await ensureAndroidSoundChannels();
		expect(calls).toEqual([]);
		expect(deleted).toEqual([]);
	});
});

describe("the bundled sound files", () => {
	const manifest = JSON.parse(
		readFileSync(new URL("manifest.json", ASSETS), "utf8"),
	) as {
		default: string;
		sounds: { id: string; file: string; sha256: string; bytes: number }[];
	};

	it("lists the ten built-ins in catalog order, default first", () => {
		expect(manifest.sounds.map((sound) => sound.id)).toEqual([
			...BUILTIN_SOUND_IDS,
		]);
		expect(manifest.default).toBe(BUILTIN_SOUND_IDS[0]);
	});

	it("has exactly the manifest's files on disk, with matching sha256", () => {
		const wavs = readdirSync(ASSETS)
			.filter((name) => name.endsWith(".wav"))
			.sort();
		expect(wavs).toEqual(manifest.sounds.map((sound) => sound.file).sort());
		for (const sound of manifest.sounds) {
			expect(sound.file).toBe(bundledSoundFile(sound.id));
			const bytes = readFileSync(new URL(sound.file, ASSETS));
			expect(bytes.length).toBe(sound.bytes);
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(
				sound.sha256,
			);
		}
	});

	it("is the expo-notifications plugin's sounds list", () => {
		const config = readFileSync(
			new URL("../../app.config.ts", import.meta.url),
			"utf8",
		);
		expect(config).toContain("sounds: notificationSoundFiles()");
	});
});
