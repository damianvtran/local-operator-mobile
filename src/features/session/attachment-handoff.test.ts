import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const CANCEL_BEFORE_REOPEN =
	/onPress=\{\(\) => \{\s*attachmentHandoff\.cancel\(\);\s*setAttachSheetOpen\(true\);/;
const source = readFileSync(
	new URL("./components/composer.tsx", import.meta.url),
	"utf8",
);
// Evaluate the actual production function without importing the native renderer.
// No duplicated policy: source wiring below pins its use at the Sheet boundary.
const start = source.indexOf("export function createAttachmentSheetHandoff()");
const end = source.indexOf("/** The outcome lines", start);
if (start < 0 || end < 0) throw Error("production attachment handoff missing");
const js = stripTypeScriptTypes(
	source.slice(start, end).replace("export ", ""),
);
const create = () =>
	runInNewContext(`${js}; createAttachmentSheetHandoff()`, {
		setTimeout,
		clearTimeout,
	}) as {
		choose(launch: () => void, platform: string): void;
		dismissed(): void;
		cancel(): void;
	};
afterEach(() => vi.useRealTimers());
describe("native attachment sheet handoff", () => {
	it("keeps the first library choice when another row is pressed during native dismissal", () => {
		vi.useFakeTimers();
		const handoff = create();
		const library = vi.fn(),
			documents = vi.fn();
		handoff.choose(library, "ios");
		handoff.choose(documents, "ios");
		handoff.choose(library, "ios");
		handoff.dismissed();
		vi.runAllTimers();
		expect(library).toHaveBeenCalledOnce();
		expect(documents).not.toHaveBeenCalled();
	});
	it("does not reset the first deadline or admit stale presses after fallback", () => {
		vi.useFakeTimers();
		const handoff = create();
		const library = vi.fn(),
			documents = vi.fn();
		handoff.choose(library, "ios");
		vi.advanceTimersByTime(250);
		handoff.choose(documents, "ios");
		vi.advanceTimersByTime(250);
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
	it("waits for native dismissal; a later fallback cannot launch twice", () => {
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
	it("falls back after 500ms and consumes a late native dismissal exactly once", () => {
		vi.useFakeTimers();
		const handoff = create();
		const launch = vi.fn();
		handoff.choose(launch, "ios");
		vi.advanceTimersByTime(500);
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
	it("cancels an old pending choice when Attach reopens before 500ms", () => {
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
	it("wires the real composer choice and native dismissal without changing close/layout", () => {
		expect(source).toContain("onDismiss={attachmentHandoff.dismissed}");
		expect(source).toContain("attachmentHandoff.choose(");
		expect(source).toMatch(CANCEL_BEFORE_REOPEN);
		expect(source).toContain(
			"// The handoff waits for native dismissal; state alone is not that acknowledgement.",
		);
		expect(source).toContain("() => onAttach(action.source)");
		expect(source).toContain("onClose={() => setAttachSheetOpen(false)}");
	});
});
