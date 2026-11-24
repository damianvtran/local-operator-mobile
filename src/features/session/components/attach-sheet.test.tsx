import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraReadiness } from "@/features/session/attach-rule";
import { t } from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { CONTROL_DISABLED_INK } from "@/ui/variants";

/*
 * The add-image sheet's behaviour, rendered: which rows exist, what a press on
 * each does, and the camera's permission outcomes (`ready` closes and launches,
 * `denied` keeps the sheet open with Open Settings, `unavailable` says so). The
 * native primitives are thin stand-ins that record each control's `onPress` by
 * testID, because the decision under test is this component's, not the
 * renderer's; the rendered pixels are the PR's web-export frames.
 */

const host = vi.hoisted(() => ({
	os: "ios",
	presses: new Map<string, () => void>(),
	openSettings: vi.fn(async () => {}),
	announced: [] as string[],
	/** The last `exitInstantly` the Sheet was rendered with. */
	exitInstantly: undefined as boolean | undefined,
	disabled: new Map<string, boolean | undefined>(),
	/** Each Text's className by its text, for the disabled-ink check (D1). */
	textClass: new Map<string, string | undefined>(),
}));

vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return host.os;
		},
	},
	Linking: { openSettings: () => host.openSettings() },
	AccessibilityInfo: {
		announceForAccessibility: (message: string) => {
			host.announced.push(message);
		},
	},
	View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Text: ({
		children,
		className,
	}: {
		children?: ReactNode;
		className?: string;
	}) => {
		host.textClass.set(String(children), className);
		return <span>{children}</span>;
	},
	ActivityIndicator: () => <span>busy</span>,
	Pressable: ({
		children,
		onPress,
		testID,
		accessibilityLabel,
		disabled,
	}: {
		children?: ReactNode;
		onPress: () => void;
		testID: string;
		accessibilityLabel: string;
		disabled?: boolean;
	}) => {
		host.presses.set(testID, onPress);
		host.disabled.set(testID, disabled);
		return <div data-label={accessibilityLabel}>{children}</div>;
	},
}));
vi.mock("lucide-react-native", () => {
	const Glyph = () => <span />;
	return {
		Camera: Glyph,
		ClipboardPaste: Glyph,
		FolderOpen: Glyph,
		Images: Glyph,
	};
});
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
vi.mock("@/features/session/attach", () => ({
	prepareCamera: async () => "ready",
}));
vi.mock("@/ui/components", () => ({
	Sheet: ({
		visible,
		title,
		children,
		exitInstantly,
	}: {
		visible: boolean;
		title: string;
		children?: ReactNode;
		exitInstantly?: boolean;
	}) => {
		host.exitInstantly = exitInstantly;
		return visible ? (
			<section>
				<h2>{title}</h2>
				{children}
			</section>
		) : null;
	},
	Banner: ({
		message,
		action,
		testID,
	}: {
		message: string;
		action?: { label: string; onPress: () => void; testID: string };
		testID: string;
	}) => {
		if (action) host.presses.set(action.testID, action.onPress);
		return (
			<div data-testid={testID}>
				{message}
				{action ? <span>{action.label}</span> : null}
			</div>
		);
	},
}));

import { AttachSheet } from "./attach-sheet";

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const textOf = (node: Node): string => {
	const children = Array.from(node.childNodes ?? []);
	return children.length
		? children.map(textOf).join(" ")
		: (node.textContent ?? "");
};
const shown = () => textOf(dom.container as unknown as Node);

beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as unknown as HTMLElement);
	host.os = "ios";
	host.presses.clear();
	host.openSettings.mockClear();
	host.announced = [];
	host.textClass.clear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

const renderSheet = async (
	checkCamera: () => Promise<CameraReadiness>,
	visible = true,
	extra: Partial<ComponentProps<typeof AttachSheet>> = {},
) => {
	const onChoose = vi.fn();
	await act(async () =>
		root.render(
			<AttachSheet
				visible={visible}
				onClose={() => {}}
				onDismiss={() => {}}
				onChoose={onChoose}
				checkCamera={checkCamera}
				title="attach"
				{...extra}
			/>,
		),
	);
	return onChoose;
};
const press = (testID: string) =>
	act(async () => {
		const onPress = host.presses.get(testID);
		if (!onPress) throw new Error(`no control ${testID}`);
		onPress();
	});

describe("the add-image sheet", () => {
	it("lists Photo Library, Take Photo, Files and Paste image on native, in that order", async () => {
		await renderSheet(async () => "ready");
		const text = shown();
		const order = [
			"attach",
			t("mobile.composer_input.attach.library"),
			t("mobile.composer_input.attach.camera"),
			t("mobile.composer_input.attach.files"),
			t("mobile.composer_input.attach.paste"),
		].map((label) => text.indexOf(label));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	/* 2026-11-22 design consult: the relay carries images only, so the sheet says
	 * so — a "Files" row that greys out a PDF reads as broken. */
	it("says each row's real job: images from Files, and Paste Image", async () => {
		await renderSheet(async () => "ready");
		const text = shown();
		for (const label of [
			"Photo Library",
			"Take Photo",
			"Image from Files",
			"Paste Image",
		])
			expect(text).toContain(label);
		expect(text).not.toContain("Paste image");
	});

	it("offers no camera on the web build", async () => {
		host.os = "web";
		await renderSheet(async () => "ready");
		expect(shown()).not.toContain(t("mobile.composer_input.attach.camera"));
		expect(shown()).toContain(t("mobile.composer_input.attach.choose_image"));
	});

	it("hands a non-camera source straight to the composer", async () => {
		const check = vi.fn(async (): Promise<CameraReadiness> => "ready");
		const onChoose = await renderSheet(check);
		await press("attach-option-library");
		expect(onChoose).toHaveBeenCalledWith("library");
		expect(check).not.toHaveBeenCalled();
	});

	it("checks the camera first, then hands it over when it is ready", async () => {
		const onChoose = await renderSheet(async () => "ready");
		await press("attach-option-camera");
		expect(onChoose).toHaveBeenCalledWith("camera");
		expect(shown()).not.toContain(
			t("mobile.composer_input.attach.camera_denied"),
		);
	});

	it("stays open on a refusal and offers Open Settings, which opens the app's settings", async () => {
		const onChoose = await renderSheet(async () => "denied");
		await press("attach-option-camera");
		expect(onChoose).not.toHaveBeenCalled();
		expect(shown()).toContain(t("mobile.composer_input.attach.camera_denied"));
		expect(shown()).toContain(t("mobile.composer_input.attach.open_settings"));
		await press(CONTROL.attachCameraSettings);
		expect(host.openSettings).toHaveBeenCalledOnce();
	});

	it("says there is no camera, with no Settings action, when none is available", async () => {
		const onChoose = await renderSheet(async () => "unavailable");
		await press("attach-option-camera");
		expect(onChoose).not.toHaveBeenCalled();
		expect(shown()).toContain(
			t("mobile.composer_input.attach.camera_unavailable"),
		);
		expect(host.presses.has(CONTROL.attachCameraSettings)).toBe(false);
		expect(SURFACE.attachCameraNotice).toBe("attach-camera-notice");
	});

	it("drops a camera answer that arrives after the sheet was closed and reopened", async () => {
		let answer: (value: CameraReadiness) => void = () => {};
		const check = () =>
			new Promise<CameraReadiness>((resolve) => {
				answer = resolve;
			});
		const onChoose = await renderSheet(check);
		await press("attach-option-camera");
		await renderSheet(check, false);
		const reopened = await renderSheet(check, true);
		await act(async () => answer("ready"));
		expect(onChoose).not.toHaveBeenCalled();
		expect(reopened).not.toHaveBeenCalled();
	});

	/* TestFlight 1333: an animated close made iOS fire `onDismiss` from a
	 *  momentary dismissal while the sheet came back for its exit, and the
	 *  picker was taken down with it. A CHOICE closes with no exit on iOS; a
	 *  plain close keeps it; a reopen resets it. */
	it("marks a chosen row's close as instant on iOS only, and resets it on reopen", async () => {
		host.os = "ios";
		await renderSheet(async () => "ready");
		expect(host.exitInstantly).toBe(false);
		await press("attach-option-library");
		expect(host.exitInstantly).toBe(true);
		await renderSheet(async () => "ready", false);
		await renderSheet(async () => "ready", true);
		expect(host.exitInstantly).toBe(false);
		await press("attach-option-camera");
		expect(host.exitInstantly).toBe(true);
		host.os = "android";
		await renderSheet(async () => "ready", false);
		await renderSheet(async () => "ready", true);
		await press("attach-option-files");
		expect(host.exitInstantly).toBe(false);
	});

	it("disables Take Photo for the rest of the open once there is no camera", async () => {
		await renderSheet(async () => "unavailable");
		expect(host.disabled.get("attach-option-camera")).toBe(false);
		await press("attach-option-camera");
		expect(host.disabled.get("attach-option-camera")).toBe(true);
	});

	/* PR #278 round 1, R2/U3/Q2: a refusal the OS will ask about again. */
	it("says only that access wasn't allowed when the OS can still ask, and the next press asks again", async () => {
		const check = vi.fn(async (): Promise<CameraReadiness> => "refused");
		const onChoose = await renderSheet(check);
		await press("attach-option-camera");
		expect(onChoose).not.toHaveBeenCalled();
		expect(shown()).toContain(t("mobile.composer_input.attach.camera_refused"));
		expect(shown()).not.toContain(
			t("mobile.composer_input.attach.open_settings"),
		);
		expect(host.presses.has(CONTROL.attachCameraSettings)).toBe(false);
		await press("attach-option-camera");
		expect(check).toHaveBeenCalledTimes(2);
	});

	/* U2: iOS VoiceOver ignores live regions, so the notice is posted. */
	it("announces the camera notice to VoiceOver on iOS, and leaves Android to the live region", async () => {
		await renderSheet(async () => "denied");
		await press("attach-option-camera");
		expect(host.announced).toEqual([
			t("mobile.composer_input.attach.camera_denied"),
		]);
		await act(async () => root.unmount());
		root = createRoot(dom.container as unknown as HTMLElement);
		host.os = "android";
		host.announced = [];
		await renderSheet(async () => "denied");
		await press("attach-option-camera");
		expect(host.announced).toEqual([]);
	});

	/* U4: the epoch moves on close and on another row, not only on reopen. */
	it("drops a camera answer that arrives after the sheet was closed (no reopen)", async () => {
		let answer: (value: CameraReadiness) => void = () => {};
		const check = () =>
			new Promise<CameraReadiness>((resolve) => {
				answer = resolve;
			});
		const onChoose = await renderSheet(check);
		await press("attach-option-camera");
		const closed = await renderSheet(check, false);
		await act(async () => answer("ready"));
		expect(onChoose).not.toHaveBeenCalled();
		expect(closed).not.toHaveBeenCalled();
	});

	it("drops a late camera answer once the reader picked another row, so only that row launches", async () => {
		let answer: (value: CameraReadiness) => void = () => {};
		const onChoose = await renderSheet(
			() =>
				new Promise<CameraReadiness>((resolve) => {
					answer = resolve;
				}),
		);
		await press("attach-option-camera");
		await press("attach-option-files");
		await act(async () => answer("ready"));
		expect(onChoose.mock.calls).toEqual([["files"]]);
	});

	/* U5/D1: Team Bridge renders this sheet with its own rows and test IDs. */
	it("renders only a host's sources, under the host's test IDs", async () => {
		const onChoose = await renderSheet(async () => "ready", true, {
			sources: ["library", "camera", "paste"],
			optionId: (source) => `team-bridge-attach-source-${source}`,
		});
		expect(shown()).not.toContain(t("mobile.composer_input.attach.files"));
		expect(host.presses.has("team-bridge-attach-source-files")).toBe(false);
		await press("team-bridge-attach-source-camera");
		expect(onChoose).toHaveBeenCalledWith("camera");
	});

	/* PR #354 U3: a check that threw is not "no camera". */
	it("says the camera could not be opened, and keeps Take Photo live, when the check fails", async () => {
		const check = vi.fn(async (): Promise<CameraReadiness> => "failed");
		const onChoose = await renderSheet(check);
		await press("attach-option-camera");
		expect(onChoose).not.toHaveBeenCalled();
		expect(shown()).toContain(t("mobile.composer_input.attach.camera_error"));
		expect(shown()).not.toContain(
			t("mobile.composer_input.attach.camera_unavailable"),
		);
		expect(host.disabled.get("attach-option-camera")).toBe(false);
		await press("attach-option-camera");
		expect(check).toHaveBeenCalledTimes(2);
	});

	/* PR #354 D1/U3: a disabled row must not look like the live ones. */
	it("dims Take Photo with the kit's disabled ink once it is disabled", async () => {
		await renderSheet(async () => "unavailable");
		const camera = t("mobile.composer_input.attach.camera");
		const library = t("mobile.composer_input.attach.library");
		expect(host.textClass.get(camera)).toContain("text-ink");
		expect(host.textClass.get(camera)).not.toContain(CONTROL_DISABLED_INK);
		await press("attach-option-camera");
		expect(host.textClass.get(camera)).toContain(CONTROL_DISABLED_INK);
		expect(host.textClass.get(library)).not.toContain(CONTROL_DISABLED_INK);
	});

	/* PR #354 U4: the Android first-refusal notice names the next step. */
	it("tells the reader that tapping Take Photo again asks again", () => {
		expect(t("mobile.composer_input.attach.camera_refused")).toContain(
			t("mobile.composer_input.attach.camera"),
		);
	});
});
