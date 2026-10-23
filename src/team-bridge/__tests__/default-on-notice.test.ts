import { readFileSync } from "node:fs";
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

import {
	CONSENT_V2,
	OTHER_TENANT,
	SELF,
	settings,
	status,
	TENANT,
} from "./fixtures";

/**
 * `Button` pulls in `uniwind` (native CSS variables), which Node cannot load, and
 * the view's structure -- which controls exist, what they are labelled -- is what
 * this file asserts, not how a Button paints. The stand-in renders a plain
 * `role="button"` element carrying the same label, testID and disabled state, so
 * the "no Enable control, exactly three buttons" assertions read real markup.
 */
vi.mock("@/ui/components/button", () => ({
	Button: (props: {
		label: string;
		accessibilityLabel?: string;
		testID?: string;
		disabled?: boolean;
	}) =>
		h("div", {
			role: "button",
			"aria-label": props.accessibilityLabel ?? props.label,
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
		turnOff: vi.fn(async () => undefined),
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

	it.each(["server", "plan", "sign_in"] as const)(
		"stays quiet without changing the gate when settings fails with %s",
		async (kind) => {
			const { store } = await mount(
				hubWith({
					settings: vi.fn(async () => {
						throw new HubError({ kind, message: "x", status: 500 });
					}),
				} as never),
			);
			expect(store.getState().defaultOnNotice).toBeNull();
			expect(store.getState().gate).toBe("open");
		},
	);

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

	it.each([JSON.stringify({ msg: "ok", result: null }), "not JSON"])(
		"Turn off uses its bearer and dismisses on 2xx regardless of body %s",
		async (body) => {
			const fetchImpl = vi.fn(
				async (_url: string | URL | Request, _init?: RequestInit) =>
					new Response(body, {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
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
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer tok",
			);
			expect(JSON.parse(String(init?.body))).toEqual({
				state: "disabled",
				tenant_id: TENANT,
			});
			expect(made.store.getState().defaultOnNotice).toBeNull();
			expect(dismissals.rows.size).toBe(1);
			expect(made.store.getState().defaultOnNoticeBusy).toBe(false);
		},
	);

	it.each(["ineligible", "missing consent"])(
		"does not show for %s through the store",
		async (reason) => {
			const { store } = await mount(
				hubWith({
					status: vi.fn(async () =>
						status({
							consent: CONSENT_V2,
							tenants: status().tenants.map((t) => ({
								...t,
								eligible: reason !== "ineligible",
							})),
						}),
					),
					settings: vi.fn(async () =>
						reason === "missing consent"
							? { endpoint: { state: "active" } }
							: settings("default_on"),
					),
				}),
			);
			expect(store.getState().defaultOnNotice).toBeNull();
		},
	);

	it("guards a double tap while the PUT is pending", async () => {
		let finish!: () => void;
		const turnOff = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const made = await mount(hubWith({ turnOff }));
		const pending = made.actions.turnOffDefaultOn();
		await made.actions.turnOffDefaultOn();
		expect(turnOff).toHaveBeenCalledTimes(1);
		expect(made.store.getState().defaultOnNoticeBusy).toBe(true);
		finish();
		await pending;
		expect(made.store.getState().defaultOnNoticeBusy).toBe(false);
	});

	it.each([false, true])(
		"keeps the other org notice untouched when a pending PUT fails=%s",
		async (fails) => {
			let finish!: () => void;
			let refuse!: (error: unknown) => void;
			const turnOff = vi.fn(
				() =>
					new Promise<void>((resolve, reject) => {
						finish = resolve;
						refuse = reject;
					}),
			);
			const dismissals = memoryDismissals();
			const made = await mount(
				hubWith({
					turnOff,
					status: vi.fn(async () =>
						status({
							consent: CONSENT_V2,
							tenants: [
								...status().tenants,
								...status().tenants.map((t) => ({
									...t,
									tenant_id: OTHER_TENANT,
								})),
							],
						}),
					),
				}),
				dismissals,
			);
			const pending = made.actions.turnOffDefaultOn();
			made.actions.selectOrganization(OTHER_TENANT);
			await made.actions.loadDefaultOnNotice(OTHER_TENANT);
			const otherNotice = made.store.getState().defaultOnNotice;
			expect(otherNotice?.tenantId).toBe(OTHER_TENANT);
			expect(made.store.getState().defaultOnNoticeBusy).toBe(false);
			if (fails) refuse(new HubError({ kind: "server", message: "x" }));
			else finish();
			await pending;
			expect(made.store.getState().defaultOnNotice).toBe(otherNotice);
			expect(made.store.getState().defaultOnNoticeError).toBeNull();
			expect([...dismissals.rows]).toEqual(fails ? [] : [`${SELF}|${TENANT}`]);
		},
	);

	it("does not revive or persist a notice after sign-out mid-flight", async () => {
		let finish!: () => void;
		const dismissals = memoryDismissals();
		const made = await mount(
			hubWith({
				turnOff: () =>
					new Promise<void>((resolve) => {
						finish = resolve;
					}),
			}),
			dismissals,
		);
		const pending = made.actions.turnOffDefaultOn();
		made.actions.reset();
		finish();
		await pending;
		expect(made.store.getState().defaultOnNotice).toBeNull();
		expect(made.store.getState().defaultOnNoticeBusy).toBe(false);
		expect(dismissals.rows.size).toBe(0);
	});

	it("clears busy when a plan gate retires a pending PUT", async () => {
		let finish!: () => void;
		const hub = hubWith({
			turnOff: () =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		});
		const made = await mount(hub);
		const pending = made.actions.turnOffDefaultOn();
		vi.mocked(hub.status).mockRejectedValueOnce(
			new HubError({ kind: "plan", message: "x" }),
		);
		await made.actions.checkStatus();
		finish();
		await pending;
		expect(made.store.getState().gate).toBe("plan_required");
		expect(made.store.getState().defaultOnNoticeBusy).toBe(false);
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

const RAW_TEXT = /<Text\b[^>]*>\s*\p{L}[^<{]*<\/Text>/u;
const RAW_TEXT_EXPRESSION =
	/<Text\b[^>]*>\s*\{\s*(?:"[^"]*"|'[^']*'|`[^`$]*`)\s*\}\s*<\/Text>/;
const LITERAL_LABEL =
	/\b(?:label|accessibilityLabel|accessibilityHint|placeholder|title)\s*=\s*(?:"[^"]+"|'[^']+'|\{\s*(?:["'][^"']+["']|`[^`$]*`)\s*\})/;
const ENABLE_CONTROL = /enable|turn on|opt in/i;
const ENABLE = /\benable\b/i;
const DIALOG = /role="(dialog|alertdialog)"/;
const MODAL = /aria-modal/;
const COPY_PREFIX = /^mobile\.team_bridge\.default_on\./;
const STATUS_REGION = /role="status"[^>]*>([\s\S]*?)<\/div>/;

// Feature-scoped lexical guard, not a TSX parser or native accessibility audit.
const componentSource = readFileSync(
	new URL("../../features/team-bridge/default-on-notice.tsx", import.meta.url),
	"utf8",
);
function assertFeatureCopy(input: string) {
	const source = input.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	if (RAW_TEXT.test(source) || RAW_TEXT_EXPRESSION.test(source))
		throw new Error("raw JSX copy");
	if (LITERAL_LABEL.test(source)) throw new Error("literal accessible copy");
	for (const match of source.matchAll(
		/["'](mobile\.team_bridge\.default_on\.[a-z_]+)["']/g,
	)) {
		if (
			match[1] === undefined ||
			!Object.hasOwn(DEFAULT_ON_NOTICE_COPY, match[1])
		)
			throw new Error("missing source key");
	}
}

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
		expect(html).not.toMatch(ENABLE);
		expect(html).not.toMatch(DIALOG);
		expect(html).not.toMatch(MODAL);
		const buttons = [
			...html.matchAll(/role="button"[^>]*aria-label="([^"]*)"/g),
		].map((m) => m[1]);
		expect(buttons.some((label) => ENABLE_CONTROL.test(label ?? ""))).toBe(
			false,
		);
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
		expect(open).not.toMatch(DIALOG);
	});
	it("shows an error and keeps every control when Turn off failed", () => {
		const failed = rendered({ failed: true });
		expect(failed).toContain('data-testid="team-bridge-notice-error"');
		expect(failed).toContain('data-testid="team-bridge-notice-turn-off"');
	});
	it("copy table owns namespaced keys with translator context", () => {
		for (const [key, row] of Object.entries(DEFAULT_ON_NOTICE_COPY)) {
			expect(key).toMatch(COPY_PREFIX);
			expect(row.context.length).toBeGreaterThan(20);
		}
	});
	it("keeps opt-out controls before expanded text and outside its status region", () => {
		const open = rendered({ expanded: true, failed: true });
		expect(
			open.indexOf('data-testid="team-bridge-notice-turn-off"'),
		).toBeLessThan(open.indexOf('data-testid="team-bridge-notice-text"'));
		const statusRegion = open.match(STATUS_REGION)?.[1];
		expect(statusRegion).toBeDefined();
		expect(statusRegion).not.toContain("team-bridge-notice-text");
		expect(statusRegion).not.toContain("team-bridge-notice-error");
		expect(open).toContain('aria-label="Dismiss Team Bridge notice"');
	});

	it("routes rendered copy through the source table", () => {
		expect(() => assertFeatureCopy(componentSource)).not.toThrow();
	});
	it.each([
		"<Text>Untracked text</Text>",
		'<Text>{"Untracked text"}</Text>',
		"<Text>{'Untracked text'}</Text>",
		"<Text>{`Untracked text`}</Text>",
		'<Button label="Untracked label" />',
		'<Button accessibilityLabel={"Untracked label"} />',
		"<Button accessibilityHint={`Untracked hint`} />",
	])("rejects raw-copy counterfactual %s", (raw) => {
		const changed = componentSource.replace(
			'{copy("mobile.team_bridge.default_on.title")}',
			raw,
		);
		expect(changed).not.toBe(componentSource);
		expect(() => assertFeatureCopy(changed)).toThrow();
	});
});
