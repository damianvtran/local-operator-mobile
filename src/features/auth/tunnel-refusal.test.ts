import { describe, expect, it } from "vitest";
import { TunnelSessionError } from "@/connection/tunnel-session";
import { RelayError, relayErrorFromResponse } from "@/relay";
import {
	homeNamedRefusal,
	type RefusalComputer,
	type RefusalView,
	radientUnauthorizedSurface,
	radientUnreachableError,
	refusalFromError,
	transientCopy,
	tunnelSessionRelayError,
} from "./refusal";

const view = (
	failure: ConstructorParameters<typeof TunnelSessionError>[0],
	status?: number,
) => {
	const error = tunnelSessionRelayError(
		new TunnelSessionError(
			failure,
			"UNSAFE callback?code=PRIVATE&state=PRIVATE",
			status,
		),
	);
	return refusalFromError({
		error,
		surface: error.surface,
		detail: error.detail ?? null,
		retryAfterMs: null,
		subject: "Fixture computer",
	});
};
describe("tunnel ownership and app-side failure remedies", () => {
	it.each(["contract", "rejected"] as const)(
		"keeps %s errors in the app, with redacted support data",
		(failure) => {
			const refusal = view(failure);
			expect(refusal?.kind).toBe("diagnostic");
			expect(refusal?.remedy).toBeNull();
			expect(refusal?.detail).toBe(`TunnelSessionError · ${failure}`);
			expect(JSON.stringify(refusal)).not.toContain("PRIVATE");
			expect(JSON.stringify(refusal)).not.toContain("lop login");
		},
	);
	it.each([
		["billing", 402, "billing"],
		["disabled", 403, "status"],
		["harness", 404, "Local Operator"],
	] as const)(
		"gives %s a concrete console setting, never a machine login command",
		(failure, status, instruction) => {
			const refusal = view(failure, status);
			expect(refusal?.kind).toBe("console");
			expect(refusal?.remedy).toBeNull();
			if (refusal?.copy) {
				/* A named cause carries the console as a BUTTON and drops the mint's
				 *  own sentence ("this tunnel isn't active right now"), which Home's
				 *  Show details still printed (PR #261 Q2). */
				expect(refusal.detail).toBeNull();
				expect(refusal.copy.actions.map((item) => item.id)).toContain(
					"open-console",
				);
				return;
			}
			expect(refusal?.detail?.toLowerCase()).toContain(
				instruction.toLowerCase(),
			);
		},
	);
	it("does not invent device approval or direct an unavailable owner-scoped record to the console", () => {
		expect(view("account", 404)?.kind).toBe("account-mismatch");
		expect(view("account", 404)?.remedy).toBeNull();
		expect(view("oauth", 401)?.kind).toBe("sign-in");
	});
});

/* --- M1: no terminal outside "Using a terminal?" ------------------------------
 * The mint answers 403 for ANY non-active tunnel, so the split reads the chosen
 * computer's discovery row. Each row asserts the CAUSE and the buttons, and that
 * nothing the reader sees outside the disclosure names a `lop` command (the
 * teammate report: "tunnel isn't active" beside `lop login radient`). */
const row = (
	billing: Partial<RefusalComputer["billing"]>,
	rawStatus = "active",
): RefusalComputer => ({
	billing: { eligible: null, message: null, ...billing },
	rawStatus,
});
const minted = (
	computer: RefusalComputer | null,
	failure: "disabled" | "billing" | "network" | "unavailable" = "disabled",
): RefusalView | null => {
	const error = tunnelSessionRelayError(
		new TunnelSessionError(failure, "tunnel is unavailable", 403),
	);
	return refusalFromError({
		error,
		surface: error.surface,
		detail: error.detail ?? null,
		retryAfterMs: null,
		subject: "Studio Mac",
		computer,
	});
};
const visible = (refusal: RefusalView | null): string =>
	[
		refusal?.copy?.title,
		refusal?.copy?.body,
		refusal?.copy?.help,
		...(refusal?.copy?.actions.map((item) => item.label) ?? []),
	].join(" ");

describe("tunnel 403 split by the discovery row (M1)", () => {
	it.each([
		[
			row({ active: false, eligible: false }),
			"phone-access-off",
			["how-to", "open-billing", "retry"],
		],
		[
			row({ active: true, eligible: false }),
			"balance-out",
			["add-credit", "retry"],
		],
		[row({ eligible: false }), "balance-out", ["add-credit", "retry"]],
		[
			row({ active: true, eligible: true }, "suspended"),
			"suspended",
			["retry"],
		],
		[
			row({ active: true, eligible: true }, "disabled"),
			"console-disabled",
			["open-console", "retry"],
		],
		[row({ active: true, eligible: true }, "error"), "provisioning", ["retry"]],
		[
			row({ active: true, eligible: true }, "reconciling"),
			"provisioning",
			["retry"],
		],
		[row({}, "deleted"), "tunnel-gone", ["refresh-list"]],
		[row({}), "refused", ["open-console", "retry"]],
		[null, "refused", ["open-console", "retry"]],
	] as const)("%j → %s", (computer, cause, actions) => {
		const refusal = minted(computer);
		expect(refusal?.copy?.cause).toBe(cause);
		expect(refusal?.copy?.actions.map((item) => item.id)).toEqual(actions);
		expect(visible(refusal)).not.toMatch(/\blop\b/);
		expect(refusal?.remedy).toBeNull();
	});

	it("never takes the old 'tunnel isn't active' line as the copy", () => {
		expect(visible(minted(row({ active: false })))).not.toContain(
			"isn't active",
		);
	});

	it("names where to turn it on and that the price comes first (N2)", () => {
		const help = minted(row({ active: false }))?.copy?.help ?? "";
		/* The desktop's real path (U5): Phone access is a block inside
		 *  Settings → Radient account, not a Settings item of its own. */
		expect(help).toContain("Settings → Radient account → Phone access");
		expect(help).toContain("price first");
	});

	it("links billing actions to Radient billing, the console action to tunnels", () => {
		const off = minted(row({ active: false }))?.copy?.actions ?? [];
		expect(off.find((item) => item.id === "open-billing")).toMatchObject({
			url: "https://console.radienthq.com/dashboard/billing",
		});
		const disabled =
			minted(row({ active: true, eligible: true }, "disabled"))?.copy
				?.actions ?? [];
		expect(disabled[0]).toMatchObject({
			url: "https://console.radienthq.com/dashboard/tunnels",
		});
	});

	it.each(["network", "unavailable"] as const)(
		"reads a %s mint failure as Radient not responding, with Retry",
		(failure) => {
			const refusal = minted(null, failure);
			expect(refusal?.copy?.cause).toBe("radient-unreachable");
			expect(refusal?.copy?.title).toBe("Radient isn't responding right now.");
			expect(refusal?.copy?.actions.map((item) => item.id)).toEqual(["retry"]);
		},
	);
});

describe("relay surfaces: plain copy first, the command only behind the disclosure (D4)", () => {
	const fromSurface = (
		error: RelayError,
		computer: RefusalComputer | null = null,
	) =>
		refusalFromError({
			error,
			surface: error.surface,
			detail: null,
			retryAfterMs: null,
			subject: "Studio Mac",
			computer,
		});

	it.each([
		[
			"computer-offline",
			"computer-offline",
			"Studio Mac is asleep or offline.",
			["retry"],
			"lop tunnel status",
		],
		[
			"relay-down",
			"relay-stopped",
			"Local Operator isn't running on Studio Mac.",
			["retry"],
			"lop mobile",
		],
		[
			"unknown-tunnel",
			"tunnel-gone",
			"Phone access is turned off on Studio Mac.",
			["refresh-list"],
			"lop tunnel connect <tunnel-id>",
		],
	] as const)("%s → %s", (kind, cause, title, actions, command) => {
		const refusal = fromSurface(new RelayError(kind, "x"));
		expect(refusal?.copy?.cause).toBe(cause);
		expect(refusal?.copy?.title).toBe(title);
		expect(refusal?.copy?.actions.map((item) => item.id)).toEqual(actions);
		expect(visible(refusal)).not.toMatch(/\blop\b/);
		/* The bare command, for the disclosure's copyable block — no prose prefix. */
		expect(refusal?.remedy).toBe(command);
	});

	it("reads a relay 503 wait_* kind as a wait with Retry, never a bare spinner", () => {
		const error = relayErrorFromResponse({
			status: 503,
			header: () => "application/json",
			text: JSON.stringify({ kind: "wait_relay_starting" }),
		});
		const refusal = fromSurface(error);
		expect(refusal?.kind).toBe("retry");
		expect(refusal?.copy?.cause).toBe("relay-wait");
		expect(refusal?.copy?.actions.map((item) => item.id)).toEqual(["retry"]);
	});

	it("splits a gateway console refusal by the row, and keeps login behind the disclosure without one", () => {
		const refused = new RelayError("gateway-refused", "x", {
			surface: "console",
		});
		const split = fromSurface(refused, row({ active: true, eligible: false }));
		expect(split?.copy?.cause).toBe("balance-out");
		/* Billing causes carry no terminal disclosure (D6): `lop tunnel status`
		 *  only reads the state back, and the 403 split shows none either. */
		expect(split?.remedy).toBeNull();
		const suspended = fromSurface(
			refused,
			row({ active: true, eligible: true }, "suspended"),
		);
		expect(suspended?.remedy).toBe("lop tunnel status");
		const unsplit = fromSurface(refused, row({}));
		expect(unsplit?.copy).toBeNull();
		expect(unsplit?.remedy).toBe("lop login radient");
	});
});

describe("core C1 reasons and kinds get their own plain copy (M1 additions)", () => {
	const gateway = (
		body: Record<string, string>,
		computer: RefusalComputer | null = null,
	) => {
		const error = relayErrorFromResponse({
			status: 503,
			header: () => "application/json",
			text: JSON.stringify(body),
		});
		return refusalFromError({
			error,
			surface: error.surface,
			detail: error.detail ?? null,
			retryAfterMs: null,
			subject: "Studio Mac",
			computer,
		});
	};

	it.each([
		["server_unavailable", "radient-unreachable"],
		["tunnel_inactive", "suspended"],
		["tunnel_disabled", "console-disabled"],
		["billing_inactive", "phone-access-off"],
		["billing_lapsed", "balance-out"],
	] as const)("reason %s → %s", (reason, cause) => {
		const refusal = gateway({ detail: "d", reason, error: "e" });
		expect(refusal?.copy?.cause).toBe(cause);
		expect(visible(refusal)).not.toMatch(/\blop\b/);
	});

	it("lets the computer's own reason win over the phone's reading of the row", () => {
		const refusal = gateway(
			{ detail: "d", reason: "billing_lapsed" },
			row({ active: false }),
		);
		expect(refusal?.copy?.cause).toBe("balance-out");
	});

	it.each([
		["wait_network", "wait-network", ["retry"]],
		["wait_radient", "radient-unreachable", ["retry"]],
		["wait_reconnect", "wait-reconnect", ["retry"]],
		["check_status", "relay-wait", ["retry"]],
		["sign_in", "computer-sign-in", ["retry"]],
		["run", "computer-attention", ["retry"]],
		["restore_owner", "computer-attention", ["retry"]],
		["accept_quote", "phone-access-off", ["how-to", "open-billing", "retry"]],
		["add_credit", "balance-out", ["add-credit", "retry"]],
		["open_console", "open-console", ["open-console", "retry"]],
	] as const)("kind %s → %s", (kind, cause, actions) => {
		const refusal = gateway({ detail: "d", reason: "a_future_reason", kind });
		expect(refusal?.copy?.cause).toBe(cause);
		expect(refusal?.copy?.actions.map((item) => item.id)).toEqual(actions);
		expect(visible(refusal)).not.toMatch(/\blop\b/);
	});

	it("the computer's sign-in never offers a phone sign-in, and its terminal remedy is the login", () => {
		const refusal = gateway({
			detail: "d",
			reason: "login_required",
			kind: "sign_in",
		});
		expect(refusal?.kind).toBe("console");
		expect(refusal?.copy?.body).toContain("won't fix it");
		expect(refusal?.remedy).toBe("lop login radient");
	});

	it("an unknown reason and kind fall back without crashing", () => {
		const refusal = gateway({
			detail: "d",
			reason: "later",
			kind: "later_kind",
		});
		expect(refusal?.kind).toBe("retry");
		expect(refusal?.copy).toBeNull();
	});
});

describe("a Radient-route 401 without X-Radient-Login is the relay, not a sign-in (M1)", () => {
	const facts = (headers: Record<string, string>) => ({
		header: (name: string) => headers[name.toLowerCase()] ?? null,
	});
	it("maps the edge's 401 (with the header) to sign-in, and any other to password", () => {
		expect(radientUnauthorizedSurface(facts({ "x-radient-login": "1" }))).toBe(
			"sign-in",
		);
		expect(radientUnauthorizedSurface(facts({}))).toBe("password");
	});
	/* The provider half (no revoke for it, its Last error) is driven end to end
	 *  in `connection-provider.test.ts`, "PR #261 round-1 remediation". */
	it("tells a Radient reader about the computer, never a relay password (U4)", () => {
		const error = relayErrorFromResponse({
			status: 401,
			/* No `X-Radient-Login`: the relay's 401, not the edge's. */
			header: (name) =>
				name.toLowerCase() === "content-type" ? "application/json" : null,
			text: JSON.stringify({ error: "authentication required" }),
		});
		expect(error.surface).toBe("password");
		const radient = refusalFromError({
			error,
			surface: "password",
			detail: null,
			retryAfterMs: null,
			subject: "Studio Mac",
			radientRoute: true,
		});
		expect(radient?.copy).toMatchObject({
			cause: "relay-refused",
			title: "Local Operator on Studio Mac didn't accept this phone.",
			body: "Open Local Operator there and check that phone access is on, then tap Retry.",
		});
		expect(radient?.copy?.actions.map((item) => item.id)).toEqual(["retry"]);
		expect(visible(radient)).not.toMatch(/password/i);
		/* Negative control: a custom route keeps the password surface's own copy. */
		const custom = refusalFromError({
			error,
			surface: "password",
			detail: null,
			retryAfterMs: null,
			subject: "https://relay.example.com",
			radientRoute: false,
		});
		expect(custom?.copy).toBeNull();
		expect(custom?.kind).toBe("password");
	});
});

describe("a stale error never names the cause of another surface (PR #261 R2)", () => {
	const stale = relayErrorFromResponse({
		status: 503,
		header: () => "application/json",
		text: JSON.stringify({ detail: "d", kind: "wait_radient" }),
	});
	it.each(["sign-in", "password"] as const)(
		"a %s surface keeps its own copy and buttons beside a wait_radient error",
		(surface) => {
			const refusal = refusalFromError({
				error: stale,
				surface,
				detail: null,
				retryAfterMs: null,
				subject: "Studio Mac",
			});
			expect(refusal?.copy).toBeNull();
			expect(refusal?.kind).toBe(surface);
		},
	);
	it("a stale mint error does not lend its kind to a real sign-out", () => {
		const mint = tunnelSessionRelayError(
			new TunnelSessionError("billing", "x", 403),
		);
		const refusal = refusalFromError({
			error: mint,
			surface: "sign-in",
			detail: null,
			retryAfterMs: null,
			subject: "Studio Mac",
			computer: row({ active: false }),
		});
		expect(refusal?.kind).toBe("sign-in");
		expect(refusal?.copy).toBeNull();
	});
	it("an error for ANOTHER surface is not read (console surface, retry error)", () => {
		const refusal = refusalFromError({
			error: stale,
			surface: "computer-offline",
			detail: null,
			retryAfterMs: null,
			subject: "Studio Mac",
		});
		expect(refusal?.copy?.cause).toBe("computer-offline");
	});
});

describe("copy promises no retry the phone does not make (PR #261 D1/U1/D4)", () => {
	const copyOf = (
		kind: Parameters<typeof relayErrorFromResponse>[0]["status"],
		body: string,
	) =>
		refusalFromError({
			error: relayErrorFromResponse({
				status: kind,
				header: () => "application/json",
				text: body,
			}),
			surface: relayErrorFromResponse({
				status: kind,
				header: () => "application/json",
				text: body,
			}).surface,
			detail: null,
			retryAfterMs: null,
			subject: "Studio Mac",
		})?.copy;
	it("Radient unreachable says try again, never 'we'll keep trying'", () => {
		const copy = copyOf(
			503,
			JSON.stringify({ detail: "d", reason: "server_unavailable" }),
		);
		expect(copy?.body).toBe("Try again in a moment.");
	});
	it("relay stopped hands the return trip to Retry, and names the computer (D7)", () => {
		const copy = copyOf(
			502,
			JSON.stringify({ error: "local harness unavailable" }),
		);
		expect(copy).toMatchObject({
			title: "Local Operator isn't running on Studio Mac.",
			body: "Open it there, then tap Retry.",
		});
	});
	it("balance out ends with 'Then tap Retry.' (D4)", () => {
		const copy = copyOf(
			503,
			JSON.stringify({ detail: "d", reason: "billing_lapsed" }),
		);
		expect(copy?.body).toBe(
			"Add credit — your computer reconnects by itself. Then tap Retry.",
		);
	});
	it("suspended leads with what happened (U11), and console-off names the computer (D8)", () => {
		expect(
			copyOf(503, JSON.stringify({ detail: "d", reason: "tunnel_inactive" }))
				?.title,
		).toBe("Radient paused phone access for Studio Mac.");
		expect(
			copyOf(503, JSON.stringify({ detail: "d", reason: "tunnel_disabled" }))
				?.title,
		).toBe(
			"Phone access for Studio Mac is turned off in your Radient console.",
		);
	});
	it("asleep allows for Local Operator not running (U8)", () => {
		const copy = refusalFromError({
			error: new RelayError("computer-offline", "x"),
			surface: "computer-offline",
			detail: null,
			retryAfterMs: null,
			subject: "Studio Mac",
		})?.copy;
		expect(copy?.body).toBe(
			"Wake it, and make sure Local Operator is open on it.",
		);
	});
	it("no phone-path body anywhere says it reconnects 'by itself' without a Retry beside it", () => {
		const all = [
			copyOf(
				503,
				JSON.stringify({ detail: "d", reason: "server_unavailable" }),
			),
			copyOf(502, JSON.stringify({ error: "local harness unavailable" })),
			copyOf(503, JSON.stringify({ detail: "d", reason: "billing_lapsed" })),
			copyOf(503, JSON.stringify({ detail: "d", reason: "tunnel_inactive" })),
			copyOf(503, JSON.stringify({ detail: "d", kind: "wait_network" })),
		];
		for (const copy of all) {
			const text = `${copy?.title} ${copy?.body ?? ""}`;
			expect(text).not.toMatch(/keep trying/i);
			if (/by itself/i.test(text))
				expect(copy?.actions.map((item) => item.id)).toContain("retry");
		}
	});
});

describe("account causes hide the own-relay route and billing hides the terminal (U10, D6)", () => {
	it.each([
		[row({ active: false }), true, null],
		[row({ active: true, eligible: false }), true, null],
		[row({ active: true, eligible: true }, "disabled"), true, null],
		[row({ active: true, eligible: true }, "suspended"), false, null],
	] as const)("%j → accountCause %s", (computer, account, remedy) => {
		const refusal = minted(computer);
		expect(refusal?.copy?.accountCause).toBe(account);
		expect(refusal?.remedy).toBe(remedy);
	});
});

describe("a cold start that cannot reach Radient (PR #261 U9)", () => {
	it("uses the mint path's Radient-unreachable copy and carries a Last error", () => {
		const error = radientUnreachableError("Radient could not be reached.");
		const refusal = refusalFromError({
			error,
			surface: "retry",
			detail: null,
			retryAfterMs: null,
			subject: "Radient",
		});
		expect(refusal?.copy).toMatchObject({
			cause: "radient-unreachable",
			title: "Radient isn't responding right now.",
			body: "Try again in a moment.",
		});
		expect(error.summary).toBe("transport");
		/* Negative control: the same surface with no error keeps the generic copy. */
		expect(
			refusalFromError({
				error: null,
				surface: "retry",
				detail: null,
				retryAfterMs: null,
				subject: "Radient",
			})?.copy,
		).toBeNull();
	});
});

describe("a retrying stream's named wait becomes a notice, not silence (PR #261 Q3)", () => {
	const error = (body: Record<string, string>) =>
		relayErrorFromResponse({
			status: 503,
			header: () => "application/json",
			text: JSON.stringify(body),
		});
	it.each([
		[{ detail: "d", reason: "server_unavailable" }, "radient-unreachable"],
		[{ detail: "d", kind: "wait_network" }, "wait-network"],
		[{ detail: "d", kind: "wait_radient" }, "radient-unreachable"],
		[{ detail: "d", kind: "wait_reconnect" }, "wait-reconnect"],
		[{ detail: "d", kind: "check_status" }, "relay-wait"],
		[{ detail: "d", kind: "wait_future_thing" }, "relay-wait"],
	] as const)("%j → %s with Retry", (body, cause) => {
		const copy = transientCopy(error(body), "Studio Mac");
		expect(copy?.cause).toBe(cause);
		expect(copy?.actions.map((item) => item.id)).toEqual(["retry"]);
	});
	it("says nothing for a cause that is not a wait, or no cause", () => {
		expect(
			transientCopy(error({ detail: "d", reason: "billing_lapsed" }), "x"),
		).toBeNull();
		expect(transientCopy(new RelayError("transport", "x"), "x")).toBeNull();
		expect(transientCopy(null, "x")).toBeNull();
	});
});

describe("Home lands on the named cause, not 'couldn't connect' (PR #261 Q2)", () => {
	it.each([
		[row({ active: false }), "phone-access-off"],
		[row({ active: true, eligible: false }), "balance-out"],
		[row({ active: true, eligible: true }, "disabled"), "console-disabled"],
	] as const)("%j → %s, with no 'isn't active' detail", (computer, cause) => {
		const refusal = minted(computer);
		const named = homeNamedRefusal("error", refusal);
		expect(named?.copy?.cause).toBe(cause);
		expect(named?.detail).toBeNull();
		expect(JSON.stringify(named)).not.toContain("isn't active");
	});
	it("keeps Home's own recovery for sign-in, offline and an unnamed cause", () => {
		expect(homeNamedRefusal("auth", minted(row({ active: false })))).toBeNull();
		expect(
			homeNamedRefusal("offline", minted(row({ active: false }))),
		).toBeNull();
		expect(homeNamedRefusal("error", view("contract"))).toBeNull();
	});
});
