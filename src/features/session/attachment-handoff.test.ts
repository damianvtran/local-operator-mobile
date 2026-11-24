import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attachHandoffDiagnostics,
	createAttachmentSheetHandoff,
	DISMISS_FALLBACK_MS,
} from "./attach-handoff";

const OWNER_ATTACH_FINALLY = /finally\s*\{\s*endAttach\(\);/;
/* The owner's `onAttachOpen` (abandon a pick in flight, PR #354 R1) may run
 *  first; cancel must still come immediately before the reopen. */
const CANCEL_BEFORE_REOPEN =
	/onPress=\{\(\) => \{\s*(?:onAttachOpen\?\.\(\);\s*)?attachmentHandoff\.cancel\(\);\s*setAttachSheetOpen\(true\);/;
/* A chosen row marks the close as a hand-off in the SAME update that closes
 * the sheet, so the iOS sheet closes in one commit (`Sheet`'s `exitInstantly`;
 * the native timing is run in `ui/components/sheet-ios-picker-handoff.test.tsx`). */
const SHEET_HANDOFF_CLOSE = /setHandingOff\(true\);\s*onChoose\(source\);/;
const COMPOSER_CHOOSE =
	/setAttachSheetOpen\(false\);[\s\S]*?attachmentHandoff\.choose\(\(\) => onAttach\(source\), Platform\.OS\);/;
const BRIDGE_CHOOSE =
	/setAttachOpen\(false\);\s*attachHandoff\.choose\(\(\) => \{\s*void addImages\(source\);\s*\}, Platform\.OS\);/;
const BRIDGE_CANCEL_BEFORE_REOPEN =
	/attachHandoff\.cancel\(\);\s*setAttachOpen\(true\);/;
const BRIDGE_DIRECT_LAUNCH =
	/onPress=\{\(\) => \{\s*void addImages\(source\);\s*\}\}/;
const HOME_DISMISS_SHOWN_LINE =
	/onDismissError=\{\s*startup\.snapshot\.error == null && composerError !== null\s*\? \(\) => setComposerError\(null\)\s*: undefined\s*\}/;
const TRAIL_TAIL = /onDismiss 14ms, fallback 1000ms, late onDismiss 1180ms$/;
const TRAIL_BOUNDED = /^(onDismiss 0ms, ){19}onDismiss 0ms$/;
const source = readFileSync(
	new URL("./components/composer.tsx", import.meta.url),
	"utf8",
);
const create = () => createAttachmentSheetHandoff();
const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
afterEach(() => vi.useRealTimers());
describe("native attachment sheet handoff", () => {
	it.each(["Home", "Session"])(
		"pending unmount cannot strand %s owner busy after dropping optional U1",
		(ownerName) => {
			vi.useFakeTimers();
			const owner = { busy: false };
			const launch = vi.fn(() => {
				owner.busy = true;
			});
			const handoff = create();
			handoff.choose(launch, "ios");
			// Home's split/column switch retains owner state while remounting its
			// Composer. Model that boundary with the REAL handoff's unmount cancel.
			handoff.cancel();
			const remounted = create();
			vi.runAllTimers();
			remounted.dismissed();
			expect(launch).not.toHaveBeenCalled();
			expect(owner.busy).toBe(false);
			const ownerPath =
				ownerName === "Home" ? "../home/home.tsx" : "./use-composer.ts";
			const ownerSource = readFileSync(
				new URL(ownerPath, import.meta.url),
				"utf8",
			);
			expect(ownerSource).not.toContain("onAttachStart");
			expect(ownerSource).not.toContain("beginAttach");
			expect(ownerSource).toMatch(OWNER_ATTACH_FINALLY);
			expect(source).not.toContain("onAccepted");
			expect(source).not.toContain("onAttachStart");
			const session = readFileSync(
				new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
				"utf8",
			);
			expect(session).not.toContain("onAttachStart");
		},
	);
	it("cancel after a launch cannot clear an owner's running attach before finally", () => {
		vi.useFakeTimers();
		let busy = false;
		const handoff = create();
		const launch = vi.fn(() => {
			busy = true;
		});
		handoff.choose(launch, "ios");
		handoff.dismissed();
		expect(launch).toHaveBeenCalledOnce();
		expect(busy).toBe(true);
		handoff.cancel();
		handoff.dismissed();
		vi.runAllTimers();
		expect(busy).toBe(true);
		// Only the running owner's unchanged finally ends its busy state.
		busy = false;
		expect(busy).toBe(false);
	});
	it("keeps the first library choice when another row is pressed during native dismissal", () => {
		vi.useFakeTimers();
		const handoff = create();
		const library = vi.fn(),
			documents = vi.fn();
		handoff.choose(library, "ios");
		handoff.choose(documents, "ios");
		handoff.choose(documents, "ios");
		handoff.dismissed();
		vi.runAllTimers();
		expect(library).toHaveBeenCalledOnce();
		expect(documents).not.toHaveBeenCalled();
	});
	it("admits no stale press however long the native dismissal takes", () => {
		vi.useFakeTimers();
		const handoff = create();
		const library = vi.fn(),
			documents = vi.fn();
		handoff.choose(library, "ios");
		vi.advanceTimersByTime(250);
		handoff.choose(documents, "ios");
		vi.advanceTimersByTime(5_000);
		expect(library).not.toHaveBeenCalled();
		handoff.dismissed();
		expect(library).toHaveBeenCalledOnce();
		expect(documents).not.toHaveBeenCalled();
		handoff.choose(documents, "ios");
		handoff.dismissed();
		vi.runAllTimers();
		expect(documents).not.toHaveBeenCalled();
	});
	it("ignores stale presses after onDismiss until Attach explicitly reopens", () => {
		vi.useFakeTimers();
		const handoff = create();
		const library = vi.fn(),
			documents = vi.fn();
		handoff.choose(library, "ios");
		handoff.dismissed();
		handoff.choose(documents, "ios");
		handoff.dismissed();
		expect(library).toHaveBeenCalledOnce();
		expect(documents).not.toHaveBeenCalled();
		handoff.cancel();
		handoff.choose(documents, "ios");
		handoff.dismissed();
		vi.runAllTimers();
		expect(documents).toHaveBeenCalledOnce();
	});
	it("waits for native dismissal; a repeated onDismiss cannot launch twice", () => {
		vi.useFakeTimers();
		const handoff = create();
		const launch = vi.fn();
		handoff.choose(launch, "ios");
		expect(launch).not.toHaveBeenCalled();
		vi.advanceTimersByTime(499);
		expect(launch).not.toHaveBeenCalled();
		handoff.dismissed();
		expect(launch).toHaveBeenCalledTimes(1);
		vi.runAllTimers();
		handoff.dismissed();
		expect(launch).toHaveBeenCalledTimes(1);
	});
	it("launches nothing without a selection or after unmount", () => {
		vi.useFakeTimers();
		const handoff = create();
		const launch = vi.fn();
		handoff.dismissed();
		vi.runAllTimers();
		expect(launch).not.toHaveBeenCalled();
		handoff.choose(launch, "ios");
		handoff.cancel();
		handoff.dismissed();
		vi.runAllTimers();
		expect(launch).not.toHaveBeenCalled();
	});
	it("cancels an old pending choice when Attach reopens before dismissal", () => {
		vi.useFakeTimers();
		const handoff = create();
		const stale = vi.fn();
		const fresh = vi.fn();
		handoff.choose(stale, "ios");
		vi.advanceTimersByTime(250);
		// Production Attach's onPress cancels before opening the sheet again.
		handoff.cancel();
		vi.advanceTimersByTime(500);
		handoff.dismissed();
		expect(stale).not.toHaveBeenCalled();
		handoff.choose(fresh, "ios");
		handoff.dismissed();
		vi.runAllTimers();
		expect(fresh).toHaveBeenCalledOnce();
		expect(stale).not.toHaveBeenCalled();
	});
	it.each(["android", "web"])("keeps %s selection immediate", (platform) => {
		vi.useFakeTimers();
		const handoff = create();
		const launch = vi.fn();
		handoff.choose(launch, platform);
		expect(launch).toHaveBeenCalledTimes(1);
		handoff.dismissed();
		vi.runAllTimers();
		expect(launch).toHaveBeenCalledTimes(1);
	});
	it("iOS never launches before a late native dismissal (no timer race, TestFlight 1157)", () => {
		vi.useFakeTimers();
		const handoff = create();
		const launch = vi.fn();
		handoff.choose(launch, "ios");
		// A busy JS thread stretches the sheet's exit past any fixed deadline.
		vi.advanceTimersByTime(5_000);
		expect(launch).not.toHaveBeenCalled();
		handoff.dismissed();
		expect(launch).toHaveBeenCalledOnce();
	});
	/* #248: on iOS 26 the sheet closed and no picker appeared. The launch waited
	 * on the Modal's onDismiss alone, and native delivery of that callback was
	 * never proven on a device. The fallback starts only from the commit that
	 * hid the Modal (`hidden`, the Sheet's onHidden), never from the press. */
	it("no onDismiss after hide commit still launches once", () => {
		vi.useFakeTimers();
		const trace = vi.fn();
		const handoff = createAttachmentSheetHandoff(trace);
		const launch = vi.fn();
		handoff.choose(launch, "ios");
		// The press alone arms nothing: the exit animation still holds the Modal.
		vi.advanceTimersByTime(60_000);
		expect(launch).not.toHaveBeenCalled();
		handoff.hidden();
		vi.advanceTimersByTime(DISMISS_FALLBACK_MS - 1);
		expect(launch).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(launch).toHaveBeenCalledOnce();
		expect(trace).toHaveBeenLastCalledWith({
			via: "fallback",
			afterHiddenMs: DISMISS_FALLBACK_MS,
		});
		// A late onDismiss, a second hide, more time: still exactly once. The
		// late callback is recorded (it tells "late" from "lost"), once.
		vi.advanceTimersByTime(180);
		handoff.dismissed();
		handoff.hidden();
		handoff.dismissed();
		vi.runAllTimers();
		expect(launch).toHaveBeenCalledOnce();
		expect(trace).toHaveBeenLastCalledWith({
			via: "late-onDismiss",
			afterHiddenMs: DISMISS_FALLBACK_MS + 180,
		});
		expect(trace).toHaveBeenCalledTimes(2);
	});
	it("onDismiss then timer launches once, never twice", () => {
		vi.useFakeTimers();
		const trace = vi.fn();
		const handoff = createAttachmentSheetHandoff(trace);
		const launch = vi.fn();
		handoff.choose(launch, "ios");
		handoff.hidden();
		vi.advanceTimersByTime(16);
		handoff.dismissed();
		expect(launch).toHaveBeenCalledOnce();
		expect(trace).toHaveBeenLastCalledWith({
			via: "onDismiss",
			afterHiddenMs: 16,
		});
		vi.runAllTimers();
		expect(vi.getTimerCount()).toBe(0);
		expect(launch).toHaveBeenCalledOnce();
		expect(trace).toHaveBeenCalledOnce();
	});
	it("unmount cancels", () => {
		vi.useFakeTimers();
		const handoff = create();
		const launch = vi.fn();
		handoff.choose(launch, "ios");
		handoff.hidden();
		// The composer's unmount effect, and Attach's reopen, both call cancel().
		handoff.cancel();
		expect(vi.getTimerCount()).toBe(0);
		vi.runAllTimers();
		handoff.dismissed();
		expect(launch).not.toHaveBeenCalled();
	});
	it("a hide with nothing chosen arms nothing", () => {
		vi.useFakeTimers();
		const handoff = create();
		handoff.hidden();
		expect(vi.getTimerCount()).toBe(0);
		const launch = vi.fn();
		handoff.choose(launch, "android");
		handoff.hidden();
		expect(vi.getTimerCount()).toBe(0);
		expect(launch).toHaveBeenCalledOnce();
	});
	/* Review round 1, R4: only a pending attach choice is traced — not every
	 * close (Close, the scrim) and never the web or Android, which launch at
	 * once — so the trail is the sample DISMISS_FALLBACK_MS needs, undiluted. */
	it("traces only an attach choice that waited, never a plain close or an immediate launch", () => {
		vi.useFakeTimers();
		const trace = vi.fn();
		const handoff = createAttachmentSheetHandoff(trace);
		handoff.hidden();
		handoff.dismissed();
		for (const platform of ["web", "android"]) {
			handoff.cancel();
			handoff.choose(vi.fn(), platform);
			handoff.hidden();
			handoff.dismissed();
		}
		vi.runAllTimers();
		expect(trace).not.toHaveBeenCalled();
	});
	/* Review round 1, R1: the trace must reach a RELEASE build, because the
	 * only iPhone channel is TestFlight. It lands in Settings → Copy
	 * diagnostics, bounded, with no content: a path name and milliseconds. */
	it("keeps a bounded release trail for Copy diagnostics", () => {
		vi.useFakeTimers();
		const handoff = create();
		handoff.choose(vi.fn(), "ios");
		handoff.hidden();
		vi.advanceTimersByTime(14);
		handoff.dismissed();
		handoff.cancel();
		handoff.choose(vi.fn(), "ios");
		handoff.hidden();
		vi.advanceTimersByTime(DISMISS_FALLBACK_MS + 180);
		handoff.dismissed();
		expect(attachHandoffDiagnostics()).toMatch(TRAIL_TAIL);
		for (let i = 0; i < 30; i += 1) {
			handoff.cancel();
			handoff.choose(vi.fn(), "ios");
			handoff.hidden();
			handoff.dismissed();
		}
		expect(attachHandoffDiagnostics()?.split(", ")).toHaveLength(20);
		expect(attachHandoffDiagnostics()).toMatch(TRAIL_BOUNDED);
	});
	/* Review round 1, R5: the fallback races only a NON-animated native
	 * dismissal. That is the invariant its size rests on; the size itself is
	 * a maintainer decision pending device measurement (the PR's options). */
	it("races only a non-animated native dismissal", () => {
		expect(read("../../ui/components/sheet.tsx")).toContain(
			'animationType="none"',
		);
	});
	it("wires the real composer choice and native dismissal without changing close/layout", () => {
		expect(source).toContain("onHidden={attachmentHandoff.hidden}");
		expect(source).toContain("onDismiss={attachmentHandoff.dismissed}");
		expect(source).toMatch(COMPOSER_CHOOSE);
		expect(source).toMatch(CANCEL_BEFORE_REOPEN);
		expect(source).toContain(
			"// The handoff waits for native dismissal; state alone is not that acknowledgement.",
		);
		expect(source).toContain("onClose={() => setAttachSheetOpen(false)}");
		expect(source).toContain("<AttachSheet");
		const sheet = read("./components/attach-sheet.tsx");
		expect(sheet).toMatch(SHEET_HANDOFF_CLOSE);
		expect(sheet).toContain(
			'exitInstantly={handingOff && Platform.OS === "ios"}',
		);
		// One shared rule: the composer imports it rather than keeping a copy.
		expect(source).toContain(
			'import { createAttachmentSheetHandoff } from "@/features/session/attach-handoff";',
		);
		expect(source).not.toContain(
			"export function createAttachmentSheetHandoff",
		);
	});
	/* Team Bridge's attach sheet launched PHPicker on the same tick as its close
	 * (`void addImages(source)` straight from the row) — the race this module
	 * exists for, with no wait at all. Pinned at the source boundary like the
	 * composer's wiring above: rendering the thread screen needs the native
	 * renderer this suite deliberately avoids. */
	it("routes Team Bridge's attach sheet through the same native-dismissal handoff", () => {
		const bridge = read("../team-bridge/thread-screen.tsx");
		expect(bridge).toContain(
			'import { createAttachmentSheetHandoff } from "@/features/session/attach-handoff";',
		);
		expect(bridge).toContain("onDismiss={attachHandoff.dismissed}");
		expect(bridge).toContain("onHidden={attachHandoff.hidden}");
		expect(bridge).toMatch(BRIDGE_CHOOSE);
		expect(bridge).toMatch(BRIDGE_CANCEL_BEFORE_REOPEN);
		expect(bridge).toContain("<AttachSheet");
		expect(bridge).toContain(
			"useEffect(() => () => attachHandoff.cancel(), [attachHandoff]);",
		);
		// The row no longer launches directly.
		expect(bridge).not.toMatch(BRIDGE_DIRECT_LAUNCH);
	});
	it("lets Home's reader dismiss a refused or failed pick's line, only while it is shown", () => {
		const home = read("../home/home.tsx");
		expect(home).toMatch(OWNER_ATTACH_FINALLY);
		expect(home).toContain("setComposerError(composerCopy().attachError);");
		expect(home).toMatch(HOME_DISMISS_SHOWN_LINE);
	});
});
