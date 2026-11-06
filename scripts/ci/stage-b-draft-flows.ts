import {
	STAGE_B_BUNDLE,
	STAGE_B_HOST,
} from "../../src/testing/stage-b-draft-transport.ts";
import type { StageBDocumentProvider } from "./stage-b-document-seed.ts";
import { STAGE_B_DOCUMENT_ROW } from "./stage-b-document-seed.ts";
import { STAGE_B_POST_RELEASE_WINDOW_MS } from "./stage-b-draft-timing.ts";
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
/** Run 41882974569: PHPicker was ready ~3s after the library tap, but
 * only a fresh driver saw its remote tree. Wait up to 10x that measured delay. */
export const STAGE_B_PICKER_WAIT_MS = 30_000;
// 10s dismissal + 120s outcome wait bounds this native phase at 130s.
// No product timeout: legitimate native browsing may last much longer.
export const STAGE_B_PICKER_OUTCOME_MS = 120_000;
export const STAGE_B_PICKER_OUTCOME_LABEL =
	"Native picker or attach error did not appear within 130s";
export const STAGE_B_PICKER_BROWSER_ID =
	"(PXGGridLayout-Info|DOC.browsingRoot|composer-error)";
export const STAGE_B_WRONG_PICKER =
	"Wrong picker: document browser opened instead of Photos";
export function stageBStartsInPhotoPicker(steps: StageBStep[]): boolean {
	const wait = steps[0]?.extendedWaitUntil as
		| { visible?: { id?: string }; notVisible?: { id?: string } }
		| undefined;
	const next = steps[1]?.extendedWaitUntil as
		| { visible?: { id?: string } }
		| undefined;
	return (
		wait?.visible?.id === "PXGGridLayout-Info" ||
		(wait?.notVisible?.id === "attach-sheet" &&
			next?.visible?.id === STAGE_B_PICKER_BROWSER_ID)
	);
}
export function stageBFlow(steps: StageBStep[]): string {
	// Generated outside the global Maestro flow glob: these target ONLY the
	// dedicated bundle and cannot accidentally run against a real user's app.
	// Maestro 2.11 defaults to stopping the app. Foreground ONLY: restart/PID
	// evidence belongs to explicit simctl terminate+launch, never this wrapper.
	// The picker is already presented by the previous invocation. Re-launching
	// or awaiting a composer id here would obscure the remote-view evidence.
	const foreground: StageBStep[] = stageBStartsInPhotoPicker(steps)
		? []
		: [
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
/** The driver starts only AFTER release. A timed negative loop, rather than
 * one early absence assertion, catches delayed UI import over a real 10s span. */
export const assertStageBPostReleaseDraft = (text: string): StageBStep[] => [
	{
		evalScript: `\${output.stageBNoRestoreUntil = Date.now() + ${STAGE_B_POST_RELEASE_WINDOW_MS}}`,
	},
	{
		repeat: {
			while: { true: `\${Date.now() < output.stageBNoRestoreUntil}` },
			commands: assertStageBDraft(text, false),
		},
	},
	...assertStageBDraft(text, false),
];
/** Native attachment surface for attachment-bearing drafts. The Files picker
 * needs no PhotoKit ingest, which 42078247373 showed stalled permanently.
 * Run 42119054596* showed the picker opening on an empty "Recents" sheet, so the
 * flow navigates to the provider the seed actually wrote to and waits on
 * hierarchy elements confirmed in that run: the "Recents"/"Browse" segmented
 * control and the provider row. `DOC.browsingBrowser` is a container view with
 * no size — Maestro never calls it visible, so it is not an anchor. */
/** `provider` is required: a default here would silently disagree with whichever
 * container the seeder actually wrote to (review R29-5). */
export const attachStageBDocument = (
	provider: StageBDocumentProvider,
): StageBStep[] => [
	{ tapOn: { id: "composer-attach" } },
	{ waitForAnimationToEnd: { timeout: 5000 } },
	{ assertVisible: { id: "attach-option-files" } },
	{ tapOn: { id: "attach-option-files", retryTapIfNoChange: false } },
	{ extendedWaitUntil: { notVisible: { id: "attach-sheet" }, timeout: 10000 } },
	// The visible discriminator for "the document browser is up": its tab labels.
	{
		extendedWaitUntil: {
			visible: { text: "Browse" },
			timeout: STAGE_B_DOCUMENT_BROWSER_MS,
			label: STAGE_B_DOCUMENT_BROWSER_LABEL,
		},
	},
	// Photos is the wrong picker: its grid is the positive, specific marker.
	{
		assertNotVisible: { id: "PXGGridLayout-Info", label: STAGE_B_WRONG_PICKER },
	},
	{
		assertNotVisible: {
			id: "composer-error",
			label: "Document picker failed: composer attach error",
		},
	},
	{ tapOn: { text: "Browse" } },
	{
		extendedWaitUntil: {
			visible: { text: STAGE_B_DOCUMENT_PROVIDER_LABEL[provider] },
			timeout: STAGE_B_DOCUMENT_PROVIDER_MS,
			label: STAGE_B_DOCUMENT_PROVIDER_LABEL_TEXT[provider],
		},
	},
	{ tapOn: { text: STAGE_B_DOCUMENT_PROVIDER_LABEL[provider] } },
	{
		extendedWaitUntil: {
			visible: { text: STAGE_B_DOCUMENT_ROW },
			timeout: STAGE_B_DOCUMENT_FILE_MS,
			label: STAGE_B_DOCUMENT_SEED_LABEL,
		},
	},
	{ tapOn: { text: STAGE_B_DOCUMENT_ROW } },
	{
		extendedWaitUntil: {
			visible: { id: "composer-attachment-0" },
			timeout: 15000,
		},
	},
];
export const STAGE_B_DOCUMENT_PROVIDER_LABEL: Readonly<
	Record<StageBDocumentProvider, string>
> = { cloud: "iCloud Drive", local: "On My iPhone" };
export const STAGE_B_DOCUMENT_PROVIDER_LABEL_TEXT: Readonly<
	Record<StageBDocumentProvider, string>
> = {
	cloud: "Files browser did not list iCloud Drive within 15s",
	local: "Files browser did not list On My iPhone within 15s",
};
/** Runs 42119022926/42119054596: the picker was on screen within ~3s of the
 * tap, so a 30s ceiling names a wrong-picker failure quickly instead of after
 * the 120s wait that dominated a 289.7s segment. */
export const STAGE_B_DOCUMENT_BROWSER_MS = 30_000;
export const STAGE_B_DOCUMENT_PROVIDER_MS = 15_000;
export const STAGE_B_DOCUMENT_FILE_MS = 20_000;
export const STAGE_B_DOCUMENT_BROWSER_LABEL =
	"Files document browser did not appear within 30s";
export const STAGE_B_DOCUMENT_SEED_LABEL =
	"Document picker did not show the seeded file";
/** NOT executed: the photo-library row is environment-BLOCKED by the 42078247373
 * stack (assetsd rebuild inside the PhotoKit changes transaction). Kept because
 * the row must stay recorded rather than deleted. */
export const attachStageBPhoto = (): StageBStep[] => [
	{ tapOn: { id: "composer-attach" } },
	// Sheet rises 40pt over 240ms. A stale pre-wait hierarchy can aim at a
	// different row; run 41900181124 explicitly logged that fallback path.
	{ waitForAnimationToEnd: { timeout: 5000 } },
	{ assertVisible: { id: "attach-option-library" } },
	{ tapOn: { id: "attach-option-library", retryTapIfNoChange: false } },
	{ extendedWaitUntil: { notVisible: { id: "attach-sheet" }, timeout: 10000 } },
	// Recognise either native browser, then diagnose the wrong source BEFORE
	// spending the full photo-grid timeout on a Files document browser.
	{
		extendedWaitUntil: {
			visible: { id: STAGE_B_PICKER_BROWSER_ID },
			timeout: STAGE_B_PICKER_OUTCOME_MS,
			label: STAGE_B_PICKER_OUTCOME_LABEL,
		},
	},
	{ assertNotVisible: { id: "DOC.browsingRoot", label: STAGE_B_WRONG_PICKER } },
	{
		assertNotVisible: {
			id: "composer-error",
			label: "Photo picker failed: composer attach error",
		},
	},
	{
		extendedWaitUntil: {
			visible: { id: "PXGGridLayout-Info", text: "Photo, .*" },
			timeout: STAGE_B_PICKER_WAIT_MS,
		},
	},
	// iOS 26 inserts an onboarding banner above the grid. Coordinates hit that
	// banner, not a photo; use the actual PHPicker accessibility tree instead.
	{
		runFlow: {
			when: { visible: "Private Access to Photos.*" },
			commands: [{ tapOn: { text: "Close", index: 0 } }],
		},
	},
	{
		extendedWaitUntil: {
			visible: { id: "PXGGridLayout-Info", text: "Photo, .*" },
			timeout: 15000,
		},
	},
	{ tapOn: { id: "PXGGridLayout-Info", text: "Photo, .*", index: 0 } },
	{ runFlow: { when: { visible: "Add" }, commands: [{ tapOn: "Add" }] } },
	{
		extendedWaitUntil: {
			visible: { id: "composer-attachment-0" },
			timeout: 15000,
		},
	},
	{ assertVisible: { id: "composer-attachment-0" } },
];
/** 41973921764 retained a 38-character suffix: iOS eraseText sends backspaces
 * at the tapped caret, not a platform clear. Focus the field's trailing corner
 * without tap retries, erase the complete known draft, and fail before retyping
 * if the native field is not empty. No app reset or production mutation. */
export const discardStageBDraft = (currentText: string): StageBStep[] => [
	{
		tapOn: {
			id: "composer-input",
			point: "99%,99%",
			retryTapIfNoChange: false,
		},
	},
	{ eraseText: { charactersToErase: currentText.length } },
	// Maestro 2.11 text selectors union text/hint/label: ^$ also matches an
	// empty hint on a NONEMPTY field. Read text with its ordered fallback instead.
	// copyTextFrom is an internal JS variable, not the system clipboard. Our ASCII
	// canaries cannot equal its exact empty placeholder/label variants. Native
	// 41973921764 also exposes the aggregate AX label "Message Message…" with
	// empty text/hint; accept that observed value exactly, never a wildcard.
	// Tests pin the label/placeholder contract and reject nonempty lookalikes.
	{ copyTextFrom: { id: "composer-input" } },
	{
		assertTrue: `\${maestro.copiedText === "" || maestro.copiedText === "Message…" || maestro.copiedText === "Message" || maestro.copiedText === "Message Message…"}`,
	},
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
