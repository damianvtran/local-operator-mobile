import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	BUILTIN_SOUND_IDS,
	DEVICE_SESSION_CHANNEL_PREFIX,
	LEGACY_ALERT_CHANNEL_ID,
	legacyChannelIds,
	sessionChannelId,
	soundChannelId,
	soundChannelSpecs,
	WIRE_SESSION_CHANNEL_PREFIX,
} from "@/notifications/sound-catalog";

/**
 * The session channel migration (ADR 0010 S4, §7 row 4): the JS side creates
 * HIGH `alert.<v>` channels and deletes `sound.<v>`; the native presentation
 * delegate rewrites the cloud's `sound.<v>` to `alert.<v>`. Both halves must
 * agree on the two prefixes, so the Kotlin constants are read from source here.
 */
const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
const kotlin = readFileSync(
	join(
		root,
		"modules/lop-team-bridge-push/android/src/main/java/dev/localoperator/teambridge/SessionChannels.kt",
	),
	"utf8",
);

describe("session channel ids", () => {
	it("the native remap uses the same two prefixes as the catalogue", () => {
		expect(kotlin).toContain(
			`const val WIRE_PREFIX = "${WIRE_SESSION_CHANNEL_PREFIX}"`,
		);
		expect(kotlin).toContain(
			`const val DEVICE_PREFIX = "${DEVICE_SESSION_CHANNEL_PREFIX}"`,
		);
	});

	it("wire ids are unchanged (no cloud change) and device ids differ", () => {
		expect(soundChannelId("soft-pulse")).toBe("sound.soft-pulse");
		expect(sessionChannelId("soft-pulse")).toBe("alert.soft-pulse");
		// Every device channel is exactly the remap of one wire id the cloud can
		// send, so no session push lands on a channel the app did not create.
		const wire = [...BUILTIN_SOUND_IDS, "default", "none"] as const;
		expect(soundChannelSpecs().map((spec) => spec.id)).toEqual(
			wire.map((value) =>
				soundChannelId(value).replace(
					WIRE_SESSION_CHANNEL_PREFIX,
					DEVICE_SESSION_CHANNEL_PREFIX,
				),
			),
		);
	});

	it("deletes every legacy channel whose replacement exists, plus the pre-sound one", () => {
		const created = new Set(soundChannelSpecs().map((spec) => spec.id));
		expect(legacyChannelIds(created)).toEqual([
			LEGACY_ALERT_CHANNEL_ID,
			...BUILTIN_SOUND_IDS.map((id) => `sound.${id}`),
			"sound.default",
			"sound.none",
		]);
	});

	it("keeps a legacy channel whose replacement failed, so its pushes still have a channel", () => {
		const created = new Set(
			soundChannelSpecs()
				.map((spec) => spec.id)
				.filter((id) => id !== "alert.none"),
		);
		const deleted = legacyChannelIds(created);
		expect(deleted).not.toContain("sound.none");
		expect(deleted).toContain("sound.default");
	});

	it("with nothing created deletes only the pre-sound channel", () => {
		expect(legacyChannelIds(new Set())).toEqual([LEGACY_ALERT_CHANNEL_ID]);
	});
});
