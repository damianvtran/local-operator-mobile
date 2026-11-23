import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAttachmentSheetHandoff,
	DISMISS_FALLBACK_MS,
} from "./attach-handoff";
import {
	ATTACH_STRANDED_MS,
	type AttachTicket,
	attachLocksWhilePicking,
	createAttachLatch,
} from "./attach-latch";

/**
 * QA round 1, Q2 (#248): a picker launched too early by the attach handoff's
 * fallback can be refused by UIKit. Its promise then never settles, and the
 * owner's `finally` never runs: Attach, Paste and Clear stayed disabled until
 * the composer remounted.
 *
 * Review round 2, R6 / QA Q3: a watchdog armed for EVERY pick released the
 * latch while expo-image-picker was still reading an already-picked image (it
 * dismisses first, then downloads and re-encodes), so Clear, a second pick and
 * web Enter ran against an image still in flight. The watchdog is now armed
 * only for a launch the handoff's fallback made — the one path that can strand.
 */
const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const OWNER_LATCH =
	/const endAttach = attachLatch\.begin\(\);[\s\S]*?finally \{\s*endAttach\(\);\s*\}/;

afterEach(() => vi.useRealTimers());

/** An owner whose attach runs through the real handoff, as the composer does. */
const owner = () => {
	let busy = false;
	const latch = createAttachLatch((next: boolean) => {
		busy = next;
	});
	const handoff = createAttachmentSheetHandoff(() => {});
	const ends: AttachTicket[] = [];
	const pick = () => {
		handoff.cancel();
		handoff.choose(() => {
			ends.push(latch.begin());
		}, "ios");
		handoff.hidden();
	};
	return { busy: () => busy, latch, handoff, ends, pick };
};

describe("the attach latch", () => {
	it("holds busy through a normal pick that settles after 3 s", () => {
		vi.useFakeTimers();
		const o = owner();
		o.pick();
		o.handoff.dismissed(); // onDismiss arrived: the normal path
		expect(o.busy()).toBe(true);
		// Browsing, then the post-dismiss download and re-encode.
		vi.advanceTimersByTime(ATTACH_STRANDED_MS * 10);
		expect(o.busy()).toBe(true);
		o.ends[0]?.();
		expect(o.busy()).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("releases a pick the fallback launched that never settles", () => {
		vi.useFakeTimers();
		const o = owner();
		o.pick();
		vi.advanceTimersByTime(DISMISS_FALLBACK_MS); // onDismiss lost
		expect(o.busy()).toBe(true);
		vi.advanceTimersByTime(ATTACH_STRANDED_MS - 1);
		expect(o.busy()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(o.busy()).toBe(false);
	});

	it("ends a fallback-launched pick that settles in time, with no timer left", () => {
		vi.useFakeTimers();
		const o = owner();
		o.pick();
		vi.advanceTimersByTime(DISMISS_FALLBACK_MS);
		o.ends[0]?.();
		expect(o.busy()).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	// QA round 2, Q4: a stale settle must not clear a newer pick's latch.
	it("lets a released pick's late settle leave a newer pick busy", () => {
		vi.useFakeTimers();
		const o = owner();
		o.pick();
		vi.advanceTimersByTime(DISMISS_FALLBACK_MS + ATTACH_STRANDED_MS);
		expect(o.busy()).toBe(false);
		o.pick();
		o.handoff.dismissed();
		expect(o.busy()).toBe(true);
		o.ends[0]?.(); // the first pick finally answers
		expect(o.busy()).toBe(true);
		o.ends[1]?.();
		expect(o.busy()).toBe(false);
		o.ends[1]?.(); // a second call is a no-op
		expect(o.busy()).toBe(false);
	});

	it.each([
		["Session", "./use-composer.ts"],
		["Home", "../home/home.tsx"],
	])(
		"%s's picker attach runs through the latch, and only its finally ends it",
		(_owner, path) => {
			expect(read(path)).toContain(
				'import { createAttachLatch } from "@/features/session/attach-latch";',
			);
			expect(read(path)).toContain(
				"const attachLatch = useRef(createAttachLatch(setAttaching)).current;",
			);
			expect(read(path)).toMatch(OWNER_LATCH);
		},
	);
});

/**
 * PR #354 review round 1, R1: the latch's watchdog covers only FALLBACK
 * launches, so a picker launched from the normal `onDismiss` that never
 * presents (and so never settles) left Attach, Paste and Clear disabled with no
 * message, on Session and Home. No timer can tell that pick from a reader
 * browsing, so native Attach stays pressable and its press abandons the pick.
 * (Team Bridge has no attaching latch: its Add image is never disabled by a
 * pick — `thread-screen.tsx` `onAttach={images ? openAttach : undefined}`.)
 */
describe("a pick that never settles (R1)", () => {
	it("is still busy after any wait: the watchdog does not cover onDismiss launches", () => {
		vi.useFakeTimers();
		const o = owner();
		o.pick();
		o.handoff.dismissed();
		vi.advanceTimersByTime(ATTACH_STRANDED_MS * 100);
		expect(o.busy()).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("is released by an Attach press, and a later pick then works", () => {
		vi.useFakeTimers();
		const o = owner();
		o.pick();
		o.handoff.dismissed(); // launched; the picker never presents
		o.latch.abandon(); // the reader pressed Attach
		expect(o.busy()).toBe(false);
		expect(o.ends[0]?.current()).toBe(false);
		o.pick();
		o.handoff.dismissed();
		expect(o.busy()).toBe(true);
		expect(o.ends[1]?.current()).toBe(true);
		o.ends[0]?.(); // the orphan finally answers: changes nothing
		expect(o.busy()).toBe(true);
		o.ends[1]?.();
		expect(o.busy()).toBe(false);
	});

	it("leaves a newer pick's busy alone when an older one settles", () => {
		const o = owner();
		const first = o.latch.begin();
		const second = o.latch.begin();
		expect(first.current()).toBe(false);
		first();
		expect(o.busy()).toBe(true);
		second();
		expect(o.busy()).toBe(false);
	});

	it("is a no-op to abandon with nothing in flight", () => {
		const o = owner();
		o.latch.abandon();
		expect(o.busy()).toBe(false);
		const pick = o.latch.begin();
		expect(pick.current()).toBe(true);
	});

	it("keeps Attach locked while picking on the web only", () => {
		expect(attachLocksWhilePicking("web")).toBe(true);
		expect(attachLocksWhilePicking("ios")).toBe(false);
		expect(attachLocksWhilePicking("android")).toBe(false);
	});

	it.each([
		["Session", "./use-composer.ts"],
		["Home", "../home/home.tsx"],
	])("%s drops a superseded pick's result and error", (_owner, path) => {
		const source = read(path);
		expect(source).toMatch(
			/await readImageFrom\(source\);[\s\S]{0,200}?if \(!endAttach\.current\(\)\) return;[\s\S]*?setImages/,
		);
		expect(source).toMatch(
			/\} catch \{\s*if \(!endAttach\.current\(\)\) return;/,
		);
	});

	it("wires the Attach press to abandon, on both owners, and locks Attach on the web only", () => {
		const composer = read("./components/composer.tsx");
		expect(composer).toContain(
			"const attachLocked = attaching && attachLocksWhilePicking(Platform.OS);",
		);
		expect(composer).toMatch(
			/accessibilityState=\{state\(\{ busy: attaching, disabled: attachLocked \}\)\}\s*disabled=\{attachLocked\}[\s\S]{0,240}?onPress=\{\(\) => \{\s*onAttachOpen\?\.\(\);/,
		);
		expect(read("../home/home.tsx")).toContain(
			"onAttachOpen={attachLatch.abandon}",
		);
		expect(read("../../../app/(app)/session/[id].tsx")).toContain(
			"onAttachOpen={composer.abandonAttach}",
		);
		expect(read("./use-composer.ts")).toContain(
			"abandonAttach: attachLatch.abandon,",
		);
	});
});
