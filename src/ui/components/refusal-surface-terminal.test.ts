import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The refusal surface shows a terminal command ONLY behind "Using a terminal?"
 * (M1: a non-technical reader connects with no terminal commands).
 *
 * Asserted over the SOURCE, as `settings-refusal-wiring.test.ts` does and for
 * the reason it records: the surface reaches `uniwind` through `@/ui`, which the
 * Node test environment cannot import. The rendered states are the screenshot
 * round's job.
 */
const SURFACE = readFileSync(
	fileURLToPath(new URL("./refusal-surface.tsx", import.meta.url)),
	"utf8",
);
const SETUP = readFileSync(
	fileURLToPath(
		new URL("../../features/auth/setup-computer.tsx", import.meta.url),
	),
	"utf8",
);

describe("commands live only behind the terminal disclosure", () => {
	it("renders the remedy block only while the disclosure is open", () => {
		const remedyUses = SURFACE.match(/\{remedy\}|command=\{remedy\}/g) ?? [];
		expect(remedyUses).toEqual(["command={remedy}"]);
		const disclosure = SURFACE.indexOf("{showTerminal ? (");
		expect(disclosure).toBeGreaterThan(-1);
		expect(SURFACE.indexOf("command={remedy}")).toBeGreaterThan(disclosure);
		expect(SURFACE).toContain("useState(false);\n\tconst [showHowTo");
		expect(SURFACE).toContain('label={t("mobile.refusal.terminal.toggle")}');
	});

	it("drops the gateway sentence and the kind's buttons when a cause is named", () => {
		expect(SURFACE).toContain('{detail && kind !== "diagnostic" && !copy ? (');
		expect(SURFACE).toContain("{copy ? copy.title : HEADLINE[kind](subject)}");
	});

	it("keeps set-up's commands behind the same disclosure, closed by default", () => {
		expect(SETUP).toContain(
			"const [showTerminal, setShowTerminal] = useState(false);",
		);
		const toggle = SETUP.indexOf("CONTROL.setupTerminalToggle");
		const routes = SETUP.indexOf("<TerminalRoutes");
		expect(toggle).toBeGreaterThan(-1);
		expect(routes).toBeGreaterThan(toggle);
		expect(
			SETUP.indexOf('t("mobile.computers.setup.open_settings")'),
		).toBeLessThan(toggle);
		/* Every command-bearing block is inside `TerminalRoutes`, never the screen. */
		const screen = SETUP.slice(SETUP.indexOf("export const SetupComputer = ("));
		expect(
			screen.slice(0, screen.indexOf("export const ConnectorWaitPanel")),
		).not.toContain("<CommandBlock");
	});
});
