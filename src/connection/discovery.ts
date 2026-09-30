/**
 * Discovery: the account's tunnels, as computers a phone can pick.
 *
 * This is the owner API (`https://api.radienthq.com`), not the relay and not the
 * edge: it needs `Authorization: Bearer <Radient access token>` and every response
 * is the API's envelope — `{msg, result}` — with `result` being what we read
 * (`radient-ml:internal/responses/responses.go:20-32`).
 *
 * The mapping decisions that matter, all from `ADR 0002` §2:
 *
 * - **A tunnel is a computer.** The picker lists them by name with status, most
 *   recently updated first, and remembers the last one used. There is no
 *   cross-device grouping beyond what the API provides, and none is invented.
 * - **Harness selection is exact.** The target is the harness with
 *   `id === "local-operator"` and `enabled === true`; its `hostname` is the tunnel
 *   origin. A tunnel whose only enabled harness is `opencode` is not a Local
 *   Operator target and is shown as such rather than offered and then failing.
 * - **Billing is surfaced BEFORE the user tries.** A tunnel with
 *   `eligible: false` produces a 402 at session-code time, so the banner and the
 *   console link belong on the picker, not in an error after a tap.
 * - **An empty list and a failed request are different states**, and neither is
 *   "you have no computer": the first offers "set one up", the second says what
 *   went wrong.
 */

import { z } from "zod";
import { resolveFetch } from "../relay/platform-fetch";

/* Hoisted: discovery runs on every cold start and after every re-auth. */
const TRAILING_SLASHES = /\/+$/;

export const RADIENT_API_BASE = "https://api.radienthq.com";
/** The tunnel console, for the billing and revoked-tunnel copy. */
export const RADIENT_CONSOLE_TUNNELS_URL =
	"https://console.radienthq.com/dashboard/tunnels";

/** The harness id this app is a client of. */
export const LOCAL_OPERATOR_HARNESS = "local-operator";

/** The API's envelope. `result` is the payload; `msg` is a human sentence that is
 *  sometimes the only explanation for a refusal. */
export const envelopeSchema = z.object({
	msg: z.string().optional(),
	result: z.unknown(),
});

/** One harness on a tunnel. Unknown fields are preserved: the control plane adds
 *  them. */
export const harnessSchema = z.looseObject({
	id: z.string(),
	enabled: z.boolean(),
	hostname: z.string().optional(),
});

/**
 * Billing, as `GET /v1/tunnels` embeds it.
 *
 * `eligible` is the field that decides whether minting will work; the rest is
 * display. It is optional because an older control plane may omit the object
 * entirely, and absence must read as "unknown", never as "not eligible" — a
 * banner that tells a paying user their billing is inactive is worse than no
 * banner.
 */
export const billingSchema = z.looseObject({
	eligible: z.boolean().optional(),
	status: z.string().optional(),
	plan: z.string().optional(),
	quote: z.string().optional(),
	message: z.string().optional(),
});

export const tunnelSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	device_id: z.string().optional(),
	gateway_port: z.number().optional(),
	enabled: z.boolean().optional(),
	version: z.number().optional(),
	hostname: z.string(),
	harnesses: z.array(harnessSchema).optional(),
	status: z.string().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	revoked_at: z.string().nullish(),
	billing: billingSchema.optional(),
});

export type Tunnel = z.output<typeof tunnelSchema>;

/** How the picker should read a tunnel's status (`service.go:302`, `:466-472`). */
export type ComputerStatus =
	| "ready"
	| "off"
	| "suspended"
	| "provisioning"
	| "gone"
	| "unknown";

export interface DiscoveredComputer {
	tunnelId: string;
	name: string;
	deviceId: string;
	/** The Radient tunnel origin, exactly as issued. */
	hostname: string;
	status: ComputerStatus;
	/** The status token as the API returned it, for the diagnostics row. */
	rawStatus: string;
	/** False when the Local Operator harness is absent or disabled on this tunnel. */
	supportsLocalOperator: boolean;
	/** What the console says about billing, when it says anything. */
	billing: { eligible: boolean | null; message: string | null };
	/** Epoch ms, for the "most recently updated first" ordering. */
	updatedAt: number;
}

export type DiscoveryResult =
	| { kind: "computers"; computers: DiscoveredComputer[] }
	/** The account exists and has no tunnels at all — a different screen from a
	 *  failure, and the one that offers "create here". */
	| { kind: "none" }
	| { kind: "unauthorized" }
	| { kind: "unreachable"; message: string }
	| { kind: "rejected"; message: string; status: number };

/** The status vocabulary, mapped once. */
export function mapStatus(raw: string | undefined): ComputerStatus {
	switch ((raw ?? "").toLowerCase()) {
		case "active":
			return "ready";
		case "disabled":
			return "off";
		case "suspended":
			return "suspended";
		case "pending":
		case "reconciling":
			return "provisioning";
		case "revoking":
		case "deleted":
			return "gone";
		default:
			return "unknown";
	}
}

/** True when this tunnel can serve this app. A disabled or missing harness is a
 *  real "not a target", not an error. */
export function supportsLocalOperator(tunnel: Tunnel): boolean {
	const harnesses = tunnel.harnesses ?? [];
	const harness = harnesses.find(
		(candidate) => candidate.id === LOCAL_OPERATOR_HARNESS,
	);
	return harness?.enabled === true;
}

export function toComputer(tunnel: Tunnel): DiscoveredComputer {
	const harness = (tunnel.harnesses ?? []).find(
		(candidate) => candidate.id === LOCAL_OPERATOR_HARNESS,
	);
	return {
		tunnelId: tunnel.id,
		name: tunnel.name.length > 0 ? tunnel.name : tunnel.hostname,
		deviceId: tunnel.device_id ?? "",
		/* The harness hostname is the origin when it carries one; the tunnel's own
		 * hostname is the fallback the console shows. */
		hostname:
			harness?.hostname && harness.hostname.length > 0
				? harness.hostname
				: tunnel.hostname,
		status: mapStatus(tunnel.status),
		rawStatus: tunnel.status ?? "",
		supportsLocalOperator: supportsLocalOperator(tunnel),
		billing: {
			/* Absent is UNKNOWN, never "not eligible". */
			eligible: tunnel.billing?.eligible ?? null,
			message: tunnel.billing?.message ?? tunnel.billing?.quote ?? null,
		},
		updatedAt: Date.parse(tunnel.updated_at ?? "") || 0,
	};
}

/** Most recently updated first, which is the API's own ordering intent. A tunnel
 *  with no `updated_at` sorts last rather than first. */
export function sortComputers(
	computers: DiscoveredComputer[],
): DiscoveredComputer[] {
	return [...computers].sort((left, right) => right.updatedAt - left.updatedAt);
}

export interface DiscoveryDeps {
	/** A valid Radient OAuth access token. The caller refreshes it first; this
	 *  function never does, so a 401 here is a real signal rather than a race. */
	accessToken: () => Promise<string | null> | string | null;
	fetchImpl?: typeof globalThis.fetch;
	baseUrl?: string;
}

/**
 * Lists the account's computers.
 *
 * Returns a discriminated result rather than throwing, because every failure mode
 * here has its own screen and none of them is exceptional: an expired token, an
 * unreachable API, and an empty account are three different UIs, and a caller that
 * had to catch to tell them apart would eventually collapse them.
 */
export async function discoverComputers(
	deps: DiscoveryDeps,
): Promise<DiscoveryResult> {
	const token = await deps.accessToken();
	if (!token) return { kind: "unauthorized" };

	const fetchImpl = resolveFetch(deps.fetchImpl);
	const base = (deps.baseUrl ?? RADIENT_API_BASE).replace(TRAILING_SLASHES, "");

	let response: Response;
	try {
		response = await fetchImpl(`${base}/v1/tunnels`, {
			method: "GET",
			headers: { accept: "application/json", authorization: `Bearer ${token}` },
			/* No cookies: this host is not the tunnel, and the control plane allows any
			 * origin — nothing here should depend on a jar. */
			credentials: "omit",
		});
	} catch {
		return {
			kind: "unreachable",
			message: "Radient could not be reached. Check this device's connection.",
		};
	}

	if (response.status === 401 || response.status === 403)
		return { kind: "unauthorized" };

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return {
			kind: "rejected",
			message: "Radient returned a response this app could not read.",
			status: response.status,
		};
	}

	const envelope = envelopeSchema.safeParse(body);
	if (!envelope.success) {
		return {
			kind: "rejected",
			message: "Radient returned a response this app could not read.",
			status: response.status,
		};
	}
	if (!response.ok) {
		return {
			kind: "rejected",
			message:
				envelope.data.msg ??
				`Radient refused the request (HTTP ${response.status}).`,
			status: response.status,
		};
	}

	const tunnels = z.array(tunnelSchema).safeParse(envelope.data.result);
	if (!tunnels.success) {
		/* A shape this build does not know is a version problem, not an empty
		 * account, and saying "you have no computers" here would be a lie. */
		return {
			kind: "rejected",
			message:
				"Radient returned tunnels in a shape this app does not understand.",
			status: response.status,
		};
	}
	if (tunnels.data.length === 0) return { kind: "none" };

	return {
		kind: "computers",
		computers: sortComputers(tunnels.data.map(toComputer)),
	};
}

/** The one-sentence summary a picker row shows. Kept here so the copy and the
 *  status mapping cannot drift apart. */
export function describeComputer(computer: DiscoveredComputer): string {
	if (!computer.supportsLocalOperator) {
		return "This computer is not running the Local Operator harness.";
	}
	switch (computer.status) {
		case "ready":
			return computer.billing.eligible === false
				? "Billing for this tunnel is inactive, so remote access will be refused."
				: "Ready.";
		case "off":
			return "This tunnel is turned off in the Radient console.";
		case "suspended":
			return "This tunnel is suspended. Check its billing in the Radient console.";
		case "provisioning":
			return "This tunnel is still being set up.";
		case "gone":
			return "This tunnel no longer exists.";
		case "unknown":
			return "Radient reports a status this app does not recognise.";
	}
}
