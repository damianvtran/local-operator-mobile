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
export function stageBFlow(steps: StageBStep[]): string {
	// Generated outside the global Maestro flow glob: these target ONLY the
	// dedicated bundle and cannot accidentally run against a real user's app.
	return `appId: ${STAGE_B_BUNDLE}\n---\n${steps.map((step) => `- ${JSON.stringify(step)}`).join("\n")}\n`;
}
const row = `computer-row-${STAGE_B_HOST}`;
export const selectStageBComputer = (): StageBStep[] => [
	{
		extendedWaitUntil: {
			visible: { id: `(${row.replaceAll(".", "\\.")}|composer-input)` },
			timeout: 78000,
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
