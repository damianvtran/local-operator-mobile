/**
 * The failure taxonomy → the refusal surface, in one place.
 *
 * `src/relay/errors.ts` decides *which* surface a failure belongs to
 * (`ErrorSurface`); this module decides what the reader is told and which remedy
 * they are given. Two layers rather than one because they answer different
 * questions: the protocol layer knows a `503` carried
 * `authorization_deferred`, and only the app can know that this means "wait, it
 * clears by itself" rather than "fix something".
 *
 * **The remedies are sourced, not invented.** Each machine-side sentence names
 * the command the local-operator CLI actually documents for that state
 * (`docs/relay/tunnel-edge.md` § 5.4): `lop login radient` for
 * `authorization_refused`, `lop tunnel connect` for `tunnel_not_authorized`,
 * "sign in again on that computer" for `login_required`. Copy that guesses here
 * is copy that sends the reader to a command that will not fix their problem.
 *
 * **No terminal outside "Using a terminal?".** The reader of these surfaces is
 * usually not a terminal user: a teammate's phone answered an inactive-billing
 * 403 with "Radient says this tunnel isn't active right now" beside
 * `lop login radient`, a command that cannot fix billing. So every command here
 * is rendered ONLY behind the surface's "Using a terminal?" disclosure, and the
 * common connect failures carry plain copy and a button that can act on the
 * cause (`RefusalCopy`, below). The commands stay, sourced as above, for the
 * readers who do use one.
 */

import type { DiscoveredComputer } from "@/connection/discovery";
import { RADIENT_CONSOLE_TUNNELS_URL } from "@/connection/discovery";
import type { SecureStorageRefusal } from "@/connection/secure-storage-refusal";
import type { TunnelSessionError } from "@/connection/tunnel-session";
import { t } from "@/i18n";
import { type ErrorSurface, RelayError } from "@/relay";
import { DIAGNOSTIC_FALLBACK } from "@/ui/components/diagnostic-fallback";
import type {
	RefusalKind,
	RefusalSurfaceAction,
	RefusalSurfaceCopy,
} from "@/ui/components/refusal-surface";

// Keep the control-plane cause typed through the shared RelayError/store path.
// A 200/schema failure is not a gateway authorization refusal and must never
// inherit the generic console/`lop login` remedy. Only server-owned changes do.
class TunnelConnectionError extends RelayError {
	readonly refusalKind: RefusalKind;
	/** The mint's own classification, kept so the copy can split a 403/402 by the
	 *  discovery row's live billing and status (`tunnelRefusalCopy`). */
	readonly failure: TunnelSessionError["failure"];
	constructor(error: TunnelSessionError) {
		const kind: RefusalKind =
			error.failure === "oauth"
				? "sign-in"
				: error.failure === "account"
					? "account-mismatch"
					: ["billing", "disabled", "harness"].includes(error.failure)
						? "console"
						: error.failure === "rate-limited" ||
								error.failure === "network" ||
								error.failure === "unavailable"
							? "retry"
							: "diagnostic";
		const detail =
			error.failure === "billing"
				? t("mobile.computers.billing_help")
				: error.failure === "disabled"
					? t("mobile.computers.disabled_help")
					: error.failure === "harness"
						? t("mobile.computers.harness_help")
						: kind === "diagnostic"
							? `TunnelSessionError · ${error.failure}`
							: null;
		super("rejected", "Tunnel session could not be established", {
			surface:
				kind === "account-mismatch"
					? "diagnostic"
					: kind === "console"
						? "console"
						: kind === "sign-in"
							? "sign-in"
							: kind === "retry"
								? "retry"
								: "diagnostic",
			status: error.status,
			detail: detail ?? undefined,
			retryAfterMs: error.retryAfterMs,
		});
		this.refusalKind = kind;
		this.failure = error.failure;
	}
}
/**
 * Which surface a 401 on the RADIENT route belongs to. The edge's 401 carries
 * `X-Radient-Login` and means this phone's grant is gone (`sign-in`); a 401
 * without it came from the relay behind the tunnel, which no phone-side sign-in
 * can fix (`password`, the relay-auth surface). Same discriminator as
 * `relayErrorFromResponse`, so the two paths cannot disagree.
 */
export function radientUnauthorizedSurface(facts: {
	header: (name: string) => string | null;
}): "sign-in" | "password" {
	return facts.header("x-radient-login") ? "sign-in" : "password";
}

export const tunnelSessionRelayError = (
	error: TunnelSessionError,
): RelayError => new TunnelConnectionError(error);

/**
 * The phone could not reach Radient's API at all (a cold-start restore whose
 * token refresh never got an answer). Typed, rather than a bare `retry`
 * surface with no error, for two reasons (PR #261 U9): the copy is then the
 * same "Radient isn't responding" sentence the mint path shows for the same
 * cause, instead of the generic `retry` headline; and Diagnostics' Last error
 * has something to say instead of "None" beside a refusal.
 */
class RadientUnreachableError extends RelayError {
	constructor(message: string) {
		super("transport", message, { surface: "retry", retry: "never" });
	}
}

export const radientUnreachableError = (message: string): RelayError =>
	new RadientUnreachableError(message);

export type RefusalView = {
	kind: RefusalKind;
	/** What was being reached, named for the reader. */
	subject: string;
	/** The gateway's or relay's own sentence, when it sent one. */
	detail: string | null;
	/** The exact local command for a machine-side cause, when one exists. Shown
	 *  only behind "Using a terminal?", never as the surface's instruction. */
	remedy: string | null;
	/** A server-supplied backoff. */
	retryAfterMs: number | null;
	/** Plain-language copy and actions for a cause this module can name exactly.
	 *  `null` keeps the surface's per-kind default copy. */
	copy: RefusalCopy | null;
};

/** A button the surface can act on without the screen knowing the cause.
 *  Link actions carry their URL so every screen gets them, not only the two that
 *  happened to wire a console handler. The shape is the surface's own. */
export type RefusalAction = RefusalSurfaceAction;

/** Stable cause ids: tests and flows assert the CAUSE, not the prose. */
export type RefusalCause =
	| "phone-access-off"
	| "balance-out"
	| "suspended"
	| "console-disabled"
	| "provisioning"
	| "refused"
	| "computer-offline"
	| "relay-stopped"
	| "tunnel-gone"
	| "radient-unreachable"
	| "relay-wait"
	/* Core C1's relay `kind`s (`gateway.py` REMEDY_KIND at 7c0fc7bf). */
	| "wait-network"
	| "wait-reconnect"
	| "computer-sign-in"
	| "computer-attention"
	| "open-console"
	/* A Radient-route 401 WITHOUT `X-Radient-Login`: the relay behind the tunnel
	 *  refused this phone. A Radient reader never set or saw a relay password, so
	 *  the password surface's "check the relay password" was a dead end (U4). */
	| "relay-refused";

export type RefusalCopy = RefusalSurfaceCopy & { cause: RefusalCause };

/** Causes fixed in the reader's Radient ACCOUNT (billing, the console). Under
 *  these, "Use another address" points a non-technical reader at the own-relay
 *  password route, which cannot fix any of them (U10), and the terminal
 *  disclosure's `lop tunnel status` only reads the state back (D6). */
const ACCOUNT_CAUSES: ReadonlySet<RefusalCause> = new Set<RefusalCause>([
	"phone-access-off",
	"balance-out",
	"console-disabled",
	"open-console",
	"refused",
]);

/** The billing causes: no terminal disclosure, so the 403 split and the
 *  gateway's `billing_*` reasons render the same screen (D6). */
const BILLING_CAUSES: ReadonlySet<RefusalCause> = new Set<RefusalCause>([
	"phone-access-off",
	"balance-out",
]);

/** Radient billing, where credit is added and phone access is paid for. The
 *  console path is the one the core app already links (`dashboard/billing`). */
export const RADIENT_CONSOLE_BILLING_URL =
	"https://console.radienthq.com/dashboard/billing";

const action = {
	retry: (): RefusalAction => ({
		id: "retry",
		label: t("mobile.refusal.action.retry"),
	}),
	refreshList: (): RefusalAction => ({
		id: "refresh-list",
		label: t("mobile.refusal.action.refresh_list"),
	}),
	howTo: (): RefusalAction => ({
		id: "how-to",
		label: t("mobile.refusal.action.how_to"),
	}),
	openBilling: (): RefusalAction => ({
		id: "open-billing",
		label: t("mobile.refusal.action.open_billing"),
		url: RADIENT_CONSOLE_BILLING_URL,
	}),
	addCredit: (): RefusalAction => ({
		id: "add-credit",
		label: t("mobile.refusal.action.add_credit"),
		url: RADIENT_CONSOLE_BILLING_URL,
	}),
	openConsole: (): RefusalAction => ({
		id: "open-console",
		label: t("mobile.refusal.action.open_console"),
		url: RADIENT_CONSOLE_TUNNELS_URL,
	}),
};

/** The fields of the CHOSEN computer's discovery row that decide a refusal. */
export type RefusalComputer = Pick<DiscoveredComputer, "billing" | "rawStatus">;

/**
 * Split a tunnel refusal (session-mint 403/402, or a gateway `console` refusal)
 * by the discovery row's LIVE billing and status (`GET /v1/tunnels`).
 *
 * Why the row and not the status code: the cloud answers 403 for ANY non-active
 * tunnel before it would answer 402, so the code cannot tell "phone access was
 * never turned on" from "balance ran out" from "turned off in the console" — and
 * each needs a different fix. The order below is the decision:
 *
 *  1. `billing.active === false` — never turned on: the fix is the desktop's
 *     Phone access set-up, which shows the price first.
 *  2. `billing.eligible === false` (active, or unknown) — out of credit.
 *  3. status `suspended` (billing fine) — clears by itself.
 *  4. status `disabled` — turned off in the console.
 *  5. status `error` / `reconciling` / `pending` — Radient is still setting up.
 *  6. status `revoking` / `deleted` — the tunnel is going away.
 *
 * Absent fields are UNKNOWN, never a cause: with no row (or a row that names
 * none of the above) the answer is the neutral `refused` copy, which still never
 * names a command and still offers the console and a retry.
 */
export function tunnelRefusalCopy(
	computer: RefusalComputer | null | undefined,
	subject: string,
): RefusalCopy {
	const billing = computer?.billing;
	const status = (computer?.rawStatus ?? "").toLowerCase();
	if (billing?.active === false) return copyFor("phone-access-off", subject);
	if (billing?.eligible === false) return copyFor("balance-out", subject);
	switch (status) {
		case "suspended":
			return copyFor("suspended", subject);
		case "disabled":
			return copyFor("console-disabled", subject);
		case "error":
		case "reconciling":
		case "pending":
			return copyFor("provisioning", subject);
		case "revoking":
		case "deleted":
			return copyFor("tunnel-gone", subject);
		default:
			return copyFor("refused", subject);
	}
}

/** One cause → its copy and actions, in ONE table, so the 403 split, the
 *  gateway's reasons and the relay's kinds cannot give one cause two wordings
 *  or two different buttons. */
function copyFor(cause: RefusalCause, subject: string): RefusalCopy {
	const plain = (
		title: string,
		body: string | null,
		actions: RefusalAction[],
	): RefusalCopy => ({
		cause,
		title,
		body,
		actions,
		help: null,
		accountCause: ACCOUNT_CAUSES.has(cause),
	});
	/* Every action list ends in Retry wherever the fix happens somewhere else
	 *  (the desktop, the console, billing): nothing on this phone polls while a
	 *  refusal shows, so the return trip needs a button (U6, D1, D4). */
	switch (cause) {
		case "phone-access-off":
			return {
				...plain(
					t("mobile.refusal.phone_access_off.title"),
					t("mobile.refusal.phone_access_off.body"),
					[action.howTo(), action.openBilling(), action.retry()],
				),
				help: t("mobile.refusal.how_to.body"),
			};
		case "balance-out":
			return plain(
				t("mobile.refusal.balance_out.title"),
				t("mobile.refusal.balance_out.body"),
				[action.addCredit(), action.retry()],
			);
		case "suspended":
			return plain(
				t("mobile.refusal.suspended.title", { computer: subject }),
				t("mobile.refusal.suspended.body"),
				[action.retry()],
			);
		case "console-disabled":
			return plain(
				t("mobile.refusal.console_disabled.title", { computer: subject }),
				null,
				[action.openConsole(), action.retry()],
			);
		case "provisioning":
			return plain(
				t("mobile.refusal.provisioning.title"),
				t("mobile.refusal.provisioning.body"),
				[action.retry()],
			);
		case "refused":
			return plain(
				t("mobile.refusal.refused.title", { computer: subject }),
				t("mobile.refusal.refused.body"),
				[action.openConsole(), action.retry()],
			);
		case "computer-offline":
			return plain(
				t("mobile.refusal.offline.title", { computer: subject }),
				t("mobile.refusal.offline.body"),
				[action.retry()],
			);
		case "relay-refused":
			return plain(
				t("mobile.refusal.relay_refused.title", { computer: subject }),
				t("mobile.refusal.relay_refused.body"),
				[action.retry()],
			);
		case "relay-stopped":
			return plain(
				t("mobile.refusal.relay_stopped.title", { computer: subject }),
				t("mobile.refusal.relay_stopped.body"),
				[action.retry()],
			);
		case "tunnel-gone":
			/* Refresh, not Retry: the same address will be refused again, and a
			 *  fresh list is what shows whether the computer was set up again. */
			return plain(
				t("mobile.refusal.tunnel_gone.title", { computer: subject }),
				t("mobile.refusal.tunnel_gone.body"),
				[action.refreshList()],
			);
		case "radient-unreachable":
			return plain(
				t("mobile.refusal.radient_unreachable.title"),
				t("mobile.refusal.radient_unreachable.body"),
				[action.retry()],
			);
		case "relay-wait":
			return plain(
				t("mobile.refusal.relay_wait.title", { computer: subject }),
				t("mobile.refusal.relay_wait.body"),
				[action.retry()],
			);
		case "wait-network":
			return plain(
				t("mobile.refusal.wait_network.title", { computer: subject }),
				t("mobile.refusal.wait_network.body"),
				[action.retry()],
			);
		case "wait-reconnect":
			return plain(
				t("mobile.refusal.wait_reconnect.title", { computer: subject }),
				t("mobile.refusal.wait_reconnect.body"),
				[action.retry()],
			);
		case "computer-sign-in":
			/* The COMPUTER's Radient login, not this phone's: no "Sign in again"
			 *  button here, because signing in on the phone cannot clear it. */
			return plain(
				t("mobile.refusal.computer_sign_in.title", { computer: subject }),
				t("mobile.refusal.computer_sign_in.body"),
				[action.retry()],
			);
		case "computer-attention":
			return plain(
				t("mobile.refusal.computer_attention.title", { computer: subject }),
				t("mobile.refusal.computer_attention.body"),
				[action.retry()],
			);
		case "open-console":
			return plain(
				t("mobile.refusal.open_console.title", { computer: subject }),
				null,
				[action.openConsole(), action.retry()],
			);
	}
}

/** Core C1's reason codes → cause. The computer's refined answer, so it wins
 *  over the phone's own reading of the discovery row. */
const REASON_CAUSE: Readonly<Record<string, RefusalCause>> = {
	server_unavailable: "radient-unreachable",
	tunnel_inactive: "suspended",
	tunnel_disabled: "console-disabled",
	billing_inactive: "phone-access-off",
	billing_lapsed: "balance-out",
};

/** Core C1's relay `kind`s → cause, used when the reason is not one above. An
 *  unknown kind returns `undefined` (a `wait_*` one still reads as a wait). */
function causeForKind(kind: string | undefined): RefusalCause | undefined {
	switch (kind) {
		case undefined:
			return undefined;
		case "wait_network":
			return "wait-network";
		case "wait_radient":
			return "radient-unreachable";
		case "wait_reconnect":
			return "wait-reconnect";
		case "check_status":
			return "relay-wait";
		case "sign_in":
			return "computer-sign-in";
		case "restore_owner":
		case "run":
			return "computer-attention";
		case "accept_quote":
			return "phone-access-off";
		case "add_credit":
			return "balance-out";
		case "open_console":
			return "open-console";
		default:
			return kind.startsWith("wait_") ? "relay-wait" : undefined;
	}
}

/** Surfaces whose copy is the surface's own, whatever error sits beside them.
 *  (An account mismatch is a `diagnostic` surface carrying the mint's
 *  `account` failure, for which `refusalCopy` returns no copy either.) */
const OWN_COPY_SURFACES: ReadonlySet<ErrorSurface> = new Set<ErrorSurface>([
	"sign-in",
	"password",
]);

/** The computer's own answer (C1 `reason`, then `kind`) → cause. */
function causeForError(error: RelayError | null): RefusalCause | undefined {
	if (!error) return undefined;
	if (error.reasonRaw && Object.hasOwn(REASON_CAUSE, error.reasonRaw))
		return REASON_CAUSE[error.reasonRaw];
	return causeForKind(error.relayStateKind);
}

/** Causes that clear by themselves while the list stream keeps retrying. */
const TRANSIENT_CAUSES: ReadonlySet<RefusalCause> = new Set<RefusalCause>([
	"radient-unreachable",
	"wait-network",
	"wait-reconnect",
	"relay-wait",
]);

/**
 * The non-blocking notice for a failure the list stream is RETRYING (PR #261
 * Q3): a relay `503` with C1's `server_unavailable` or a `wait_*` /
 * `check_status` kind. That path deliberately raises no refusal — the stream
 * comes back by itself — and so the phone used to show a green check and
 * "Online" for a computer saying \"I can't reach Radient\". This returns the
 * cause's own sentence for a banner (with Retry), or `null` for anything the
 * computer did not name as a self-clearing wait.
 */
export function transientCopy(
	error: RelayError | null,
	subject: string,
): RefusalCopy | null {
	const cause = causeForError(error);
	return cause && TRANSIENT_CAUSES.has(cause) ? copyFor(cause, subject) : null;
}

/**
 * The plain copy for a refusal, or `null` to keep the surface's per-kind copy
 * (sign-in, password, certificate, … — causes this change does not touch).
 *
 * Precedence, most specific first: the computer's own refined `reason`
 * (core C1), then its `kind`, then the phone's reading of the discovery row,
 * then the surface. Every field is feature-detected: a relay that sends none
 * of them lands on the surface rows exactly as before, and an unknown value is
 * never a crash and never a guess.
 *
 * **The error is read only when it belongs to the surface being shown**
 * (`error.surface === surface`), and never for the account surfaces (PR #261
 * R2). The store's surface and the provider's last error are two fields
 * written by different paths: `noteFailure({surface: "sign-in"})` from the
 * pick or the edge-401 hook leaves `lastError` alone, so an older error's
 * `wait_radient` kind used to turn a real sign-out into "Radient isn't
 * responding" — and, because a named cause's actions replace the kind's
 * buttons, \"Sign in again\" disappeared with it.
 */
export function refusalCopy(input: {
	error: RelayError | null;
	surface: ErrorSurface;
	subject: string;
	computer?: RefusalComputer | null;
	/** True on a Radient route: the password surface there is the relay behind
	 *  the tunnel refusing this phone, not a password the reader ever typed. */
	radientRoute?: boolean;
}): RefusalCopy | null {
	const { surface, subject, computer } = input;
	if (OWN_COPY_SURFACES.has(surface)) {
		/* Surface-only copy, never the error's reason/kind/row: the Radient-route
		 *  401 without `X-Radient-Login` (U4). Sign-in and account-mismatch keep
		 *  the surface's own copy and its \"Sign in again\". */
		return surface === "password" && input.radientRoute
			? copyFor("relay-refused", subject)
			: null;
	}
	const error =
		input.error !== null && input.error.surface === surface
			? input.error
			: null;
	if (error instanceof TunnelConnectionError) {
		if (error.failure === "disabled" || error.failure === "billing")
			return tunnelRefusalCopy(computer, subject);
		if (error.failure === "network" || error.failure === "unavailable")
			return copyFor("radient-unreachable", subject);
		return null;
	}
	if (error instanceof RadientUnreachableError)
		return copyFor("radient-unreachable", subject);
	const fromError = causeForError(error);
	if (fromError) return copyFor(fromError, subject);
	switch (surface) {
		case "computer-offline":
		case "relay-stopped":
		case "tunnel-gone":
			return copyFor(surface, subject);
		case "console": {
			/* A gateway console refusal on a Radient computer is the same family as
			 *  the mint's 403, and the row can usually name it. With no row, or a row
			 *  naming no cause, the existing console copy stays (its command now sits
			 *  behind the disclosure). */
			if (!computer) return null;
			const split = tunnelRefusalCopy(computer, subject);
			return split.cause === "refused" ? null : split;
		}
		default:
			return null;
	}
}

/**
 * The machine-side remedy for each surface, where one exists.
 *
 * Deliberately absent for `computer-offline`: Cloudflare's 1033 means no healthy
 * connector, and the honest instruction is "check the connector is running on
 * that machine" rather than a command that may not be the missing one. A
 * specific command for an unspecific cause is how a reader ends up running
 * `lop tunnel connect` against a machine that merely went to sleep.
 */
const REMEDY: Partial<Record<ErrorSurface, string>> = {
	/* Bare commands: the surface labels the block "On that computer" (keyed
	 *  copy) and offers Copy, so the string is exactly what a terminal takes.
	 *  #257 wrapped these in `own_tunnel.remedy` ("On that computer: {command}")
	 *  for the old always-visible chip; that wrapper is not used here, because
	 *  the disclosure's `mobile.refusal.terminal.label` already says WHERE and a
	 *  Copy of "On that computer: lop mobile" is not a command a terminal runs. */
	console: "lop login radient",
	"tunnel-gone": "lop tunnel connect <tunnel-id>",
	"relay-stopped": "lop mobile",
	"computer-offline": "lop tunnel status",
};

/** The terminal alternative for a split tunnel cause. `lop tunnel status` reads
 *  the same billing and status the split used, so it is honest for every row;
 *  `lop login radient` (the old remedy) fixes none of them. */
const TUNNEL_STATUS_COMMAND = "lop tunnel status";
const splitRemedy = (copy: RefusalCopy): string =>
	copy.cause === "computer-sign-in"
		? (REMEDY.console ?? TUNNEL_STATUS_COMMAND)
		: copy.cause === "tunnel-gone"
			? (REMEDY["tunnel-gone"] ?? TUNNEL_STATUS_COMMAND)
			: TUNNEL_STATUS_COMMAND;

/**
 * `ErrorSurface` → `RefusalKind`, exhaustively over the CURRENT union: a surface
 * added upstream breaks this file's types until it has copy, which is the point —
 * the alternative is a failure that maps to `undefined` and renders nothing.
 *
 * Two mappings are decisions rather than renames:
 *
 *  - `retry` (the gateway is deferring authorization, or a lease is warming up)
 *    keeps its own kind, because it is the one failure whose remedy is "do
 *    nothing" — the surface says so and retries, rather than sending the reader
 *    to a console that will tell them nothing is wrong.
 *  - `none` never reaches here: a failure with no surface is one the caller
 *    handles silently, and showing it would be the app inventing a problem.
 */
const KIND: Record<Exclude<ErrorSurface, "none">, RefusalKind> = {
	"computer-offline": "computer-offline",
	"relay-stopped": "relay-stopped",
	"tunnel-gone": "tunnel-gone",
	console: "console",
	password: "password",
	"sign-in": "sign-in",
	retry: "retry",
	diagnostic: "diagnostic",
	/* A connection failure whose kind we were not given reads as the certificate
	 *  case only if it IS one; `refusalFromError` below refines it from the error's
	 *  own kind, so the two new outcomes never collapse into one sentence. */
	connection: "certificate-rejected",
};

/**
 * `connection` is one surface with two causes, and the surface alone cannot tell
 * them apart: `certificate-rejected` (retry `never` — retrying a rejected
 * certificate is a loop) and `host-unresolved` (retry `after-backoff` — a DNS
 * answer can change). The error's own kind is what distinguishes them, so it is
 * read here rather than in the surface's copy table.
 *
 * The two kinds are read from the error rather than from the surface table because
 *  the SURFACE cannot tell them apart — both arrive as `connection` — not because the
 *  union is missing anything: `RelayErrorKind` carries `certificate-rejected` and
 *  `host-unresolved` by name (`src/relay/errors.ts`), and `ErrorSurface` carries
 *  `connection`. (An earlier comment here claimed the opposite, from the state of the
 *  branch before the rebase; the next author should fold this into a switch over the
 *  union rather than believe that.)
 */
function refineConnectionKind(error: RelayError | null): RefusalKind | null {
	if (!error) return null;
	const kind: string = error.kind;
	if (kind === "certificate-rejected") return "certificate-rejected";
	if (kind === "host-unresolved") return "host-unresolved";
	return null;
}

/**
 * The reader's sentence for a keystore refusal. The code is the sanitised one
 * (`describeSecureStorageRefusal`: an Expo `ERR_*` identifier and/or a numeric
 * status), shown because it is what support needs to tell a missing entitlement
 * from a locked device; the step stays in the diagnostic line, since "read" vs
 * "clear" changes nothing the reader can do. Reinstalling is named because a
 * keychain entitlement or a corrupted keystore entry survives every retry.
 */
export function secureStorageRefusalSentence(
	refusal: SecureStorageRefusal,
): string {
	return refusal.code
		? t("mobile.computers.storage_refused.with_code", { code: refusal.code })
		: t("mobile.computers.storage_refused.no_code");
}

/**
 * What the own-tunnel screen says when Save and connect was refused: the
 * keystore's sentence when that was the cause, else the relay's own sanitised
 * sentence, else a generic one that still tells the reader their entries are
 * kept. Never empty, so the inline alert cannot render a bare title.
 */
/**
 * The "Connected, but not saved" body: the route is live, the keystore refused to
 * keep it. Deliberately NOT `secureStorageRefusalSentence` (design D3 / UX U2 /
 * QA Q1, PR #220): that sentence says "Try again, or reinstall the app", but this
 * notice's only action is Continue, and the commonest web cause — a saved route
 * over the keystore's size cap — fails identically on every retry. So it says
 * what happened and what it costs, and keeps the platform code for support.
 */
export function saveRefusalSentence(refusal: SecureStorageRefusal): string {
	return refusal.code
		? t("mobile.computers.save_refused.body_with_code", { code: refusal.code })
		: t("mobile.computers.save_refused.body");
}

export function connectRefusalSentence(input: {
	detail: string | null;
	storageRefusal: SecureStorageRefusal | null;
	/** The store's surface for the refusal; `password` is the relay's 401. */
	surface?: ErrorSurface | null;
}): string {
	if (input.storageRefusal)
		return secureStorageRefusalSentence(input.storageRefusal);
	/* A refusal whose cause is KNOWN gets the reader's sentence with its next step
	 *  (design D2, PR #220): the relay's own detail for a 401 is the bare fragment
	 *  "Authentication required", which names no fix. Every other surface keeps
	 *  the relay's sanitised sentence, which is already written for the reader. */
	if (input.surface === "password")
		return t("mobile.computers.connect_refused.password");
	const detail = input.detail?.trim();
	return detail ? detail : t("mobile.computers.connect_refused.generic");
}

export function refusalFromError(input: {
	error: RelayError | null;
	surface: ErrorSurface;
	detail: string | null;
	retryAfterMs: number | null;
	subject: string;
	/** The store's keystore refusal, when that was the cause. */
	storageRefusal?: SecureStorageRefusal | null;
	/** The chosen computer's discovery row, when there is one: its live billing
	 *  and status are what split a tunnel 403 into a fixable cause. */
	computer?: RefusalComputer | null;
	/** The route is a Radient tunnel (see `refusalCopy`). */
	radientRoute?: boolean;
}): RefusalView | null {
	if (input.surface === "none") return null;
	const copy = refusalCopy(input);
	/* The error describes THIS refusal only when it raised this surface (R2): a
	 *  stale mint error must not lend its kind to a later sign-out, or the
	 *  surface loses "Sign in again". */
	const own =
		input.error !== null && input.error.surface === input.surface
			? input.error
			: null;
	if (own instanceof TunnelConnectionError) {
		return {
			kind: own.refusalKind,
			subject: input.subject,
			/* A named cause says it in the reader's words; the mint's
			 *  `disabled_help` ("this tunnel isn't active right now") was the line
			 *  Home's Show details still printed under it (PR #261 Q2). */
			detail: copy ? null : (own.detail ?? null),
			/* Null, as before: the mint's 403/402 has no command that fixes it, and
			 *  the split copy's own buttons are the remedy. */
			remedy: null,
			retryAfterMs: input.retryAfterMs,
			copy,
		};
	}
	return {
		kind: refineConnectionKind(own) ?? KIND[input.surface],
		subject: input.subject,
		/* The relay's own sentence wins when it has one, and reaches the surface only
		 *  through the taxonomy's ONE copy accessor.
		 *
		 *  This read `input.error?.detail` and the comment beside it claimed `.detail`
		 *  was "already redacted by the protocol layer". It was not: `detail` carries
		 *  whatever body arrived, and `<html><body>502 Bad Gateway</body></html>` is a
		 *  body a tunnel edge happily sends. `displayableMessage` is the accessor that
		 *  refuses a runtime's own words, an empty body and markup, so the refinement is
		 *  read from it and the surface cannot be handed markup by either path. */
		/* A diagnostic surface shows its detail only behind "Show details"; a keystore
		 *  refusal puts the reader's sentence (with the platform code) there instead of
		 *  the bare `RelayError · rejected`, which named nothing they could act on. */
		detail:
			input.surface === "diagnostic"
				? input.storageRefusal
					? secureStorageRefusalSentence(input.storageRefusal)
					: input.error?.kind != null
						? `RelayError · ${input.error.kind}`
						: DIAGNOSTIC_FALLBACK
				: (input.detail ?? input.error?.displayableMessage ?? null),
		remedy:
			copy && BILLING_CAUSES.has(copy.cause)
				? null
				: copy && input.surface === "console"
					? splitRemedy(copy)
					: (REMEDY[input.surface] ?? null),
		retryAfterMs: input.retryAfterMs,
		copy,
	};
}

/**
 * Home's landing recovery for a refusal (PR #261 Q2). Home is where a
 * signed-in reader lands after auto-connect, and its generic recovery said
 * "The app couldn't connect to this computer." with only Retry — and Show
 * details still read "Radient says this tunnel isn't active right now", the
 * sentence the operator asked to remove. A refusal whose cause this module
 * NAMED (a C1 reason, a kind, a 403 split) renders the same refusal surface
 * Settings and Computers show: title, body and buttons. Sign-in and the
 * offline/restoring states keep Home's own recovery, which already acts on
 * them.
 */
export function homeNamedRefusal(
	recovery: "restoring" | "no-host" | "auth" | "offline" | "error" | null,
	refusal: RefusalView | null,
): RefusalView | null {
	return recovery === "error" && refusal?.copy ? refusal : null;
}
