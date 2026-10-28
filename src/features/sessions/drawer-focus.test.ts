import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
	cancelDrawerNewChat,
	finishDrawerDismiss,
	requestDrawerNewChat,
} from "./drawer-focus";

const root = resolve(import.meta.dirname, "../../..");
const trap = readFileSync(
	resolve(
		root,
		"node_modules/react-native-web/dist/exports/Modal/ModalFocusTrap.js",
	),
	"utf8",
);
const cleanup = trap.split("return function () {")[1]?.split("\n      };")[0];
if (!cleanup) throw new Error("installed modal focus cleanup changed");
const restore = runInNewContext(
	`(function(document, lastFocusedElementOutsideTrap, UIManager) { ${cleanup} })`,
) as (
	document: { contains: () => boolean },
	trigger: object,
	manager: { focus: (node: object) => void },
) => void;

describe("drawer New chat dismissal handoff", () => {
	it("installed web Modal fires onDismiss only after rendering stops", () => {
		const animation = readFileSync(
			resolve(
				root,
				"node_modules/react-native-web/dist/exports/Modal/ModalAnimation.js",
			),
			"utf8",
		);
		const effect = animation
			.split("if (wasRendering.current && !isRendering && onDismiss)")[1]
			?.split("}, [isRendering, onDismiss]")[0];
		if (!effect) throw new Error("installed dismissal effect changed");
		const run = runInNewContext(
			`(function(wasRendering,isRendering,onDismiss) { if (wasRendering.current && !isRendering && onDismiss) ${effect} })`,
		) as (
			state: { current: boolean },
			rendering: boolean,
			dismiss: () => void,
		) => void;
		const state = { current: true },
			dismissed = vi.fn();
		run(state, true, dismissed);
		expect(dismissed).not.toHaveBeenCalled();
		run(state, false, dismissed);
		expect(dismissed).toHaveBeenCalledOnce();
		run(state, false, dismissed);
		expect(dismissed).toHaveBeenCalledOnce();
	});
	it("reproduces installed modal restoration winning early focus, then focuses after dismissal", () => {
		const trigger = {},
			composer = {};
		let focused = trigger;
		const focusComposer = () => {
			focused = composer;
		};
		const restoreTrigger = () =>
			restore({ contains: () => true }, trigger, {
				focus: (node) => {
					focused = node;
				},
			});
		focusComposer();
		restoreTrigger();
		expect(focused).toBe(trigger);
		const intent = { current: false };
		requestDrawerNewChat("web", intent, restoreTrigger, focusComposer);
		expect(focused).toBe(trigger);
		finishDrawerDismiss(intent, focusComposer);
		expect(focused).toBe(composer);
	});
	it("consumes intent once, cancels other dismissals and retains no stale callback", () => {
		const intent = { current: false },
			old = vi.fn(),
			latest = vi.fn(),
			close = vi.fn();
		requestDrawerNewChat("web", intent, close, old);
		expect(close).toHaveBeenCalledOnce();
		expect(old).not.toHaveBeenCalled();
		finishDrawerDismiss(intent, latest);
		finishDrawerDismiss(intent, latest);
		expect(latest).toHaveBeenCalledOnce();
		requestDrawerNewChat("web", intent, close, old);
		cancelDrawerNewChat(intent); // escape/navigation/reopen/unmount/owner change
		finishDrawerDismiss(intent, latest);
		expect(latest).toHaveBeenCalledOnce();
		requestDrawerNewChat("web", intent, close, old);
		finishDrawerDismiss(intent, undefined);
		expect(intent.current).toBe(false);
		expect(old).not.toHaveBeenCalled();
	});
	it("survives a re-render between request and dismissal only with a stable owner", () => {
		// The drawer's `[onNewChat]` effect cancels the pending intent when the prop's
		// identity changes, and Home re-renders (`setPanelOpen(false)`) between the tap
		// and `onDismiss`. A closure rebuilt per render therefore cancels the request
		// the tap just made; a memoised one survives the same re-render.
		const close = vi.fn();

		const churned = { current: false };
		requestDrawerNewChat("web", churned, close, () => undefined); // inline: new f
		cancelDrawerNewChat(churned); // the [onNewChat] effect's cleanup, post-render
		const stale = vi.fn();
		finishDrawerDismiss(churned, stale);
		expect(stale).not.toHaveBeenCalled();

		const stable = vi.fn();
		const kept = { current: false };
		requestDrawerNewChat("web", kept, close, stable);
		// same identity across the re-render: the effect does not re-run
		finishDrawerDismiss(kept, stable);
		expect(stable).toHaveBeenCalledOnce();
	});
	it.each(["ios", "android"])(
		"keeps %s immediate native behavior without depending on onDismiss",
		(platform) => {
			const intent = { current: false },
				close = vi.fn(),
				focus = vi.fn();
			requestDrawerNewChat(platform, intent, close, focus);
			expect(focus).toHaveBeenCalledOnce();
			expect(close).not.toHaveBeenCalled();
			finishDrawerDismiss(intent, focus);
			expect(focus).toHaveBeenCalledOnce();
		},
	);
});
