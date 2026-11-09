import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The web file picker's lifecycle (`pickOnWeb`, reached through
 * `pickImageFromLibrary` / `pickImageFromFiles` on the web target).
 *
 * Why this exists: the picker used to click a DETACHED file input, which no
 * automation or assistive tooling that looks inputs up in the document could
 * reach — QA could not attach an image to the compiled web build (PR #206 Q2).
 * These cases pin the fix's contract: the input is IN the document while the
 * chooser is open, it is gone after every way the pick can end, and a cancel
 * settles the promise (the composer clears `attaching` in its `finally`, so a
 * promise that never settles is a composer stuck "attaching" until reload).
 *
 * Unit tests run in Node (`vitest.config.ts`), and this repo has no jsdom, so
 * the document is a minimal stand-in: just the surface `pickOnWeb` touches,
 * built on Node's real `EventTarget` so listener semantics are the platform's.
 */

const host = vi.hoisted(() => ({
	os: "web" as string,
	pickFileAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return host.os;
		},
	},
}));
vi.mock("expo-file-system", () => ({
	File: { pickFileAsync: host.pickFileAsync },
}));
vi.mock("./picker-cache", () => ({ removePickedCacheCopy: vi.fn() }));
vi.mock("./picker-privacy", () => ({
	consumePickerAsset: vi.fn(),
	pickerPrivacy: { run: vi.fn() },
}));

import { pickImageFromFiles, pickImageFromLibrary } from "./attach";

class FakeInput extends EventTarget {
	type = "";
	accept = "";
	tabIndex = 0;
	files: File[] | null = null;
	style: Record<string, string> = {};
	attributes = new Map<string, string>();
	parent: FakeBody | null = null;
	clickImpl: () => void = () => {};
	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}
	click() {
		this.clickImpl();
	}
	remove() {
		this.parent?.children.delete(this);
		this.parent = null;
	}
}

class FakeBody {
	children = new Set<FakeInput>();
	appendChild(node: FakeInput) {
		node.parent = this;
		this.children.add(node);
		return node;
	}
}

let body: FakeBody;
let created: FakeInput[];
let readerFails: boolean;
/** Set before a pick to act on the input the moment the chooser "opens". */
let onOpen: (input: FakeInput) => void;
/** How many inputs the document held at each chooser open: the reachability
 *  half of every lifecycle case (a detached input records 0). */
let inDocumentAtOpen: number[];

class FakeFileReader extends EventTarget {
	result: string | null = null;
	readAsDataURL(_blob: Blob) {
		queueMicrotask(() => {
			if (readerFails) {
				this.dispatchEvent(new Event("error"));
				return;
			}
			this.result = "data:image/png;base64,AAAA";
			this.dispatchEvent(new Event("load"));
		});
	}
}

const inputsInDocument = () => [...body.children];

beforeEach(() => {
	host.os = "web";
	body = new FakeBody();
	created = [];
	readerFails = false;
	onOpen = () => {};
	inDocumentAtOpen = [];
	vi.stubGlobal("FileReader", FakeFileReader);
	vi.stubGlobal("document", {
		body,
		createElement: (tag: string) => {
			expect(tag).toBe("input");
			const input = new FakeInput();
			input.clickImpl = () => {
				inDocumentAtOpen.push(
					inputsInDocument().filter((n) => n === input).length,
				);
				onOpen(input);
			};
			created.push(input);
			return input;
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	host.pickFileAsync.mockReset();
});

const choose = (input: FakeInput, file: File | null) => {
	input.files = file === null ? [] : [file];
	input.dispatchEvent(new Event("change"));
};
const png = () =>
	new File([new Uint8Array([1])], "a.png", { type: "image/png" });

describe("the web file picker", () => {
	it("puts its input in the document while the chooser is open, hidden from sight and the a11y tree", async () => {
		let seenDuringPick: FakeInput[] = [];
		onOpen = (input) => {
			seenDuringPick = inputsInDocument();
			choose(input, png());
		};
		await expect(pickImageFromLibrary()).resolves.toEqual({
			data_b64: "AAAA",
			mime_type: "image/png",
		});
		expect(seenDuringPick).toHaveLength(1);
		const [input] = seenDuringPick;
		expect(input?.type).toBe("file");
		// Admission unchanged: images only, one file.
		expect(input?.accept).toBe("image/*");
		expect(input?.attributes.get("multiple")).toBeUndefined();
		expect(input?.attributes.get("aria-hidden")).toBe("true");
		expect(input?.tabIndex).toBe(-1);
		expect(input?.style.opacity).toBe("0");
		expect(inputsInDocument()).toHaveLength(0);
	});

	it("removes the input and settles null on cancel, so the composer's `attaching` clears", async () => {
		onOpen = (input) => input.dispatchEvent(new Event("cancel"));
		await expect(pickImageFromFiles()).resolves.toBeNull();
		expect(created).toHaveLength(1);
		expect(inDocumentAtOpen).toEqual([1]);
		expect(inputsInDocument()).toHaveLength(0);
	});

	it("removes the input when a change carries no file", async () => {
		onOpen = (input) => choose(input, null);
		await expect(pickImageFromLibrary()).resolves.toBeNull();
		expect(inDocumentAtOpen).toEqual([1]);
		expect(inputsInDocument()).toHaveLength(0);
	});

	it("removes the input and rejects when the chosen file cannot be read", async () => {
		readerFails = true;
		onOpen = (input) => choose(input, png());
		await expect(pickImageFromLibrary()).rejects.toThrow(
			"the image could not be read",
		);
		expect(inDocumentAtOpen).toEqual([1]);
		expect(inputsInDocument()).toHaveLength(0);
	});

	it("removes the input and rejects when the browser refuses to open the chooser", async () => {
		onOpen = () => {
			throw new Error("blocked");
		};
		await expect(pickImageFromLibrary()).rejects.toThrow("blocked");
		expect(inDocumentAtOpen).toEqual([1]);
		expect(inputsInDocument()).toHaveLength(0);
	});

	it("leaves no stale input across repeated picks, and a late event on an old input is inert", async () => {
		onOpen = (input) => input.dispatchEvent(new Event("cancel"));
		await pickImageFromFiles();
		onOpen = (input) => choose(input, png());
		await pickImageFromLibrary();
		onOpen = (input) => input.dispatchEvent(new Event("cancel"));
		await pickImageFromFiles();
		expect(created).toHaveLength(3);
		expect(inDocumentAtOpen).toEqual([1, 1, 1]);
		expect(inputsInDocument()).toHaveLength(0);
		// Listeners went with the input: a stray event cannot re-enter a settled pick.
		created[0]?.dispatchEvent(new Event("change"));
		expect(inputsInDocument()).toHaveLength(0);
	});
});

describe("the native document picker", () => {
	it("still goes through expo-file-system and never touches the document", async () => {
		host.os = "ios";
		host.pickFileAsync.mockResolvedValue({
			canceled: false,
			result: { base64: async () => "QkJC", type: "image/png" },
		});
		await expect(pickImageFromFiles()).resolves.toEqual({
			data_b64: "QkJC",
			mime_type: "image/png",
		});
		expect(host.pickFileAsync).toHaveBeenCalledWith({ mimeTypes: ["image/*"] });
		expect(created).toHaveLength(0);

		host.pickFileAsync.mockResolvedValue({ canceled: true, result: null });
		await expect(pickImageFromFiles()).resolves.toBeNull();
		expect(created).toHaveLength(0);
	});
});
