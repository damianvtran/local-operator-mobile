import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttachmentDraft } from "./attachment-draft";
import {
	prepareTeamBridgeImage,
	type RawImage,
	releaseTeamBridgeSource,
} from "./attachment-source";

// Real production preparation/finally blocks; only the native module boundary
// is synthetic. This verifies resource callbacks, not a native/device build.
const native = vi.hoisted(() => ({
	manipulate: vi.fn(),
	deleted: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/testing/team-bridge-attachment-source", () => ({
	syntheticAttachmentSource: () => null,
}));
vi.mock("expo-image-manipulator", () => ({
	ImageManipulator: { manipulate: native.manipulate },
	SaveFormat: { PNG: "png", JPEG: "jpeg" },
}));
vi.mock("expo-file-system", () => ({
	File: class {
		readonly uri: string;
		constructor(uri: string) {
			this.uri = uri;
		}
		get exists() {
			return true;
		}
		delete() {
			native.deleted(this.uri);
		}
	},
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe("disposed draft native preparation settlement", () => {
	it.each(["success", "failure"] as const)(
		"releases source, rendered image, context and saved output after pending preparation %s",
		async (result) => {
			let finish!: () => void;
			const pending = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const renderedRelease = vi.fn();
			const contextRelease = vi.fn();
			const save = vi.fn(async () => {
				await pending;
				// A malformed saved output fails AFTER the temp output has been
				// removed, exercising the native nested finally blocks on both paths.
				return {
					uri: "file:///synthetic/converted.jpg",
					base64: result === "success" ? "/9j/AQ==" : "",
				};
			});
			const context = {
				resize: vi.fn(() => context),
				renderAsync: vi.fn(async () => ({
					saveAsync: save,
					release: renderedRelease,
				})),
				release: contextRelease,
			};
			native.manipulate.mockReturnValue(context);
			const raw: RawImage = {
				uri: "file:///synthetic/picked.jpg",
				width: 1,
				height: 1,
				isPng: false,
			};
			const upload = vi.fn(async () => ({ id: "never" }));
			const onChange = vi.fn();
			const release = vi.fn((source: unknown) => {
				void releaseTeamBridgeSource(source as RawImage);
			});
			const preparationError = vi.fn();
			const draft = createAttachmentDraft({
				maxCount: 4,
				prepare: (source) =>
					prepareTeamBridgeImage(source as RawImage).catch((error) => {
						preparationError(error);
						throw error;
					}),
				upload,
				discard: vi.fn(async () => undefined),
				releaseSource: release,
				onChange,
			});
			draft.add([raw]);
			await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
			draft.dispose();
			draft.dispose();
			const publications = onChange.mock.calls.length;
			// Let the source's fire-and-forget release settle before the saved
			// output: Vitest's simultaneous lazy-import mock resolution can fall
			// through to real Expo modules (no native host exists in this lane).
			await vi.waitFor(() =>
				expect(native.deleted).toHaveBeenCalledExactlyOnceWith(raw.uri),
			);
			finish();
			await vi.waitFor(() => expect(contextRelease).toHaveBeenCalledTimes(1));
			await Promise.resolve();
			expect(preparationError).toHaveBeenCalledTimes(
				result === "failure" ? 1 : 0,
			);
			expect(renderedRelease).toHaveBeenCalledTimes(1);
			expect(release).toHaveBeenCalledExactlyOnceWith(raw);
			expect(native.deleted.mock.calls).toEqual([
				[raw.uri],
				["file:///synthetic/converted.jpg"],
			]);
			expect(upload).not.toHaveBeenCalled();
			expect(onChange).toHaveBeenCalledTimes(publications);
			expect(draft.chips()).toEqual([]);
		},
	);
});
