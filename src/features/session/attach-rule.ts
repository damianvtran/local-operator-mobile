import type { PromptImage } from "@/contracts";
import { t } from "@/i18n";

/*
 * The attach path's rules, in a module with no `react-native` import.
 *
 * Split out of `attach.ts` for the reason `vitest.config.ts` states: unit tests run
 * in Node, and anything a test touches must be free of `react-native`, which Node
 * cannot parse (it is Flow). The pickers stay beside the platform they need, and
 * the decisions — which sources a platform offers, which MIME type a payload
 * really is — live here, where a test can drive them.
 */

/** The MIME type in a `data:` URL's header. Hoisted so it compiles once. */
const DATA_URL_TYPE = /^data:([^;,]+)/;

/**
 * Split a `data:` URL into the wire's two fields.
 *
 * Exported because it is the one piece of this module with a rule to get wrong:
 * the MIME type comes from the URL's own header when it has one, and only falls
 * back to the file's reported type — a browser reports `""` for some images, and
 * the relay needs a real type to forward the attachment to a model.
 */
export const fromDataUrl = (url: string, reportedType: string): PromptImage => {
	const comma = url.indexOf(",");
	const header = comma >= 0 ? url.slice(0, comma) : "";
	const data = comma >= 0 ? url.slice(comma + 1) : url;
	const headerType = DATA_URL_TYPE.exec(header)?.[1] ?? "";
	const mime = headerType || reportedType || "image/jpeg";
	return { data_b64: data, mime_type: mime };
};

/** Base64 prefixes of the file headers: PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`,
 *  GIF87a/GIF89a. A table at module scope so `sniffImageMime` reads data and
 *  nothing else — the same shape the contract's own sniffing implies. */
const IMAGE_MAGIC: ReadonlyArray<readonly [string, string]> = [
	["iVBOR", "image/png"],
	["/9j/", "image/jpeg"],
	["R0lGOD", "image/gif"],
];

/**
 * The MIME type a base64 payload REALLY is, from its own magic prefix.
 *
 * This exists because `expo-image-picker`'s `base64` field is not the picked
 * file's bytes: its iOS implementation re-encodes anything that is not JPEG into
 * JPEG before base64-encoding (`readJpegBase64From` — "base64 output is always
 * JPEG regardless of the source file's original format", its own comment, read at
 * 57.0.20), while `mimeType` still reports the SOURCE asset's type. Taking
 * `mimeType` at face value therefore labels JPEG bytes `image/heic` (or
 * `image/png`) — and that label is what this client shows on the chip and
 * declares on the wire.
 *
 * The relay does not read that declared label: `server.py`'s `image_blocks`
 * decides the format by CONTENT ("the client's declared `mime_type` is
 * deliberately NOT read … the wire mime comes back from the bound") and drops an
 * entry whose bytes it does not recognise. The sniff here is the same judgement
 * made at the client edge, so the declared type is true to the bytes it describes
 * instead of whatever the picker's metadata claimed. The set is deliberately
 * small — the formats these pickers and clipboards actually produce — and
 * everything else falls back to the reported type (when it is an image type) or
 * JPEG.
 */
export const sniffImageMime = (dataB64: string, reported: string): string => {
	for (const [prefix, mime] of IMAGE_MAGIC) {
		if (dataB64.startsWith(prefix)) return mime;
	}
	return reported.startsWith("image/") ? reported : "image/jpeg";
};

/* ------------------------------------------------------------ the sources */

/**
 * Where an attachment comes from. The attach sheet's rows are these, and the
 * composer's one chip strip is where every one of them lands — the sources differ,
 * the attached image does not. `camera` joined the set with the camera-capture
 * feature: it produces the same `{ data_b64, mime_type }` a picked photo does,
 * through the same picker plumbing (`attach.ts`).
 */
export type AttachSource = "library" | "camera" | "files" | "paste";

/**
 * Which door a `"paste"` came through: the attach sheet's Paste row, or the
 * composer's clipboard-image chip (`attach-clipboard.ts`). The read is the same;
 * only what an empty answer MEANS differs (`pasteNothingLine` in `composer.ts`).
 */
export type PasteVia = "sheet" | "offer";

/** One row of the attach sheet. */
export interface AttachAction {
	readonly source: AttachSource;
	/** The row's visible label, which is also its accessible name. Catalogue
	 *  copy (`mobile.composer_input.attach.*`): `Photo Library` and `Files` are
	 *  spelled the way the system UI each row opens names itself, so the reader
	 *  recognises where the tap leads. Read at call time, never cached at module
	 *  scope, so a language change re-labels an open sheet's next render. */
	readonly label: string;
}

/**
 * The rows the attach sheet shows, per build kind.
 *
 * The split is what each platform's chooser MEANS, not a cosmetic difference:
 * on iOS/Android `library` is the system photo picker (screenshots and photos),
 * `camera` is the system camera UI for one new photo, `files` is the document
 * picker the attach control has used since the session view landed, and `paste`
 * reads the clipboard through the platform's own image channel. On the web build
 * there is no photo library, no document picker and no camera this app can
 * drive — the browser's file input is the one chooser — so its sheet collapses
 * to `Choose Image` and `Paste Image`. Every row lands in the same attachment
 * strip, with the same removal and the same send path (docs/ux/flows.md § 6).
 *
 * **Order.** Photo Library first (the common case: a screenshot or a recent
 * photo), Camera second (the other "picture" source, and the one the operator
 * asked for), then the two less frequent doors. iMessage, WhatsApp and the
 * ChatGPT app order their attach menus the same way.
 */
export const attachActions = (
	kind: "web" | "native",
): readonly AttachAction[] =>
	kind === "web"
		? [
				{
					source: "library",
					label: t("mobile.composer_input.attach.choose_image"),
				},
				{ source: "paste", label: t("mobile.composer_input.attach.paste") },
			]
		: [
				{ source: "library", label: t("mobile.composer_input.attach.library") },
				{ source: "camera", label: t("mobile.composer_input.attach.camera") },
				{ source: "files", label: t("mobile.composer_input.attach.files") },
				{ source: "paste", label: t("mobile.composer_input.attach.paste") },
			];

/* ------------------------------------------------------------- the camera */

/**
 * The slice of `expo-image-picker`'s permission response the camera row reads.
 * Typed here so the decision runs in Node (this module's reason to exist).
 */
export interface CameraPermissionState {
	readonly granted: boolean;
	readonly canAskAgain: boolean;
}

/**
 * What a press on the Camera row may do next.
 *
 * - `ready` — the camera may open now.
 * - `denied` — the reader has refused, and the OS will not show its prompt again
 *   (iOS after the first "Don't Allow"; Android after the second refusal or
 *   "Don't ask again"). The only way back is the app's page in Settings, so the
 *   sheet stays open and says so with an Open Settings action instead of a
 *   press that silently does nothing.
 * - `refused` — the reader just said no to the OS prompt, but the OS WILL ask
 *   again on the next press (Android after a first "Don't allow":
 *   `canAskAgain` stays true). Sending them to Settings would be wrong — a
 *   second press re-prompts — so the sheet says only that access wasn't
 *   allowed, with no Settings detour (PR #278 round 1, R2/U3/Q2).
 * - `unavailable` — there is no camera to open (the iOS simulator; a device or
 *   emulator with no camera app). Said, never crashed into.
 */
export type CameraReadiness = "ready" | "refused" | "denied" | "unavailable";

/**
 * Whether to raise the OS prompt, given what the OS already knows.
 *
 * `prompt` is the one arm that shows a system dialog, and it is only ever
 * reached from the reader's own press on Camera — never at launch, never from
 * the sheet opening — because a permission asked for out of context is the one
 * most often refused (Apple HIG, "Requesting permission").
 */
export const cameraPermissionStep = (
	state: CameraPermissionState,
): "granted" | "prompt" | "denied" =>
	state.granted ? "granted" : state.canAskAgain ? "prompt" : "denied";

/**
 * What the reader's answer to the OS prompt means for the sheet.
 *
 * WHY `canAskAgain` IS READ HERE: iOS never re-asks after "Don't Allow", so a
 * refusal there is final and only Settings can undo it (`denied`). Android
 * keeps `canAskAgain: true` after a first refusal and shows the prompt again on
 * the next request, so the same refusal there is `refused`: no Settings, and
 * the next press on Take Photo simply asks again.
 */
export const cameraAnswer = (
	asked: CameraPermissionState,
): Exclude<CameraReadiness, "unavailable"> =>
	asked.granted ? "ready" : asked.canAskAgain ? "refused" : "denied";

/**
 * Whether this process runs in the iOS Simulator, read from its sandbox path.
 *
 * WHY A PATH: the simulator has no camera, and `expo-image-picker` 57 does not
 * check `UIImagePickerController.isSourceTypeAvailable(.camera)` before setting
 * `sourceType = .camera` (read in `ImagePickerModule.swift`,
 * `launchLegacyImagePicker`, at 57.0.20). UIKit answers that with an Objective-C
 * `NSInvalidArgumentException`, which no JavaScript `catch` can intercept — the
 * app would crash. Nothing installed exposes a simulator flag (`expo-constants`
 * 57 dropped `isDevice`; `expo-device` is not a dependency), but every simulator
 * app's sandbox lives under `…/Library/Developer/CoreSimulator/Devices/<UDID>/`
 * on the host Mac, a path a physical iPhone's `/var/mobile/Containers/…` sandbox
 * can never contain. Every iPhone and iPad has a camera, so the simulator is the
 * one iOS environment this guard must catch.
 */
export const isIosSimulatorSandbox = (documentUri: string): boolean =>
	documentUri.includes("/CoreSimulator/Devices/");

/* --------------------------------------------------- the native clipboard */

/**
 * The slice of `expo-clipboard` the native paste path reads. Typed here, not
 * imported, so the rules below run in Node (this module's whole reason to
 * exist) and a test can hand in a fake clipboard instead of a device.
 */
export interface ClipboardImageSource {
	getImageAsync(options: { format: "png" }): Promise<{ data: string } | null>;
	hasImageAsync(): Promise<boolean>;
}

/**
 * Read the clipboard's image onto the wire form, or `null` when there is none.
 *
 * `null` covers two outcomes the platform does not let us tell apart: an empty
 * clipboard, and an iOS 16+ "Don't Allow" on the system paste prompt (both make
 * `getImageAsync` answer `null`). The caller says `pasteEmpty` for either, which
 * names only the outcome. A READ that fails throws, so the caller can say
 * `attachError` instead of pretending nothing was there.
 *
 * PNG, deliberately: the pasteboard's dominant case is a screenshot, and a
 * screenshot IS a PNG — asking for PNG re-encodes losslessly, where JPEG would
 * quantise small text. `data` is a full data URL, so the type comes from the
 * header the platform itself wrote.
 */
export const readClipboardImage = async (
	clipboard: Pick<ClipboardImageSource, "getImageAsync">,
): Promise<PromptImage | null> => {
	const image = await clipboard.getImageAsync({ format: "png" });
	return image === null ? null : fromDataUrl(image.data, "image/png");
};

/**
 * Whether the clipboard holds an image, WITHOUT reading it.
 *
 * This is what lets the composer offer a paste the moment it is useful: iOS
 * answers `hasImages` without the "Allow Paste" prompt (only reading the bytes
 * prompts), so probing on focus costs the reader nothing. A probe that fails is
 * "no offer" — the attach sheet's Paste row is still there — never an error
 * line about a clipboard the reader did not ask us to touch.
 */
export const probeClipboardImage = async (
	clipboard: Pick<ClipboardImageSource, "hasImageAsync">,
): Promise<boolean> => {
	try {
		return (await clipboard.hasImageAsync()) === true;
	} catch {
		return false;
	}
};

/**
 * Whether the reader is COMPOSING, for the paste offer: the field has focus, or
 * the card is open with a draft or an attachment.
 *
 * Focus alone hid the chip after the first image (TestFlight 753: "I still
 * can't paste more than one image"). The reader put the keyboard away to reach
 * the controls, which blurs the field, and the chip went with it while the next
 * image was still on the clipboard. A draft or an attachment keeps the card
 * open (`composerPresentation`), and that card is still being composed. The
 * offer still only PROBES the clipboard (`hasImageAsync`); bytes are read on
 * tap, never polled.
 */
export const pasteOfferComposing = (input: {
	focused: boolean;
	draft: string;
	attachments: number;
}): boolean => input.focused || input.draft.length > 0 || input.attachments > 0;

/**
 * Whether the composer shows its "Paste image" chip.
 *
 * Why a chip exists at all: a React Native `TextInput` on iOS/Android never
 * hands a pasted IMAGE to JavaScript — the system menu's Paste inserts text or
 * nothing — so the gesture a reader reaches for first (long-press → Paste)
 * silently drops their screenshot. The relay's web composer gets the image from
 * the browser's paste event; the native build's equivalent is to notice the
 * image on the clipboard while the reader is writing and offer it in one tap.
 *
 * Native only (the web build listens for the real paste event), only while the
 * field is focused (the reader is composing), and hidden once that clipboard
 * image has been taken (`consumed`) so a second tap cannot attach the same
 * screenshot twice by reflex; a clipboard change or a fresh focus re-offers it.
 */
export const pasteOfferVisible = (input: {
	kind: "web" | "native";
	focused: boolean;
	hasImage: boolean;
	consumed: boolean;
}): boolean =>
	input.kind === "native" && input.focused && input.hasImage && !input.consumed;
