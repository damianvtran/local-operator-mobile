import type { PromptImage } from "@/contracts";
import { sniffImageMime } from "./attach-rule";

const TRAILING_SLASHES = /\/+$/;

const ENCODED_SEPARATOR = /%2f|%5c|%00/i;
/** Expo57 iOS/Android return a COPY under cache/ImagePicker. Never delete an
 * arbitrary picker URI: Photos/content/remote files are not our storage to own.
 * Check raw segments before URL normalization can erase traversal evidence. */
export function isOwnedPickerCacheFile(uri: string, cacheUri: string): boolean {
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
			path.slice(0, slash) === `${root}/ImagePicker` &&
			path.slice(slash + 1).length > 0
		);
	} catch {
		return false;
	}
}

/** Privacy cleanup waits for the system picker and its finally-removal. Late
 * selection results are refused after auth withdrawal, even if a screen survives. */
export class PickerPrivacy {
	private closed = false;
	private epoch = 0;
	private readonly operations = new Set<Promise<unknown>>();
	withdraw = (): void => {
		this.closed = true;
		this.epoch++;
	};
	reopen = (): void => {
		this.closed = false;
	};
	drain = async (): Promise<void> => {
		while (this.operations.size) await Promise.allSettled([...this.operations]);
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
