/**
 * The phone's half of the notification-sound contract: which sounds the app
 * bundles, what each file is called, and the Android channel set that plays
 * them.
 *
 * WHY THE PHONE HAS A FIXED LIST AT ALL. The sound is chosen on the computer
 * (`notifications.sound.*` in Local Operator) and travels in the push payload
 * as `data.sound`: one of the ten built-in ids, `"default"` or `"none"` (ADR
 * 0006 §3.2, amendment 2026-11-03). The cloud maps that value per platform and
 * never composes from it:
 *
 * - iOS: built-in → `aps.sound = "<file>"` (the bundled WAV below),
 *   `"default"` → `aps.sound = "default"`, `"none"` → `aps.sound` omitted;
 * - Android: `android.channel_id = "sound.<id>"`, `sound.default` or the silent
 *   `sound.none`.
 *
 * Android needs one CHANNEL per value because a channel's sound is fixed when
 * the channel is created (a later `setNotificationChannelAsync` cannot change
 * it), and FCM requires `channel_id` to name a channel the app has already
 * created or it falls back to another channel. So all twelve are created at
 * app start, before any push can name one.
 *
 * WHY THE FILE STEM IS NOT THE ID. expo-notifications applies one `sounds:`
 * list to both platforms and copies it to Android `res/raw`, whose names must
 * match `[a-z][a-z0-9_]*`; its plugin fails prebuild on a hyphen and its
 * `SoundResolver` finds a channel's sound with `getIdentifier(<stem>, "raw")`.
 * So `soft-pulse` ships as `soft_pulse.wav` on both platforms, and the ADR's
 * iOS mapping names that stem. The id keeps its hyphen everywhere else.
 *
 * This module is deliberately pure — no `react-native`, no `expo-*`, no `@/`
 * imports — so the Node unit tests and `scripts/sounds/export-mobile.ts`
 * (plain `node`, type stripping) can import it. `native.ts` supplies the
 * localised labels and the platform call.
 *
 * Adding or removing a sound starts in the core (`local_operator/
 * notifications/sounds/catalog.json`); re-run the export script, then update
 * `BUILTIN_SOUND_IDS`. `sound-catalog.test.ts` fails while the list, the
 * manifest and the committed files disagree.
 */

/** The ten built-in ids, in the core catalog's order (the default first). */
export const BUILTIN_SOUND_IDS = [
	"soft-pulse",
	"two-note-chime",
	"felt-marimba",
	"hum-swell",
	"task-complete",
	"signal-handshake",
	"tape-warble",
	"bubble-chord",
	"airy-whistle",
	"bubble-pulse",
] as const;

export type BuiltinSoundId = (typeof BUILTIN_SOUND_IDS)[number];

/** The bundled file name of a built-in sound: the id with `-` → `_`, `.wav`. */
export const bundledSoundFile = (id: string): string =>
	`${id.replaceAll("-", "_")}.wav`;

/** The WIRE channel id for a payload `sound` value: what the cloud names in
 *  `data.channelId` (agent-server `sessionpush/envelope.go`). Since ADR 0010 S4
 *  no channel with this id exists on the phone; see `sessionChannelId`. */
export const soundChannelId = (value: BuiltinSoundId | "default" | "none") =>
	`sound.${value}`;

/**
 * The ON-DEVICE channel id for a payload `sound` value (ADR 0010 S4, §7 row 4).
 *
 * WHY A SECOND ID. The `sound.*` channels were created at IMPORTANCE_DEFAULT,
 * which on Android plays the sound but shows NO heads-up banner, where iOS
 * shows one for the same push. Android fixes a channel's importance when the
 * channel is created (`NotificationChannel` docs: only the user may change it
 * afterwards), so raising it means new ids: these `alert.*` channels are
 * created at HIGH and the `sound.*` ones are deleted.
 *
 * WHY THE CLOUD STILL SENDS `sound.*`. The phone's presentation delegate
 * (`modules/lop-team-bridge-push`, `SessionChannels.kt`) rewrites a wire
 * `sound.<v>` to `alert.<v>` before Expo looks the channel up, whenever the
 * `alert.<v>` channel exists. So no cloud change is needed, an old app keeps
 * working against the same cloud, and a phone that has not yet run the
 * migration keeps posting on its old channel. The prefix swap is the whole
 * contract: change both sides together (`session-channels.test.ts` pins it).
 */
export const sessionChannelId = (value: BuiltinSoundId | "default" | "none") =>
	`alert.${value}`;

/** The prefixes the native remap swaps; exported so the Kotlin pin test reads
 *  the same two strings this module builds ids from. */
export const WIRE_SESSION_CHANNEL_PREFIX = "sound.";
export const DEVICE_SESSION_CHANNEL_PREFIX = "alert.";

/** The legacy single channel the app created before per-sound channels. No
 *  push ever named it (the cloud forward, S7, is unbuilt), so it is removed
 *  rather than left as a dead row in the system's notification settings. */
export const LEGACY_ALERT_CHANNEL_ID = "default";

/**
 * One channel to create. `sound` follows expo-notifications' channel input:
 * a `res/raw` file name plays that file, `null` is silent, and an ABSENT key
 * is the system's default notification sound (`Settings.System.
 * DEFAULT_NOTIFICATION_URI`, `AndroidXNotificationsChannelManager`).
 */
export type SoundChannelSpec = {
	id: string;
	label: SoundChannelLabel;
	sound?: string | null;
};

/** What `native.ts` must render a name for: a built-in sound, the system
 *  sound, or silence. Kept as data so this module needs no i18n import. */
export type SoundChannelLabel =
	| { kind: "builtin"; id: BuiltinSoundId }
	| { kind: "system" }
	| { kind: "silent" };

/** The twelve channels, in the order Android settings should list them. */
export const soundChannelSpecs = (): SoundChannelSpec[] => [
	...BUILTIN_SOUND_IDS.map(
		(id): SoundChannelSpec => ({
			id: sessionChannelId(id),
			label: { kind: "builtin", id },
			sound: bundledSoundFile(id),
		}),
	),
	{ id: sessionChannelId("default"), label: { kind: "system" } },
	{ id: sessionChannelId("none"), label: { kind: "silent" }, sound: null },
];

/**
 * Channel ids the app created in earlier versions and must delete at start,
 * given the ids `ensureAndroidSoundChannels` just created: the pre-sound
 * `default` channel always, and each DEFAULT-importance `sound.<v>` channel
 * only once its `alert.<v>` replacement exists. A replacement that failed to
 * create (a missing sound file) keeps its old channel, so the native remap
 * (which falls back to the wire id when the target is absent) still has a real
 * channel to post on rather than Expo's generic "Miscellaneous" fallback.
 *
 * A user's own edits to a `sound.*` channel (muted, vibration off) do not carry
 * over: Android offers no way to copy a channel's user-locked settings to a new
 * id. Accepted in ADR 0010 §9 "Channel migration".
 */
export const legacyChannelIds = (created: ReadonlySet<string>): string[] => {
	const values = [...BUILTIN_SOUND_IDS, "default", "none"] as const;
	return [
		LEGACY_ALERT_CHANNEL_ID,
		...values
			.filter((value) => created.has(sessionChannelId(value)))
			.map((value) => soundChannelId(value)),
	];
};

/** One row of `assets/notification-sounds/manifest.json`, written by
 *  `scripts/sounds/export-mobile.ts`. `source_sha256` is the core FLAC's sha
 *  from its catalog, which is what ties a bundled WAV to the computer's sound. */
export type SoundManifestEntry = {
	id: string;
	file: string;
	sha256: string;
	bytes: number;
	duration_s: number;
	channels: number;
	source_file: string;
	source_sha256: string;
};

export type SoundManifest = {
	schema: 1;
	default: string;
	sounds: SoundManifestEntry[];
};
