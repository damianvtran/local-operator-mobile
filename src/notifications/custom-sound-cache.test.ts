import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type CachedSound,
	CustomSoundCache,
	customSoundStem,
	type PhoneSounds,
	type SoundCacheDisk,
	validNotificationWav,
} from "./custom-sound-cache";

const wav = new Uint8Array(
	readFileSync(
		new URL("../../assets/notification-sounds/soft_pulse.wav", import.meta.url),
	),
);
const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const sha = hash(wav);
const oldSha = (n: number) => n.toString(16).padEnd(64, "0");
const entry = (n: number, bytes = 100, valid = true): CachedSound => ({
	sha: oldSha(n),
	bytes,
	used: n,
	valid,
});

function rig(seed: CachedSound[] = []) {
	let rows = seed.map((e) => ({ ...e }));
	const events: string[] = [];
	let claims: Record<string, string[]> = {};
	let listing: PhoneSounds = {
		selected: "custom:selected",
		enabled: true,
		sounds: [
			{
				id: "custom:selected",
				builtin: false,
				sha256: sha,
				push_name: `${customSoundStem(sha)}.wav`,
				size_bytes: wav.length,
			},
		],
	};
	let audio: Uint8Array = wav;
	let failReport = 0;
	let reportCalls = 0;
	let failCommit = false;
	const reports: string[][] = [];
	const disk: SoundCacheDisk = {
		async inventory() {
			return rows.map((e) => ({ ...e }));
		},
		async touch(key, used) {
			events.push("touch");
			const row = rows.find((e) => e.sha === key);
			if (!row) throw Error("Missing cached row");
			row.used = used;
		},
		async commit(key, bytes, used) {
			events.push("commit");
			if (failCommit) throw Error("write failed");
			rows.push({ sha: key, bytes: bytes.length, used, valid: true });
		},
		async remove(key) {
			events.push(`remove:${key}`);
			rows = rows.filter((e) => e.sha !== key);
		},
		async claims() {
			return structuredClone(claims);
		},
		async claim(scope, shas) {
			claims[scope] = [...shas];
		},
	};
	const cache = new CustomSoundCache({
		scope: "computer-A",
		disk,
		now: () => 100,
		digest: async (bytes) => hash(bytes),
		relay: {
			async listing() {
				return listing;
			},
			async audio() {
				events.push("fetch");
				return audio;
			},
			async report(stems) {
				reportCalls++;
				events.push(`report:${stems.join(",")}`);
				if (failReport === reportCalls) throw Error("offline");
				reports.push(stems);
			},
		},
	});
	return {
		cache,
		events,
		reports,
		rows: () => rows,
		claims: () => claims,
		setListing: (value: PhoneSounds) => {
			listing = value;
		},
		setAudio: (bytes: Uint8Array) => {
			audio = bytes;
		},
		setClaims: (value: Record<string, string[]>) => {
			claims = value;
		},
		failReport: (call: number) => {
			failReport = call;
		},
		failCommit: () => {
			failCommit = true;
		},
	};
}

describe("custom-sound cache transaction", () => {
	it("reports the selected digest only after commit", async () => {
		const r = rig();
		await r.cache.sync();
		expect(r.events.indexOf("commit")).toBeLessThan(
			r.events.indexOf(`report:${customSoundStem(sha)}`),
		);
		expect(r.reports.at(-1)).toEqual([customSoundStem(sha)]);
	});
	it("keeps selected + four previous in LRU order; withdraws before removal", async () => {
		const r = rig([1, 2, 3, 4, 5].map((n) => entry(n)));
		await r.cache.sync();
		expect(r.rows().map((e) => e.sha)).not.toContain(oldSha(1));
		expect(r.rows()).toHaveLength(5);
		const withdrawal = r.events.findIndex(
			(e) =>
				e.startsWith("report:") &&
				e.includes(customSoundStem(oldSha(2))) &&
				!e.includes(customSoundStem(oldSha(1))),
		);
		expect(withdrawal).toBeLessThan(r.events.indexOf(`remove:${oldSha(1)}`));
	});
	it("enforces the 8MiB cap INCLUDING the incoming selected file", async () => {
		const r = rig([1, 2, 3, 4].map((n) => entry(n, 2 * 1024 * 1024)));
		await r.cache.sync();
		expect(r.rows().reduce((n, e) => n + e.bytes, 0)).toBeLessThanOrEqual(
			8 * 1024 * 1024,
		);
		expect(r.rows().some((e) => e.sha === sha)).toBe(true);
	});
	it("touches an existing selected sound and never evicts it", async () => {
		const r = rig([{ sha, bytes: wav.length, used: 1, valid: true }]);
		await r.cache.sync();
		expect(r.events).toContain("touch");
		expect(r.events).not.toContain("fetch");
		expect(r.rows()[0]?.used).toBe(100);
	});
	it("stops deletion if readiness withdrawal fails", async () => {
		const r = rig([1, 2, 3, 4, 5].map((n) => entry(n)));
		r.failReport(2);
		await expect(r.cache.sync()).rejects.toThrow("offline");
		expect(r.events.some((e) => e.startsWith("remove:"))).toBe(false);
		expect(r.events).not.toContain("commit");
		expect(r.claims()["computer-A"]).toContain(oldSha(1));
	});
	it("never advertises a failed native write", async () => {
		const r = rig();
		r.failCommit();
		await expect(r.cache.sync()).rejects.toThrow("write failed");
		expect(r.reports.flat()).not.toContain(customSoundStem(sha));
	});
	it("rejects a hash mismatch before native IO or final readiness", async () => {
		const r = rig();
		const bad = wav.slice();
		bad[44] = (bad[44] ?? 0) ^ 1;
		r.setAudio(bad);
		await expect(r.cache.sync()).rejects.toThrow("digest");
		expect(r.events).not.toContain("commit");
	});
	it("rejects >2MiB before native IO", async () => {
		const r = rig();
		r.setAudio(new Uint8Array(2 * 1024 * 1024 + 1));
		await expect(r.cache.sync()).rejects.toThrow();
		expect(r.events).not.toContain("commit");
	});
	it("rejects a path-like or mismatched push filename", async () => {
		const r = rig();
		r.setListing({
			selected: "x",
			enabled: true,
			sounds: [
				{
					id: "x",
					builtin: false,
					sha256: sha,
					push_name: "../evil.wav",
					size_bytes: wav.length,
				},
			],
		});
		await expect(r.cache.sync()).rejects.toThrow("name");
		expect(r.events).not.toContain("fetch");
	});
	it.each(["system", "soft-pulse", "disabled"])(
		"preserves backend %s semantics without fetching",
		async (mode) => {
			const r = rig();
			r.setListing({
				selected: mode,
				enabled: mode !== "disabled",
				sounds: [],
			});
			await r.cache.sync();
			expect(r.events).not.toContain("fetch");
			expect(r.rows()).toEqual([]);
		},
	);
	it("withdraws a disappeared file/channel before retrying it", async () => {
		const r = rig([{ sha, bytes: wav.length, used: 1, valid: false }]);
		await r.cache.sync();
		expect(r.reports[0]).toEqual([]);
		expect(r.events.indexOf(`remove:${sha}`)).toBeGreaterThan(
			r.events.indexOf("report:"),
		);
		expect(r.reports.at(-1)).toContain(customSoundStem(sha));
	});
	it("does not delete files still claimed by an offline previous computer", async () => {
		const r = rig([1, 2, 3, 4, 5].map((n) => entry(n)));
		r.setClaims({ "computer-B": [1, 2, 3, 4, 5].map(oldSha) });
		await expect(r.cache.sync()).rejects.toThrow("another computer");
		expect(r.events.some((e) => e.startsWith("remove:"))).toBe(false);
	});
	it("serializes simultaneous foreground/config/registration triggers", async () => {
		const r = rig();
		await Promise.all([r.cache.sync(), r.cache.sync(), r.cache.sync()]);
		expect(r.events.filter((e) => e === "commit")).toHaveLength(1);
	});
});

describe("untrusted PCM and naming", () => {
	it("accepts the actual exported built-in PCM fixture", () =>
		expect(validNotificationWav(wav)).toBe(true));
	it("rejects truncated RIFF, wrong length, non-PCM and empty data", () => {
		expect(validNotificationWav(wav.subarray(0, 43))).toBe(false);
		const bad = wav.slice();
		bad[20] = 3;
		expect(validNotificationWav(bad)).toBe(false);
		const length = wav.slice();
		length[4] = 0;
		expect(validNotificationWav(length)).toBe(false);
	});
	it("only accepts lowercase SHA256 digests and produces stable c_<sha16> names", () => {
		expect(customSoundStem(sha)).toBe(`c_${sha.slice(0, 16)}`);
		expect(() => customSoundStem("../../sound")).toThrow();
		expect(() => customSoundStem(sha.toUpperCase())).toThrow();
	});
});
