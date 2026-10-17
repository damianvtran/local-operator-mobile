import { accountRoutingCopy as copy } from "../../src/features/settings/account-routing-copy.ts";
import {
	accountRoutingChoiceId,
	CONTROL,
	REGION,
	SCREEN,
} from "../../src/ui/a11y.ts";

export type NativeStep = Record<string, unknown>;

/** Steady in-flow wait, for an element on an already-drawn screen. */
export const STEADY_WAIT_MS = 15000;

/** Cold wait for the FIRST assertion after a `launchApp: {clearState: true }` on a
 * freshly created simulator.
 *
 * This is F4 one level deeper. F4 removed the Maestro DRIVER's cold start from the
 * first flow; the flow still carried the APP's own cold launch — clearState wipes
 * app data and the process then has to paint its first frame. On run 38853165349
 * that launch alone measured 25869ms (`warm-launch-base-app`, rc0) while the
 * opening `id: welcome-screen is visible` waited a flat 15000ms and failed, with
 * the rendered frame showing the Welcome screen HAD drawn: the budget, not the app,
 * was the defect. Derived from the measured cold-launch cost with the same
 * spread factor and floor the caps use (78s), never a hand-picked number.
 */
export const COLD_FIRST_WAIT_MS = 78000;

/** Waits default to the steady value; a caller passes the cold budget explicitly,
 * so a cold cost cannot silently inflate every steady wait in a flow. */
const wait = (id: string, timeoutMs: number = STEADY_WAIT_MS): NativeStep => ({
	extendedWaitUntil: { visible: { id }, timeout: timeoutMs },
});

const tap = (id: string): NativeStep => ({ tapOn: { id } });
const scroll = (id: string, direction = "DOWN"): NativeStep => ({
	scrollUntilVisible: { element: { id }, direction, timeout: STEADY_WAIT_MS },
});
const text = (value: string): NativeStep => ({
	extendedWaitUntil: { visible: { text: value }, timeout: STEADY_WAIT_MS },
});
export const firstSettled = (name: string): NativeStep[] => [
	{ takeScreenshot: `${name}-first` },
	{ waitForAnimationToEnd: { timeout: 2000 } },
	{ takeScreenshot: `${name}-settled` },
];
export const policyAnchor = (): NativeStep[] => [
	scroll(REGION.settingsConnection, "UP"),
	scroll(REGION.settingsAccountRouting),
];
export const readyPolicy = (): NativeStep[] => [
	...policyAnchor(),
	wait(CONTROL.settingsAccountRoutingGroup),
];
export const reloadPolicy = (): NativeStep[] => [
	...policyAnchor(),
	tap(CONTROL.settingsAccountRoutingRetry),
	wait(CONTROL.settingsAccountRoutingGroup),
];
export function connectSettings(helper: string): NativeStep[] {
	return [
		{ launchApp: { clearState: true } },
		// The helper's opening assertion is the app's FIRST post-clearState paint,
		// so it takes the cold budget. Later steps inside the helper stay steady.
		{ runFlow: helper },
		wait(SCREEN.home),
		tap(CONTROL.settingsButton),
		wait(SCREEN.settings),
	];
}

export function theme(value: "light" | "dark"): NativeStep[] {
	const id =
		value === "light" ? CONTROL.settingsThemeLight : CONTROL.settingsThemeDark;
	return [
		scroll(REGION.settingsConnection, "UP"),
		scroll(id),
		tap(id),
		{ extendedWaitUntil: { visible: { id, selected: true }, timeout: 15000 } },
	];
}
export function baselineSettings(mode: "light" | "dark"): NativeStep[] {
	return [
		...theme(mode),
		scroll(REGION.settingsConnection, "UP"),
		{ assertNotVisible: { id: REGION.settingsAccountRouting } },
		...firstSettled(`before-${mode}`),
	];
}
export function choose(value: string): NativeStep[] {
	return [
		...readyPolicy(),
		// ONE spelling for the family: the same builder the settings section calls, so a
		// flow and the row it taps cannot drift. The a11y scan roots
		// (app/src/ui/src/features) exclude scripts/ci, so an inline copy here would be
		// drift no control could see.
		tap(accountRoutingChoiceId(value)),
		text(copy("mobile.account_routing.unsaved")),
		...firstSettled("draft-no-write"),
	];
}
export function savePending(): NativeStep[] {
	return [
		...policyAnchor(),
		{ doubleTapOn: { id: CONTROL.settingsAccountRoutingSave } },
		text(copy("mobile.account_routing.saving")),
		...firstSettled("pending"),
	];
}
export function saved(value: string): NativeStep[] {
	return [
		...readyPolicy(),
		{
			extendedWaitUntil: {
				visible: { text: copy("mobile.account_routing.saved") },
				timeout: 15000,
			},
		},
		{
			assertVisible: {
				id: accountRoutingChoiceId(value),
				selected: true,
			},
		},
		...firstSettled("confirmed-save"),
	];
}
export function reloadAfterUncertain(): NativeStep[] {
	return [
		...policyAnchor(),
		text(copy("mobile.account_routing.error")),
		{ assertNotVisible: { text: copy("mobile.account_routing.saved") } },
		text(copy("mobile.account_routing.reload")),
		...firstSettled("unconfirmed-committed"),
		...reloadPolicy(),
	];
}
// Maestro -e substitution needs the literal ${RELAY_*} spellings; string
// concatenation keeps the identical bytes without claiming TS interpolation.
export function switchComputer(): NativeStep[] {
	// Edit the REAL saved route. It retains the consent obtained by the public
	// initial helper; toggling the opt-in again would turn that consent OFF.
	return [
		scroll(REGION.settingsConnection, "UP"),
		scroll(CONTROL.settingsTunnelEdit),
		tap(CONTROL.settingsTunnelEdit),
		scroll(CONTROL.customUrlField),
		tap(CONTROL.customUrlField),
		{ eraseText: 200 },
		{ inputText: "$" + "{RELAY_URL}" },
		{ hideKeyboard: true },
		scroll(CONTROL.customPasswordField),
		tap(CONTROL.customPasswordField),
		{ eraseText: 200 },
		{ inputText: "$" + "{RELAY_PASSWORD}" },
		{ hideKeyboard: true },
		scroll(CONTROL.ownTunnelTest),
		tap(CONTROL.ownTunnelTest),
		{ extendedWaitUntil: { visible: { text: "Connected" }, timeout: 15000 } },
		scroll(CONTROL.customConnect),
		tap(CONTROL.customConnect),
		wait(SCREEN.settings),
	];
}
export function removeRoute(): NativeStep[] {
	return [
		scroll(REGION.settingsConnection, "UP"),
		scroll(CONTROL.settingsTunnelRemove),
		tap(CONTROL.settingsTunnelRemove),
		{
			extendedWaitUntil: {
				visible: { text: "Remove this tunnel?" },
				timeout: 15000,
			},
		},
		tap(CONTROL.dialogConfirm),
		...policyAnchor(),
		text(copy("mobile.account_routing.disconnected")),
		...firstSettled("empty-disconnected"),
	];
}
export function policyMessage(
	key: "loading" | "unavailable" | "load_error" | "rejected",
): NativeStep[] {
	return [
		...policyAnchor(),
		text(copy(`mobile.account_routing.${key}`)),
		...firstSettled(key),
	];
}
export function selected(value: string): NativeStep[] {
	return [
		...readyPolicy(),
		{
			assertVisible: {
				id: accountRoutingChoiceId(value),
				selected: true,
			},
		},
	];
}
export function reconnectRemoved(): NativeStep[] {
	return [
		scroll(REGION.settingsConnection, "UP"),
		scroll(CONTROL.ownTunnelPathAction),
		tap(CONTROL.ownTunnelPathAction),
		scroll(CONTROL.customUrlField),
		tap(CONTROL.customUrlField),
		{ inputText: "$" + "{RELAY_URL}" },
		{ hideKeyboard: true },
		scroll(CONTROL.customPasswordField),
		tap(CONTROL.customPasswordField),
		{ inputText: "$" + "{RELAY_PASSWORD}" },
		{ hideKeyboard: true },
		scroll(CONTROL.customInsecureOptIn),
		tap(CONTROL.customInsecureOptIn),
		scroll(CONTROL.ownTunnelTest),
		tap(CONTROL.ownTunnelTest),
		{ extendedWaitUntil: { visible: { text: "Connected" }, timeout: 15000 } },
		scroll(CONTROL.customConnect),
		tap(CONTROL.customConnect),
		...readyPolicy(),
	];
}
export function scaled(): NativeStep[] {
	return [
		scroll(REGION.settingsConnection, "UP"),
		scroll(CONTROL.settingsTextScale200),
		tap(CONTROL.settingsTextScale200),
		...policyAnchor(),
		...firstSettled("after-text-scale-200"),
	];
}
