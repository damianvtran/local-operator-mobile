import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DefaultOnNoticeView } from "@/features/team-bridge/default-on-notice";
import {
	DEFAULT_ON_NOTICE_COPY,
	defaultOnNoticeCopy,
} from "@/features/team-bridge/default-on-notice-copy";
import {
	createHubClient,
	type HubClient,
	HubError,
} from "@/team-bridge/client";
import { settingsSchema, statusSchema } from "@/team-bridge/contract";
import { defaultOnNoticeFor } from "@/team-bridge/model";
import {
	createTeamBridgeStore,
	type NoticeDismissals,
} from "@/team-bridge/store";

import { CONSENT_V2, SELF, settings, status, TENANT } from "./fixtures";

/**
 * `Button` pulls in `uniwind` (native CSS variables), which Node cannot load, and
 * the view's structure -- which controls exist, what they are labelled -- is what
 * this file asserts, not how a Button paints. The stand-in renders a plain
 * `role="button"` element carrying the same label, testID and disabled state, so
 * the "no Enable control, exactly three buttons" assertions read real markup.
 */
vi.mock("@/ui/components/button", () => ({
	Button: (props: { label: string; testID?: string; disabled?: boolean }) =>
		h("div", {
			role: "button",
			"aria-label": props.label,
			"data-testid": props.testID,
			"aria-disabled": props.disabled ? "true" : undefined,
		}),
}));

const token = (sub: string) =>
	`h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

/** A durable stand-in for the device store: shared across "remounts" (new stores). */
function memoryDismissals(): NoticeDismissals & { rows: Set<string> } {
	const rows = new Set<string>();
	return {
		rows,
		has: async (a, t) => rows.has(`${a}|${t}`),
		set: async (a, t) => {
			rows.add(`${a}|${t}`);
		},
	};
}

function hubWith(over: Partial<HubClient> = {}): HubClient {
	return {
		status: vi.fn(async () => status({ consent: CONSENT_V2 })),
		settings: vi.fn(async () => settings("default_on")),
		turnOff: vi.fn(async () => settings("default_on", { state: "disabled" })),
		accountUnread: vi.fn(async () => ({ total: 0, organizations: [] })),
		...over,
	} as unknown as HubClient;
}

async function mount(
	hub: HubClient,
	dismissals: NoticeDismissals | undefined = memoryDismissals(),
) {
	const made = createTeamBridgeStore({
		hub: () => hub,
		accessToken: async () => token(SELF),
		dismissals,
	});
	await made.actions.checkStatus();
	await made.actions.loadDefaultOnNotice(TENANT);
	return made;
}

describe("default-on notice decision", () => {
	const served = { version: "bridge_consent_v2", text: "T" };
	const base = {
		tenantId: TENANT,
		eligible: true,
		settings: settings("default_on"),
		served,
	};
	it("applies to an eligible, active, current default_on endpoint", () => {
		expect(defaultOnNoticeFor(base)).toEqual({
			tenantId: TENANT,
			version: "bridge_consent_v2",
			text: "T",
		});
	});
	it.each([
		["dialog", settings("dialog")],
		["settings", settings("settings")],
		["an unknown future provenance", settings("on_by_robot")],
		[
			"a v1-era endpoint",
			settings("settings", { version: "bridge_consent_v1" }),
		],
		["a paused endpoint", settings("default_on", { state: "paused" })],
		["a disabled endpoint", settings("default_on", { state: "disabled" })],
		[
			"a consent that no longer counts",
			settings("default_on", { current: false }),
		],
		[
			"a record on another version than the served text",
			settings("default_on", { version: "bridge_consent_v1" }),
		],
		["no endpoint", { endpoint: null }],
	])("never applies to %s", (_name, s) => {
		expect(defaultOnNoticeFor({ ...base, settings: s })).toBeNull();
	});
	it("never applies without served text or in an ineligible organization", () => {
		expect(defaultOnNoticeFor({ ...base, served: null })).toBeNull();
		expect(defaultOnNoticeFor({ ...base, eligible: false })).toBeNull();
	});
});

describe("tolerant parsing", () => {
	it("keeps an unknown consented_via and ignores a malformed consent block", () => {
		expect(
			settingsSchema.parse({
				endpoint: {
					state: "active",
					consent: { consented_via: "x_new" },
					extra: 1,
				},
			}).endpoint?.consent?.consented_via,
		).toBe("x_new");
		const parsed = statusSchema.parse({
			api_version: "1",
			available: true,
			tenants: [],
			consent: { version: 2 },
		});
		expect(parsed.consent).toBeUndefined();
	});
});

describe("default-on notice store", () => {
	it("shows once for default_on + active + undismissed, with the served text", async () => {
		const { store } = await mount(hubWith());
		expect(store.getState().defaultOnNotice).toEqual({
			tenantId: TENANT,
			version: "bridge_consent_v2",
			text: CONSENT_V2.text,
		});
	});

	it("only reads on load: nothing is written at enrolment or mount", async () => {
		const hub = hubWith();
		await mount(hub);
		expect(hub.turnOff).not.toHaveBeenCalled();
	});

	it("stays away for dialog/settings provenance and for a status without consent", async () => {
		for (const via of ["dialog", "settings"]) {
			const { store } = await mount(
				hubWith({ settings: vi.fn(async () => settings(via)) } as never),
			);
			expect(store.getState().defaultOnNotice).toBeNull();
		}
		const { store } = await mount(
			hubWith({ status: vi.fn(async () => status()) } as never),
		);
		expect(store.getState().defaultOnNotice).toBeNull();
	});

	it("stays quiet when the settings read fails", async () => {
		const { store } = await mount(
			hubWith({
				settings: vi.fn(async () => {
					throw new HubError({ kind: "server", message: "x", status: 500 });
				}),
			} as never),
		);
		expect(store.getState().defaultOnNotice).toBeNull();
	});

	it("never shows without a dismissal store (cannot promise once)", async () => {
		// null, not undefined: undefined would trigger mount()'s default parameter and supply a store.
		const { store } = await mount(hubWith(), null as never);
		expect(store.getState().defaultOnNotice).toBeNull();
	});

	it("dismissal persists across a remount (a new store over the same device storage)", async () => {
		const dismissals = memoryDismissals();
		const first = await mount(hubWith(), dismissals);
		expect(first.store.getState().defaultOnNotice).not.toBeNull();
		await first.actions.dismissDefaultOnNotice();
		expect(first.store.getState().defaultOnNotice).toBeNull();
		const again = await mount(hubWith(), dismissals);
		expect(again.store.getState().defaultOnNotice).toBeNull();
	});

	it("keys the dismissal by account and organization", async () => {
		const dismissals = memoryDismissals();
		const a = await mount(hubWith(), dismissals);
		await a.actions.dismissDefaultOnNotice();
		expect([...dismissals.rows]).toEqual([`${SELF}|${TENANT}`]);
	});

	it("Turn off sends state disabled alone, then dismisses for good", async () => {
		const fetchImpl = vi.fn(
			async (_url: string | URL | Request, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						msg: "ok",
						result: settings("default_on", { state: "disabled" }),
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
		);
		const real = createHubClient({
			accessToken: async () => "tok",
			fetchImpl: fetchImpl as never,
			baseUrl: "https://hub.example",
		});
		const dismissals = memoryDismissals();
		const made = await mount(
			{ ...hubWith(), turnOff: real.turnOff } as HubClient,
			dismissals,
		);
		await made.actions.turnOffDefaultOn();
		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(String(url)).toBe("https://hub.example/v1/messaging/settings");
		expect(init?.method).toBe("PUT");
		expect(JSON.parse(String(init?.body))).toEqual({
			state: "disabled",
			tenant_id: TENANT,
		});
		expect(made.store.getState().defaultOnNotice).toBeNull();
		expect(dismissals.rows.size).toBe(1);
	});

	it("a hub error on Turn off keeps the notice, shows an error, and does not dismiss", async () => {
		const dismissals = memoryDismissals();
		const made = await mount(
			hubWith({
				turnOff: vi.fn(async () => {
					throw new HubError({
						kind: "unavailable",
						message: "x",
						status: 503,
					});
				}),
			} as never),
			dismissals,
		);
		await made.actions.turnOffDefaultOn();
		const s = made.store.getState();
		expect(s.defaultOnNotice).not.toBeNull();
		expect(s.defaultOnNoticeError?.kind).toBe("unavailable");
		expect(s.defaultOnNoticeBusy).toBe(false);
		expect(dismissals.rows.size).toBe(0);
	});
});

const rendered = (opts: { failed?: boolean; expanded?: boolean } = {}) =>
	renderToStaticMarkup(
		h(DefaultOnNoticeView as never, {
			notice: {
				tenantId: TENANT,
				version: "bridge_consent_v2",
				text: CONSENT_V2.text,
			},
			failed: opts.failed ?? false,
			defaultExpanded: opts.expanded ?? false,
			busy: false,
			onTurnOff: () => undefined,
			onDismiss: () => undefined,
		}),
	);

describe("default-on notice view", () => {
	const html = rendered();
	it("names the state, offers Turn off / Read / Dismiss", () => {
		expect(html).toContain(
			defaultOnNoticeCopy("mobile.team_bridge.default_on.title"),
		);
		for (const id of ["turn-off", "read", "dismiss"]) {
			expect(html).toContain(`data-testid="team-bridge-notice-${id}"`);
		}
	});
	it("renders no Enable control and no dialog/modal semantics", () => {
		expect(html).not.toMatch(/\benable\b/i);
		expect(html).not.toMatch(/role="(dialog|alertdialog)"/);
		expect(html).not.toMatch(/aria-modal/);
		const buttons = [
			...html.matchAll(/role="button"[^>]*aria-label="([^"]*)"/g),
		].map((m) => m[1]);
		expect(
			buttons.some((label) => /enable|turn on|opt in/i.test(label ?? "")),
		).toBe(false);
		expect(buttons).toHaveLength(3);
	});
	it("holds the consent text back until Read what this means", () => {
		expect(html).not.toContain("Example consent text");
	});
	it("shows the served consent text verbatim, in place, once expanded", () => {
		const open = rendered({ expanded: true });
		expect(open).toContain('data-testid="team-bridge-notice-text"');
		// Verbatim: the served bytes survive (react-dom only HTML-escapes them).
		expect(open).toContain(
			"Example consent text, line one.\nLine two: shown exactly as served.",
		);
		expect(open).toContain(
			defaultOnNoticeCopy("mobile.team_bridge.default_on.hide"),
		);
		expect(open).not.toMatch(/role="(dialog|alertdialog)"/);
	});
	it("shows an error and keeps every control when Turn off failed", () => {
		const failed = rendered({ failed: true });
		expect(failed).toContain('data-testid="team-bridge-notice-error"');
		expect(failed).toContain('data-testid="team-bridge-notice-turn-off"');
	});
	it("copy table has translator context for every key and no key is a bare literal", () => {
		for (const [key, row] of Object.entries(DEFAULT_ON_NOTICE_COPY)) {
			expect(key).toMatch(/^mobile\.team_bridge\.default_on\./);
			expect(row.context.length).toBeGreaterThan(20);
		}
	});
});
