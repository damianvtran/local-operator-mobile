import { accountRoutingCopy as copy } from "../../src/features/settings/account-routing-copy.ts";
import { CONTROL, REGION, SCREEN } from "../../src/ui/a11y.ts";

export type NativeStep = Record<string, unknown>;
const wait = (id: string): NativeStep => ({
	extendedWaitUntil: { visible: { id }, timeout: 15000 },
});
const tap = (id: string): NativeStep => ({ tapOn: { id } });
const scroll = (id: string, direction = "DOWN"): NativeStep => ({
	scrollUntilVisible: { element: { id }, direction, timeout: 15000 },
});
const text = (value: string): NativeStep => ({
	extendedWaitUntil: { visible: { text: value }, timeout: 15000 },
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
		tap(`${CONTROL.settingsAccountRoutingGroup}:${value}`),
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
				id: `${CONTROL.settingsAccountRoutingGroup}:${value}`,
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
				id: `${CONTROL.settingsAccountRoutingGroup}:${value}`,
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
