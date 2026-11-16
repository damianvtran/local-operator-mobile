import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttachmentSheetHandoff } from "./attach-handoff";

const OWNER_ATTACH_FINALLY = /finally\s*\{\s*setAttaching\(false\)/;
// `choose` (not `onChoose`) since round 1's U4: it moves the epoch first.
const CAMERA_READY_CHOOSES = /if \(readiness === "ready"\) choose\("camera"\);/;
const TEAM_BRIDGE_CLOSE_THEN_CHOOSE =
	/setAttachOpen\(false\);\s*attachHandoff\.choose\(/;
const CANCEL_BEFORE_REOPEN =
	/onPress=\{\(\) => \{\s*attachmentHandoff\.cancel\(\);\s*setAttachSheetOpen\(true\);/;
const source = readFileSync(
	new URL("./components/composer.tsx", import.meta.url),
	"utf8",
);
const teamBridge = readFileSync(
	new URL("../team-bridge/thread-screen.tsx", import.meta.url),
	"utf8",
);
// The production rule, imported: it lives in a plain module now so the
// composer's sheet and Team Bridge's share it (`attach-handoff.ts`).
const create = () => createAttachmentSheetHandoff();
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
	it("cancel after a launched choice cannot clear an owner's running attach before finally", () => {
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
	it("admits no later press while the first choice waits for dismissal", () => {
		const handoff = create();
		const library = vi.fn(),
			documents = vi.fn();
		handoff.choose(library, "ios");
		handoff.choose(documents, "ios");
		expect(library).not.toHaveBeenCalled();
		handoff.dismissed();
		expect(library).toHaveBeenCalledOnce();
		handoff.choose(documents, "ios");
		handoff.dismissed();
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
	it("never presents the picker while the sheet is still dismissing, however slow the dismissal", () => {
		/* The leading hypothesis for "attach opens nothing" (attach-handoff.ts):
		 * iOS silently refuses to present over a controller mid-dismissal, and the
		 * old 500 ms fallback launched into exactly that window whenever the
		 * sheet's exit ran long. The launch must wait for onDismiss and nothing
		 * else — not the close, not a timer. */
		vi.useFakeTimers();
		const handoff = create();
		const launch = vi.fn();
		handoff.choose(launch, "ios");
		expect(launch).not.toHaveBeenCalled();
		vi.advanceTimersByTime(10_000);
		expect(launch).not.toHaveBeenCalled();
		handoff.dismissed();
		expect(launch).toHaveBeenCalledTimes(1);
		handoff.dismissed();
		expect(launch).toHaveBeenCalledTimes(1);
	});
	it("a lost onDismiss strands nothing: the next Attach re-admits a fresh choice", () => {
		vi.useFakeTimers();
		const handoff = create();
		const lost = vi.fn();
		const fresh = vi.fn();
		handoff.choose(lost, "ios");
		vi.runAllTimers();
		expect(lost).not.toHaveBeenCalled();
		handoff.cancel();
		handoff.choose(fresh, "ios");
		handoff.dismissed();
		expect(fresh).toHaveBeenCalledOnce();
		expect(lost).not.toHaveBeenCalled();
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
		const handoff = create();
		const stale = vi.fn();
		const fresh = vi.fn();
		handoff.choose(stale, "ios");
		// Production Attach's onPress cancels before opening the sheet again.
		handoff.cancel();
		handoff.dismissed();
		expect(stale).not.toHaveBeenCalled();
		handoff.choose(fresh, "ios");
		handoff.dismissed();
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
	it("wires the real composer choice and native dismissal without changing close/layout", () => {
		expect(source).toContain("onDismiss={attachmentHandoff.dismissed}");
		expect(source).toContain("attachmentHandoff.choose(");
		expect(source).toMatch(CANCEL_BEFORE_REOPEN);
		expect(source).toContain(
			"// The handoff waits for native dismissal; state alone is not that acknowledgement.",
		);
		expect(source).toContain("() => onAttach(source)");
		expect(source).toContain("onClose={() => setAttachSheetOpen(false)}");
		/* The sheet moved into `attach-sheet.tsx` with the icon menu: the native
		 * dismissal the handoff waits for must still reach the Modal, and the
		 * camera's permission step must run BEFORE `onChoose` closes the sheet. */
		const sheet = readFileSync(
			new URL("./components/attach-sheet.tsx", import.meta.url),
			"utf8",
		);
		expect(sheet).toContain("onDismiss={onDismiss}");
		expect(sheet).toMatch(CAMERA_READY_CHOOSES);
		// Team Bridge's sheet goes through the same rule now.
		expect(teamBridge).toContain("onDismiss={attachHandoff.dismissed}");
		expect(teamBridge).toMatch(TEAM_BRIDGE_CLOSE_THEN_CHOOSE);
	});
});
