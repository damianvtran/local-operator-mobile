/** Content-addressed phone sounds, not a second preference store.
 * The computer owns selection; cached entries describe only durable local bytes.
 * Readiness is withdrawn BEFORE eviction and published only AFTER the native
 * adapter has committed the file/channel. A failed withdrawal stops deletion:
 * an unreachable computer may still send a push naming the old channel.
 */
export const CUSTOM_SOUND_LIMIT = 8 * 1024 * 1024;
export const CUSTOM_SOUND_FILE_LIMIT = 2 * 1024 * 1024;
export const SHA256 = /^[a-f0-9]{64}$/;
export const customSoundStem = (sha: string): string => {
	if (!SHA256.test(sha)) throw new Error("Invalid sound digest");
	return `c_${sha.slice(0, 16)}`;
};
export type CachedSound = {
	sha: string;
	bytes: number;
	used: number;
	valid: boolean;
};
export type PhoneSound = {
	id: string;
	builtin: boolean;
	sha256: string | null;
	push_name: string | null;
	size_bytes: number | null;
};
export type PhoneSounds = {
	selected: string;
	enabled: boolean;
	sounds: PhoneSound[];
};

/** Adapters must implement commit/read atomically and validate persisted bytes
 * on inventory. Inventory excludes missing files/channels, including user-
 * deleted Android channels. Errors never become successful readiness reports. */
export interface SoundCacheDisk {
	inventory(): Promise<CachedSound[]>;
	commit(sha: string, bytes: Uint8Array, used: number): Promise<void>;
	touch(sha: string, used: number): Promise<void>;
	remove(sha: string): Promise<void>;
	claims(): Promise<Record<string, string[]>>;
	claim(scope: string, shas: string[]): Promise<void>;
}
export interface SoundCacheRelay {
	listing(): Promise<PhoneSounds>;
	audio(id: string, sha: string): Promise<Uint8Array>;
	report(stems: string[]): Promise<void>;
}
export interface SoundCacheDeps {
	scope: string;
	disk: SoundCacheDisk;
	relay: SoundCacheRelay;
	digest(bytes: Uint8Array): Promise<string>;
	now(): number;
}

/** One serialized owner per installation. Callers coalesce lifecycle triggers;
 * no file or readiness mutation may race another computer's eviction. */
export class CustomSoundCache {
	private tail: Promise<void> = Promise.resolve();
	private readonly deps: SoundCacheDeps;
	constructor(deps: SoundCacheDeps) {
		this.deps = deps;
	}
	sync(): Promise<void> {
		const next = this.tail.then(() => this.refresh());
		this.tail = next.catch(() => {});
		return next;
	}
	private async refresh(): Promise<void> {
		const { disk, relay, digest, now, scope } = this.deps;
		const listing = await relay.listing();
		const entries = await disk.inventory();
		// Repair remote readiness after a crash, channel deletion or lost file,
		// even when the new selection is a built-in or sound is disabled.
		const report = async (rows: CachedSound[]): Promise<void> => {
			const shas = rows.filter((e) => e.valid).map((e) => e.sha);
			// Persist conservative claims BEFORE advertising them. Only reduce
			// the claim after a successful remote withdrawal, so a crash or an
			// offline previous computer can never authorize a dangerous eviction.
			const previous = (await disk.claims())[scope] ?? [];
			await disk.claim(scope, [...new Set([...previous, ...shas])]);
			await relay.report(shas.map(customSoundStem));
			await disk.claim(scope, shas);
		};
		await report(entries);
		const selected = listing.enabled
			? listing.sounds.find(
					(sound) => sound.id === listing.selected && !sound.builtin,
				)
			: undefined;
		const selectedSha = selected?.sha256;
		if (!selected || !selectedSha || !SHA256.test(selectedSha)) return; // default/off remain backend semantics, never a local override.
		if (selected.push_name !== `${customSoundStem(selectedSha)}.wav`) {
			throw new Error("Sound name does not match digest");
		}
		if (entries.some((entry) => entry.sha === selectedSha && entry.valid)) {
			await disk.touch(selectedSha, now());
			return;
		}
		const bytes = await relay.audio(selected.id, selectedSha);
		if (
			!validNotificationWav(bytes) ||
			bytes.length > CUSTOM_SOUND_FILE_LIMIT ||
			bytes.length !== selected.size_bytes ||
			(await digest(bytes)) !== selectedSha
		) {
			throw new Error("Sound bytes do not match digest or size limit");
		}
		// At most selected + four previous sounds, and <=8 MiB INCLUDING
		// the incoming file. Evict oldest first, never the selected digest.
		const otherClaims = new Set(
			Object.entries(await disk.claims())
				.filter(([owner]) => owner !== scope)
				.flatMap(([, shas]) => shas),
		);
		entries.sort((a, b) => b.used - a.used);
		const protectedEntries = entries.filter((e) => otherClaims.has(e.sha));
		const keep = [...protectedEntries];
		let size = bytes.length + keep.reduce((n, e) => n + e.bytes, 0);
		if (
			keep.length > 4 ||
			size > CUSTOM_SOUND_LIMIT ||
			keep.some((e) => customSoundStem(e.sha) === customSoundStem(selectedSha))
		) {
			throw new Error("Cache protected by another computer's readiness");
		}
		for (const entry of entries) {
			if (
				!keep.includes(entry) &&
				entry.valid &&
				keep.length < 4 &&
				size + entry.bytes <= CUSTOM_SOUND_LIMIT &&
				customSoundStem(entry.sha) !== customSoundStem(selectedSha)
			) {
				keep.push(entry);
				size += entry.bytes;
			}
		}
		await report(keep);
		for (const entry of entries) {
			if (!keep.includes(entry)) await disk.remove(entry.sha);
		}
		await disk.commit(selectedSha, bytes, now());
		await report(await disk.inventory());
	}
}

/** C2 normalizes to PCM WAV <=10 seconds. Check that contract before native
 * publishing, even if a paired server accidentally returns other hashed bytes.
 * Chunk sizes are bounded by the actual buffer, including RIFF's odd padding. */
export function validNotificationWav(bytes: Uint8Array): boolean {
	if (bytes.length < 44) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (at: number) =>
		String.fromCharCode(...bytes.subarray(at, at + 4));
	if (
		tag(0) !== "RIFF" ||
		tag(8) !== "WAVE" ||
		view.getUint32(4, true) + 8 !== bytes.length
	)
		return false;
	let rate = 0;
	let align = 0;
	let pcmBytes = 0;
	for (let at = 12; at + 8 <= bytes.length; ) {
		const size = view.getUint32(at + 4, true);
		const start = at + 8;
		if (start + size > bytes.length) return false;
		if (tag(at) === "fmt ") {
			if (
				size < 16 ||
				view.getUint16(start, true) !== 1 ||
				view.getUint16(start + 14, true) !== 16
			)
				return false;
			const channels = view.getUint16(start + 2, true);
			rate = view.getUint32(start + 4, true);
			align = view.getUint16(start + 12, true);
			if (
				![1, 2].includes(channels) ||
				align !== channels * 2 ||
				rate < 8000 ||
				rate > 96000
			)
				return false;
		}
		if (tag(at) === "data") pcmBytes += size;
		at = start + size + (size % 2);
	}
	return (
		rate > 0 &&
		align > 0 &&
		pcmBytes > 0 &&
		pcmBytes % align === 0 &&
		pcmBytes / (rate * align) <= 10
	);
}
