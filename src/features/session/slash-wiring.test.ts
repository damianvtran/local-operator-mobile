import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SOURCE CHECK on how the session screen feeds the slash sheet its catalogue
 * state (QA round 1, Q1).
 *
 * The sheet's loading and failed lines are tested on the component
 * (`slash-sheet.test.tsx`) and the decision on `slashSheetStatus`, but the
 * screen never passed `loading`, so in the app the sheet said "No matching
 * commands" while `GET /api/commands` was held, and again when it failed. The
 * hook has no Node renderer here (`vitest.config.ts`), so the two hand-offs are
 * pinned in source: the read records its own failure, and the screen passes
 * both facts on.
 */
const read = (path: string) =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(
		/\s+/g,
		" ",
	);

describe("the slash sheet's catalogue state", () => {
	it("is recorded by the commands read: a null answer is a failed read", () => {
		const hook = read("./use-session.ts");
		expect(hook).toContain("setCommandsFailed(commandList === null);");
		/* The catalogue's OWN in-flight flag. The session's `loading` is cleared
		 *  by the first stream frame (it means "no frame yet"), so a held
		 *  `GET /api/commands` still read "No matching commands" on top of it —
		 *  measured on the web export with the request held. */
		expect(hook).toContain("setCommandsLoading(true);");
		expect(hook).toContain("if (!cancelled) setCommandsLoading(false);");
		expect(hook).toContain(
			"commandsLoading: ownsProjection ? commandsLoading : false,",
		);
		expect(hook).toContain(
			"commandsFailed: ownsProjection ? commandsFailed : false,",
		);
	});

	it("is handed to the sheet by the session screen", () => {
		const screen = read("../../../app/(app)/session/[id].tsx");
		const sheet = screen.slice(screen.indexOf("<SlashSheet"));
		const props = sheet.slice(0, sheet.indexOf("/>"));
		expect(props).toContain("loading={runtime.commandsLoading}");
		expect(props).toContain("failed={runtime.commandsFailed}");
	});
});
