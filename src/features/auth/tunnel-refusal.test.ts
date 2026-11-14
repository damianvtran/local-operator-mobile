import { describe, expect, it } from "vitest";
import { TunnelSessionError } from "@/connection/tunnel-session";
import { RelayError, relayErrorFromResponse } from "@/relay";
import {
	type RefusalComputer,
	type RefusalView,
	refusalFromError,
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
			expect(refusal?.detail?.toLowerCase()).toContain(
				instruction.toLowerCase(),
			);
			expect(refusal?.remedy).toBeNull();
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
			["how-to", "open-billing"],
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
			["open-console"],
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
		expect(help).toContain("Settings → Phone access");
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
			"Local Operator isn't running on your computer.",
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
		expect(split?.remedy).toBe("lop tunnel status");
		const unsplit = fromSurface(refused, row({}));
		expect(unsplit?.copy).toBeNull();
		expect(unsplit?.remedy).toBe("lop login radient");
	});
});
