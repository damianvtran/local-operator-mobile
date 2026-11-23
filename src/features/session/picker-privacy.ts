import type { PromptImage } from "@/contracts";
import { sniffImageMime } from "./attach-rule";

const TRAILING_SLASHES = /\/+$/;

const ENCODED_SEPARATOR = /%2f|%5c|%00/i;
/** Expo57 iOS/Android return a COPY under cache/ImagePicker. Never delete an
 * arbitrary picker URI: Photos/content/remote files are not our storage to own.
 * Check raw segments before URL normalization can erase traversal evidence. */
export function isOwnedPickerCacheFile(uri: string, cacheUri: string): boolean {
	return isDirectChildOf(uri, cacheUri, "ImagePicker");
}

/** The same ownership test for a PASTED image: `expo-paste-input` writes the
 *  clipboard image to a file of its own, directly in the app's cache directory
 *  on Android and in `tmp/` on iOS (0.2.2 source), never under `ImagePicker/`.
 *  The roots are passed in (the caller reads them from expo-file-system) so the
 *  rule stays testable in Node. */
export function isOwnedPasteFile(uri: string, rootUris: string[]): boolean {
	const plain = withoutPrivatePrefix(uri);
	return rootUris.some((root) =>
		isDirectChildOf(plain, withoutPrivatePrefix(root), undefined),
	);
}

/** On a device expo-file-system spells the app container `file:///var/mobile/…`
 *  while `FileManager.temporaryDirectory` (what the paste module writes to) is
 *  `file:///private/var/mobile/…`: the same directory, two spellings. Compare
 *  both sides without the `/private` so the real-device spelling matches. */
const withoutPrivatePrefix = (uri: string): string =>
	uri.replace(/^file:\/\/\/private\/(var|tmp)\//, "file:///$1/");

function isDirectChildOf(
	uri: string,
	cacheUri: string,
	subdirectory: string | undefined,
): boolean {
	try {
		if (
			!uri.startsWith("file://") ||
			uri.includes("\\") ||
			ENCODED_SEPARATOR.test(uri)
		)
			return false;
		const segments = uri
			.slice("file://".length)
			.split("/")
			.map(decodeURIComponent);
		if (
			segments.some(
				(segment) =>
					segment === "." ||
					segment === ".." ||
					segment.includes("/") ||
					segment.includes("\\"),
			)
		)
			return false;
		const asset = new URL(uri);
		const cache = new URL(cacheUri);
		if (
			asset.protocol !== "file:" ||
			cache.protocol !== "file:" ||
			asset.host !== cache.host ||
			asset.search ||
			asset.hash ||
			asset.username ||
			asset.password
		)
			return false;
		const path = decodeURIComponent(asset.pathname);
		const root = decodeURIComponent(cache.pathname).replace(
			TRAILING_SLASHES,
			"",
		);
		const slash = path.lastIndexOf("/");
		return (
			path.slice(0, slash) ===
				(subdirectory === undefined ? root : `${root}/${subdirectory}`) &&
			path.slice(slash + 1).length > 0
		);
	} catch {
		return false;
	}
}

/** How long one `drain()` waits for in-flight pickers before giving up on them.
 * Long enough for a picker that is already closing to run its finally-removal
 * before the cache sweep; short enough that a held drain is a pause, not a
 * hang, on the startup admission it gates. */
export const PICKER_DRAIN_BOUND_MS = 3000;

/** Privacy cleanup waits for the system picker and its finally-removal. Late
 * selection results are refused after auth withdrawal, even if a screen survives.
 *
 * WHY THE DRAIN IS BOUNDED. Every native startup admission runs
 * `prepareOrdinaryPrivateStorage → clearNativePickerCache → drain()`, and the
 * cache sweep chains each later sweep behind the previous one. An unbounded
 * drain therefore turned ONE `launchImageLibraryAsync` that never settles
 * (iOS, #300 / TestFlight 1157) into a process-lifetime hang: admission never
 * returned, so `busy` stayed true, sends waited for a safe connection forever
 * and Team Bridge never initialised — a "Connecting to Mac…" splash under a
 * live chip that only a relaunch cleared (PR #327, review M1).
 *
 * WHY GIVING UP IS SAFE FOR PRIVACY. Abandoning an operation stops only the
 * WAITING, never the guarantees:
 * - a withdrawn (earlier-epoch) operation's late result is still refused by the
 *   epoch check in `run`, so no image crosses an owner change;
 * - every picker path ends in `consumePickerAsset`, whose `finally` deletes the
 *   operation's own cache copy whenever it does settle, so a late file is not
 *   left behind by the operation that wrote it;
 * - the directory sweep after the drain still runs, and so does the next
 *   admission's, catching a copy whose removal failed.
 * An abandoned operation is never awaited again, so one stuck picker costs at
 * most ONE bound per process rather than one per admission. A still-current
 * (same-owner) operation is not refused when abandoned: nothing about its owner
 * changed, and refusing would lose a reader's slow pick during a reconnect. */
export class PickerPrivacy {
	private closed = false;
	private epoch = 0;
	private readonly operations = new Set<Promise<unknown>>();
	private readonly abandoned = new WeakSet<Promise<unknown>>();
	private readonly drainBoundMs: number;
	constructor(drainBoundMs: number = PICKER_DRAIN_BOUND_MS) {
		this.drainBoundMs = drainBoundMs;
	}
	withdraw = (): void => {
		this.closed = true;
		this.epoch++;
	};
	reopen = (): void => {
		this.closed = false;
	};
	drain = async (): Promise<void> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const expired = new Promise<true>((resolve) => {
			timer = setTimeout(() => resolve(true), this.drainBoundMs);
		});
		try {
			// Re-read each pass: an operation started while draining is waited for
			// too, within the same bound.
			for (;;) {
				const waiting = [...this.operations].filter(
					(operation) => !this.abandoned.has(operation),
				);
				if (waiting.length === 0) return;
				const timedOut = await Promise.race([
					Promise.allSettled(waiting).then(() => false),
					expired,
				]);
				if (timedOut) {
					for (const operation of waiting) this.abandoned.add(operation);
					return;
				}
			}
		} finally {
			clearTimeout(timer);
		}
	};
	run<T>(operation: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
		if (this.closed)
			return Promise.reject(new Error("the image could not be read"));
		const epoch = this.epoch;
		const current = () => !this.closed && epoch === this.epoch;
		let selected: Promise<T>;
		try {
			selected = operation(current);
		} catch (error) {
			selected = Promise.reject(error);
		}
		const pending = selected.then((result) => {
			if (epoch !== this.epoch) throw new Error("the image could not be read");
			return result;
		});
		this.operations.add(pending);
		const settled = () => this.operations.delete(pending);
		void pending.then(settled, settled);
		return pending;
	}
}
export const pickerPrivacy = new PickerPrivacy();

export async function consumePickerAsset(
	asset:
		| { base64?: string | null; mimeType?: string | null; uri?: string }
		| undefined,
	remove: (uri: string | undefined) => Promise<void>,
): Promise<PromptImage> {
	try {
		if (typeof asset?.base64 !== "string" || asset.base64.length === 0)
			throw new Error("the image could not be read");
		return {
			data_b64: asset.base64,
			mime_type: sniffImageMime(asset.base64, asset.mimeType ?? ""),
		};
	} finally {
		// Cleanup is part of a successful attachment, not a detached best effort.
		// Reject if privacy cannot be verified; never log the URI or image bytes.
		await remove(asset?.uri);
	}
}
