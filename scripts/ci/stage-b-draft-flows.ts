import {
	STAGE_B_BUNDLE,
	STAGE_B_HOST,
} from "../../src/testing/stage-b-draft-transport.ts";
export type StageBStep = Record<string, unknown>;
const REGEX_META = /[.*+?^${}()|[\]\\]/g;
const exactDraft = (text: string) => ({
	id: "composer-input",
	text: `^${text.replace(REGEX_META, "\\$&")}$`,
});
// Keep this app-owned selector shared by the warm hierarchy gate and every flow.
// SpringBoard's app icon is not a drawn screen, even when it names our bundle.
export const STAGE_B_DRAWN_SCREEN =
	"(stage-b-proof-gate|welcome-screen|home-screen|composer-input|computer-row-" +
	STAGE_B_HOST.replaceAll(".", "\\.") +
	")";
// Account-routing's hosted cold-app sample is 25,869 ms; its shared 3x
// derivation rounds to 78 s. Driver installation has a separate cold cap.
export const STAGE_B_COLD_ASSERTION_MS = 78000;
const DRAWN_SCREEN = new RegExp(STAGE_B_DRAWN_SCREEN);
/** Share the actual hierarchy gate with tests; an anchored test-only regex would
 * silently test different matching semantics from the raw native hierarchy. */
export function stageBHasDrawnScreen(hierarchy: string): boolean {
	return DRAWN_SCREEN.test(hierarchy);
}
export function stageBFlow(steps: StageBStep[]): string {
	// Generated outside the global Maestro flow glob: these target ONLY the
	// dedicated bundle and cannot accidentally run against a real user's app.
	// Maestro 2.11 defaults to stopping the app. Foreground ONLY: restart/PID
	// evidence belongs to explicit simctl terminate+launch, never this wrapper.
	const foreground: StageBStep[] = [
		// Omitting permissions grants everything in Maestro 2.11, which mutates
		// simulator privacy and may kill the tracked process. An empty map sets none.
		{ launchApp: { stopApp: false, permissions: {} } },
		{
			extendedWaitUntil: {
				visible: { id: STAGE_B_DRAWN_SCREEN },
				timeout: STAGE_B_COLD_ASSERTION_MS,
			},
		},
	];
	return `appId: ${STAGE_B_BUNDLE}\n---\n${[...foreground, ...steps].map((step) => `- ${JSON.stringify(step)}`).join("\n")}\n`;
}
const row = `computer-row-${STAGE_B_HOST}`;
export const selectStageBComputer = (): StageBStep[] => [
	{
		extendedWaitUntil: {
			visible: { id: `(${row.replaceAll(".", "\\.")}|composer-input)` },
			timeout: STAGE_B_COLD_ASSERTION_MS,
		},
	},
	{
		runFlow: {
			when: { visible: { id: row } },
			commands: [{ tapOn: { id: row } }],
		},
	},
];
export const stageBEditor = (): StageBStep[] => [
	{
		extendedWaitUntil: {
			visible: { id: "composer-input", enabled: true },
			timeout: 30000,
		},
	},
	{ assertVisible: { id: "composer-input" } },
];
export const typeStageBDraft = (text: string): StageBStep[] => [
	...stageBEditor(),
	{ tapOn: { id: "composer-input" } },
	{ inputText: text },
	{ hideKeyboard: {} },
	{ assertVisible: exactDraft(text) },
];
export const assertStageBDraft = (
	text: string,
	present: boolean,
): StageBStep[] => [
	...stageBEditor(),
	{ [present ? "assertVisible" : "assertNotVisible"]: exactDraft(text) },
];
export const attachStageBPhoto = (): StageBStep[] => [
	{ tapOn: { id: "composer-attach" } },
	{ tapOn: { id: "attach-option-library" } },
	{ extendedWaitUntil: { visible: "Photos", timeout: 15000 } },
	{ tapOn: { point: "18%,28%" } },
	{ runFlow: { when: { visible: "Add" }, commands: [{ tapOn: "Add" }] } },
	{
		extendedWaitUntil: {
			visible: { id: "composer-attachment-0" },
			timeout: 15000,
		},
	},
	{ assertVisible: { id: "composer-attachment-0" } },
];
export const discardStageBDraft = (): StageBStep[] => [
	{ tapOn: { id: "composer-input" } },
	{ eraseText: {} },
	{ hideKeyboard: {} },
	{
		runFlow: {
			when: { visible: { id: "composer-attachment-0" } },
			commands: [{ tapOn: { id: "composer-attachment-0" } }],
		},
	},
	{ assertVisible: { id: "composer-input" } },
];
export const logoutStageB = (): StageBStep[] => [
	{ tapOn: { id: "settings-button" } },
	{
		scrollUntilVisible: {
			element: { id: "settings-sign-out" },
			direction: "DOWN",
			timeout: 15000,
		},
	},
	{ tapOn: { id: "settings-sign-out" } },
	{ tapOn: { id: "dialog-confirm" } },
	{ extendedWaitUntil: { visible: { id: "welcome-screen" }, timeout: 20000 } },
];
