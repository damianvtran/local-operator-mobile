import { afterEach, describe, expect, it } from "vitest";

import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import {
	card,
	nonTeamStatus,
	org,
	status,
	TENANT,
	waitingOrg,
} from "./guard-fixtures";
import {
	allDescribable,
	consentView,
	guardEnabled,
	indicatorFor,
	nonTeamView,
	orgActions,
	outcomeLine,
	pendingPrompts,
	promptReasonLine,
	revokeBody,
	safeTeamUrl,
	visibilityLine,
} from "./guard-model";

const en = (key: Parameters<typeof renderFor>[0], params = {}) =>
	renderFor(key, params, "en");

afterEach(() => resetLocaleSource());

describe("guardEnabled: the capability gate", () => {
	it.each([
		[{}, false],
		[{ features: {} }, false],
		[{ features: { guard: false } }, false],
		[{ features: { guard: 0 } }, false],
		[{ features: { guard: "" } }, false],
		[{ features: { guard: "0" } }, false],
		[{ features: { guard: null } }, false],
		[{ features: { guard: 1 } }, true],
		[{ features: { guard: true } }, true],
	])("%j → %s", (capabilities, expected) => {
		expect(guardEnabled(capabilities as never)).toBe(expected);
	});
	it("is not satisfied by the notifications flag", () => {
		expect(guardEnabled({ features: { notifications: 1 } } as never)).toBe(
			false,
		);
	});
});

describe("indicator: the host's state in plain words, never the enum", () => {
	const cases: [string, Partial<ReturnType<typeof org>>, string][] = [
		["sharing", { state: "sharing" }, "Guard: sharing with Example Org"],
		[
			"sharing_pending is NOT paused",
			{ state: "sharing_pending" },
			"Guard: sharing with Example Org · new items waiting for your choice",
		],
		[
			"waiting",
			{ state: "waiting" },
			"Guard: Example Org is waiting for your choice",
		],
		[
			"not_sharing",
			{ state: "not_sharing" },
			"Guard: not sharing with Example Org",
		],
		[
			"will_ask",
			{ state: "will_ask" },
			"Guard: Example Org will ask you again soon",
		],
		[
			"entitlement_lapsed",
			{ state: "paused", reason: "entitlement_lapsed" },
			"Guard: paused, Team plan inactive",
		],
		[
			"org_off",
			{ state: "paused", reason: "org_off" },
			"Guard: paused, turned off by Example Org",
		],
		[
			"membership_ended",
			{ state: "paused", reason: "membership_ended" },
			"Guard: paused, you're no longer in Example Org",
		],
		[
			"scope_revoked",
			{ state: "paused", reason: "scope_revoked" },
			"Guard: paused, you stopped sharing",
		],
		[
			"revoke_pending",
			{ state: "paused", reason: "revoke_pending" },
			"Guard: paused, will stop once Radient confirms",
		],
		[
			"unknown pause reason → plain paused",
			{ state: "paused", reason: "something_new" },
			"Guard: paused",
		],
		[
			"unknown state → claims nothing",
			{ state: "teleported" },
			"Guard: status isn’t available here",
		],
	];
	for (const [name, over, expected] of cases) {
		it(name, () => {
			setLocaleSource(() => "en");
			expect(indicatorFor(org(over))).toBe(expected);
		});
	}
	it("a Console stop names its date, a dateless one still says it was a stop", () => {
		setLocaleSource(() => "en");
		const since = Date.UTC(2026, 10, 16, 12) / 1000;
		expect(
			indicatorFor(org({ state: "paused", reason: "console_revoked", since })),
		).toMatch(/^Guard: paused, you stopped sharing from Console on Nov 1[56]$/);
		expect(
			indicatorFor(
				org({ state: "paused", reason: "console_revoked", since: null }),
			),
		).toBe("Guard: paused, you stopped sharing");
	});
});

describe("actions come only from the host's predicates", () => {
	it("a waiting request offers Review, not Stop", () => {
		expect(orgActions(waitingOrg())).toEqual(["review"]);
	});
	it("sharing offers Stop; a stopped org offers Share again", () => {
		expect(orgActions(org())).toEqual(["stop"]);
		expect(
			orgActions(
				org({ state: "not_sharing", can_revoke: false, can_share_again: true }),
			),
		).toEqual(["share_again"]);
	});
	it("a host that cannot answer (can_share_again false) offers nothing to start", () => {
		expect(
			orgActions(
				org({
					state: "not_sharing",
					can_revoke: false,
					can_share_again: false,
				}),
			),
		).toEqual([]);
	});
	it("pendingPrompts lists exactly the orgs with a request", () => {
		const s = status({ orgs: [org(), waitingOrg({ tenant: "t2" })] });
		expect(pendingPrompts(s).map((o) => o.tenant)).toEqual(["t2"]);
	});
});

describe("the consent card (RFC §15.4' C4)", () => {
	it("first grant: title, reason, per-scope lines, buttons in RFC order", () => {
		setLocaleSource(() => "en");
		const view = consentView(card());
		expect(view.title).toBe("Share Guard stats with Example Org?");
		expect(view.reasonLine).toBe("Example Org turned on Radient Guard.");
		expect(view.scopeLines).toHaveLength(4);
		expect(view.scopeLines[0]).toMatch(/^Guardrail results:/);
		expect(view.neverSent).toMatch(/^Never sent: file paths/);
		expect(view.declineLabel).toBe("Don't share");
		expect(view.laterLabel).toBe("Decide later");
		expect(view.shareLabel).toBe("Share");
		expect(view.answerable).toBe(true);
	});
	it("widening: Keep current / Share the new items, and the reason names what is added", () => {
		setLocaleSource(() => "en");
		const view = consentView(
			card({
				reason: "widened",
				widening: true,
				asked_scopes: ["task_time", "review_cycles"],
			}),
		);
		expect(view.declineLabel).toBe("Keep current");
		expect(view.shareLabel).toBe("Share the new items");
		expect(view.reasonLine).toContain("task time and review rounds");
		expect(view.reasonLine).toContain(
			"keeps sharing only what you already agreed to",
		);
	});
	it("every reason has its RFC line; an unknown reason has none but the card still says what is asked", () => {
		setLocaleSource(() => "en");
		for (const reason of [
			"new_org",
			"widened",
			"reactivated",
			"plan_gap",
			"new_device",
			"rejoined",
		])
			expect(promptReasonLine(reason, "Example Org", ["task_time"])).toEqual(
				expect.stringMatching(/\S/),
			);
		expect(promptReasonLine("from_the_future", "Example Org", [])).toBeNull();
		expect(
			consentView(card({ reason: "from_the_future" })).scopeLines.length,
		).toBe(4);
	});
	it("visibility has the RFC's four variants", () => {
		setLocaleSource(() => "en");
		expect(visibilityLine(["decisions"])).toBe(
			"Admins see totals only when at least 5 people contributed, never your own numbers.",
		);
		expect(visibilityLine(["posture"])).toContain(
			"setup-check estimates only when at least 20",
		);
		expect(visibilityLine(["admin_share"])).toContain(
			"step-by-step timing shared",
		);
		expect(visibilityLine(["posture", "admin_share"])).toMatch(
			/estimates only when at least 20 did\. With step-by-step timing/,
		);
	});
	it("NEGATIVE: a scope this build cannot describe, an unsignable card or an empty ask is unanswerable", () => {
		expect(allDescribable(["decisions", "quantum_scope"])).toBe(false);
		expect(
			consentView(card({ asked_scopes: ["decisions", "quantum_scope"] }))
				.answerable,
		).toBe(false);
		expect(consentView(card({ signable: false })).answerable).toBe(false);
		expect(consentView(card({ asked_scopes: [] })).answerable).toBe(false);
	});
	it("is localised: the French card carries the audited core wording", () => {
		const fr = renderFor("mobile.guard.button_dont_share", {}, "fr");
		expect(fr).not.toBe(en("mobile.guard.button_dont_share"));
		expect(fr).toMatch(/\S/);
	});
});

describe("stop sharing confirm (RFC §15.4' C2)", () => {
	it("states the backup window only when trace detail is shared AND the host measured it", () => {
		setLocaleSource(() => "en");
		const traced = org({ scopes_shared: ["decisions", "trace_detail"] });
		expect(revokeBody(traced, 31)).toBe(
			"Guard stops sending from all your computers now and deletes your step-by-step timing. Copies in backups are gone within 31 days.",
		);
		// not measured: the sentence cannot be written, so the plain one stands
		expect(revokeBody(traced, null)).toBe(
			"Guard stops sending from all your computers now.",
		);
		// no trace detail shared: the plain sentence, whatever the backup window
		expect(revokeBody(org(), 31)).toBe(
			"Guard stops sending from all your computers now.",
		);
	});
	it("never hardcodes the number: the value is the host's", () => {
		setLocaleSource(() => "en");
		const traced = org({ scopes_shared: ["trace_detail"] });
		expect(revokeBody(traced, 45)).toContain("within 45 days");
	});
});

describe("non-Team card (§14')", () => {
	const url = "https://console.radienthq.com/dashboard/team";
	it("owner with an eligible trial: the trial CTA from trial_days, never a literal", () => {
		setLocaleSource(() => "en");
		const view = nonTeamView(nonTeamStatus(), {
			trial_days: 14,
			org: null,
			url,
			role: "owner",
		});
		expect(view?.ctaLabel).toBe("Start 14-day free trial");
		expect(view?.cta).toBe("trial");
		expect(view?.footer).toBe("Nothing is collected from this account.");
	});
	it("owner, not eligible: See Radient Team", () => {
		setLocaleSource(() => "en");
		const view = nonTeamView(nonTeamStatus(), {
			trial_days: null,
			org: "Acme",
			url,
			role: "owner",
		});
		expect(view?.cta).toBe("see");
		expect(view?.ctaLabel).toBe("See Radient Team");
		expect(view?.footer).toBe("Guard collects nothing for Acme.");
	});
	it("a non-positive trial length falls back to See Radient Team", () => {
		setLocaleSource(() => "en");
		for (const trial_days of [0, -3])
			expect(
				nonTeamView(nonTeamStatus(), {
					trial_days,
					org: null,
					url,
					role: "owner",
				})?.cta,
			).toBe("see");
	});
	it("admin: ask your owner, and no link at all", () => {
		const view = nonTeamView(nonTeamStatus(), {
			trial_days: 14,
			org: null,
			url,
			role: "admin",
		});
		expect(view?.cta).toBe("ask_owner");
		expect(view?.url).toBeNull();
		expect(view?.ctaLabel).toBeNull();
	});
	it("member: nothing", () => {
		expect(
			nonTeamView(nonTeamStatus(), {
				trial_days: 14,
				org: null,
				url,
				role: "member",
			}),
		).toBeNull();
	});
	it("role not stated (a host without the optional field): the core TUI's card with its CTA", () => {
		const view = nonTeamView(nonTeamStatus(), {
			trial_days: null,
			org: null,
			url,
		});
		expect(view?.cta).toBe("see");
	});
	it("a Team account never renders the card", () => {
		expect(nonTeamView(status(), null)).toBeNull();
		expect(nonTeamView(status({ mode: "none", orgs: [] }), null)).toBeNull();
	});
	it("only first-party https URLs are ever opened", () => {
		expect(safeTeamUrl(url)).toBe(url);
		for (const bad of [
			"http://console.radienthq.com/x",
			"https://evil.example.com/",
			"https://radienthq.com.evil.example/",
			"javascript:alert(1)",
			"tel:123",
			"not a url",
			"",
			null,
		])
			expect(safeTeamUrl(bad as never)).toBeNull();
		const view = nonTeamView(nonTeamStatus(), {
			trial_days: 14,
			org: null,
			url: "https://evil.example.com/",
			role: "owner",
		});
		expect(view?.cta).toBe("none");
		expect(view?.url).toBeNull();
	});
});

describe("outcome sentences state what the host confirmed", () => {
	it("a stop the server has not confirmed is 'stopped on this computer'", () => {
		setLocaleSource(() => "en");
		expect(outcomeLine({ kind: "revoke_pending", org: "X" }).text).toMatch(
			/^Stopped on this computer\. Radient hasn’t confirmed yet/,
		);
		expect(outcomeLine({ kind: "revoked", org: "X" }).text).toBe(
			"Stopped sharing with X.",
		);
	});
	it("answered elsewhere names the surface; an unknown one still says elsewhere", () => {
		setLocaleSource(() => "en");
		expect(
			outcomeLine({ kind: "answered_elsewhere", surface: "desktop" }).text,
		).toBe("Answered on the desktop app");
		expect(
			outcomeLine({ kind: "answered_elsewhere", surface: "tui" }).text,
		).toBe("Answered on the terminal");
		expect(
			outcomeLine({ kind: "answered_elsewhere", surface: "toaster" }).text,
		).toBe("Answered on another device");
	});
	it("only a write that did not land is an error", () => {
		expect(outcomeLine({ kind: "failed", org: "X" }).tone).toBe("error");
		expect(outcomeLine({ kind: "changed", org: "X" }).tone).toBe("info");
		expect(outcomeLine({ kind: "shared", org: "X" }).tone).toBe("success");
	});
});

describe("fixtures stay honest", () => {
	it("the waiting org's tenant is the fixture tenant", () => {
		expect(waitingOrg().tenant).toBe(TENANT);
	});
});
