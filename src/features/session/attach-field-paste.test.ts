import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { pastedImageUris, pasteTempRoots } from "./attach-rule";
import { isOwnedPasteFile } from "./picker-privacy";

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const cache =
	"file:///private/var/mobile/Containers/Data/Application/A1/Library/Caches/";
const tmp = "file:///private/var/mobile/Containers/Data/Application/A1/tmp/";

describe("pasting an image INTO the message field (Ben, 2026-11-22)", () => {
	it("takes the image URIs of an images payload and nothing else", () => {
		expect(
			pastedImageUris({
				type: "images",
				uris: ["file:///a.png", "file:///b.png"],
			}),
		).toEqual(["file:///a.png", "file:///b.png"]);
		// A text paste is the field's own; an unsupported one attaches nothing.
		expect(pastedImageUris({ type: "text", value: "hello" })).toEqual([]);
		expect(pastedImageUris({ type: "unsupported" })).toEqual([]);
		expect(
			pastedImageUris({ type: "images", uris: ["", "file:///a.png"] }),
		).toEqual(["file:///a.png"]);
	});

	it("derives iOS's tmp/ from the cache directory and keeps the cache directory for Android", () => {
		expect(pasteTempRoots(cache)).toEqual([cache, tmp.replace(/\/$/, "")]);
		// Android: no `Library/Caches` suffix, so only the cache directory itself.
		expect(pasteTempRoots("file:///data/user/0/app/cache/")).toEqual([
			"file:///data/user/0/app/cache/",
		]);
	});

	it("matches on a real device, where the cache URI is /var and tmp/ is /private/var", () => {
		// expo-file-system reports file:///var/mobile/… on hardware; the module's
		// FileManager.temporaryDirectory is file:///private/var/mobile/….
		const deviceCache =
			"file:///var/mobile/Containers/Data/Application/A1/Library/Caches/";
		const roots = pasteTempRoots(deviceCache);
		expect(isOwnedPasteFile(`${tmp}1730000000000-0.png`, roots)).toBe(true);
		expect(
			isOwnedPasteFile(
				"file:///var/mobile/Containers/Data/Application/A1/tmp/x.png",
				roots,
			),
		).toBe(true);
		// A different container is still refused.
		expect(
			isOwnedPasteFile(
				"file:///private/var/mobile/Containers/Data/Application/B2/tmp/x.png",
				roots,
			),
		).toBe(false);
	});

	it("owns only a file directly in the app's cache or tmp directory", () => {
		const roots = pasteTempRoots(cache);
		expect(isOwnedPasteFile(`${tmp}1730000000000-0.png`, roots)).toBe(true);
		expect(isOwnedPasteFile(`${cache}1730000000000-0.png`, roots)).toBe(true);
		for (const uri of [
			"content://photos/original",
			"file:///private/var/mobile/Media/DCIM/IMG_0001.HEIC",
			`${tmp}nested/a.png`,
			`${tmp}../Documents/a.png`,
			`${tmp}a.png?x=1`,
			`${cache}ImagePicker/a.png`,
		])
			expect(isOwnedPasteFile(uri, roots)).toBe(false);
	});
});

describe("how the field paste is wired", () => {
	it("wraps the message field's TextInput, only when a host asked for it", () => {
		const textarea = read("../../ui/components/textarea.tsx");
		expect(textarea).toContain(
			"<PasteImageField onPasteImages={onPasteImages}>",
		);
		const field = read("../../ui/components/paste-image-field.tsx");
		expect(field).toContain(
			'if (onPasteImages === undefined || Platform.OS === "web") return children;',
		);
		expect(field).toContain("pastedImageUris(payload)");
	});

	it("hands the composer's host the field's pasted URIs, on Home and in a session", () => {
		const composer = read("./components/composer.tsx");
		expect(composer).toContain("onPasteImages={onPasteImages}");
		expect(read("../home/home.tsx")).toContain("onPasteImages={pasteImages}");
		expect(read("../../../app/(app)/session/[id].tsx")).toContain(
			"onPasteImages={composer.pasteImages}",
		);
	});

	it("reads every pasted copy through the privacy gate and deletes each one, success or not", () => {
		const attach = read("./attach.ts");
		const body = attach.slice(attach.indexOf("export const readPastedImages"));
		expect(body).toContain("pickerPrivacy.run");
		// The deletion sits in a `finally`, so a failed read still removes its copy.
		expect(body).toMatch(/finally \{\s*try \{\s*await removePastedCopy\(uri\)/);
		// All-or-nothing: a failure anywhere refuses the whole paste.
		expect(body).toContain("if (failure !== undefined) throw failure;");
	});
});
