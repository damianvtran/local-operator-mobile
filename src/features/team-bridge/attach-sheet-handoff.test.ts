import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Team Bridge thread's attach sheet closes and then opens the system photo
 * picker. On iOS the picker is presented from the native view controller that
 * is current at the moment of the call (expo-image-picker's
 * `presentPickerUI` -> `currentViewController().present`, with no completion
 * check and no rejection path). Called in the same press that closes the sheet,
 * that controller is the sheet's own modal, which is being dismissed: UIKit
 * either declines the presentation or dismisses the picker with the sheet, and
 * the module's promise never settles. The reader sees the sheet close and
 * nothing else, with no error.
 *
 * The agent composer fixed this by deferring the launch to the sheet's
 * `onDismiss` (`attach-handoff.ts`). These pins hold the
 * Team Bridge sheet to the same rule. They read source because the thread
 * screen cannot be rendered without the native renderer; the hand-off's own
 * behaviour is run for real in `session/attachment-handoff.test.ts`.
 */
const source = readFileSync(
	new URL("./thread-screen.tsx", import.meta.url),
	"utf8",
);
const sheetStart = source.indexOf("visible={attachOpen}");
const UNMOUNT_CANCEL =
	/useEffect\(\(\) => \(\) => attachHandoff\.cancel\(\), \[attachHandoff\]\)/;
const CHOOSE_THROUGH_HANDOFF =
	/attachHandoff\.choose\(\s*\(\) => \{\s*void addImages\(source\);\s*\},\s*Platform\.OS,?\s*\)/;
const DIRECT_LAUNCH = /onPress=\{\(\) => \{\s*void addImages\(source\);/;
const CANCEL_BEFORE_REOPEN =
	/const openAttach = \(\) => \{[^}]*attachHandoff\.cancel\(\);\s*setAttachOpen\(true\);\s*\};/;
const OPEN_ONLY_WITH_DRAFT = /onAttach=\{images \? openAttach : undefined\}/;

describe("Team Bridge attach sheet hand-off to the native picker", () => {
	it("uses the shared hand-off, created once and cancelled on unmount", () => {
		expect(source).toContain(
			'import { createAttachmentSheetHandoff } from "@/features/session/attach-handoff";',
		);
		expect(source).toContain(
			"const attachHandoff = useRef(createAttachmentSheetHandoff()).current;",
		);
		expect(source).toMatch(UNMOUNT_CANCEL);
	});

	it("waits for the sheet's native dismissal before launching a source", () => {
		expect(sheetStart).toBeGreaterThan(0);
		const sheet = source.slice(sheetStart, sheetStart + 2400);
		expect(sheet).toContain("onDismiss={attachHandoff.dismissed}");
		expect(sheet).toMatch(CHOOSE_THROUGH_HANDOFF);
		// A row that calls `addImages` itself opens the picker over a sheet that
		// is still on screen.
		expect(sheet).not.toMatch(DIRECT_LAUNCH);
	});

	it("re-admits a fresh choice only when the paperclip reopens the sheet", () => {
		expect(source).toMatch(CANCEL_BEFORE_REOPEN);
		expect(source).toMatch(OPEN_ONLY_WITH_DRAFT);
	});
});
