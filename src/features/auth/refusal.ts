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
 */

import type { SecureStorageRefusal } from "@/connection/secure-storage-refusal";
import type { TunnelSessionError } from "@/connection/tunnel-session";
import { t } from "@/i18n";
import { type ErrorSurface, RelayError } from "@/relay";
import type { RefusalKind } from "@/ui/components/refusal-surface";

// Keep the control-plane cause typed through the shared RelayError/store path.
// A 200/schema failure is not a gateway authorization refusal and must never
// inherit the generic console/`lop login` remedy. Only server-owned changes do.
class TunnelConnectionError extends RelayError {
	readonly refusalKind: RefusalKind;
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
	}
}
export const tunnelSessionRelayError = (
	error: TunnelSessionError,
): RelayError => new TunnelConnectionError(error);

export type RefusalView = {
	kind: RefusalKind;
	/** What was being reached, named for the reader. */
	subject: string;
	/** The gateway's or relay's own sentence, when it sent one. */
	detail: string | null;
	/** The exact local command for a machine-side cause, when one exists. */
	remedy: string | null;
	/** A server-supplied backoff. */
	retryAfterMs: number | null;
};

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
	console: "On that computer: lop login radient",
	"tunnel-gone": "On that computer: lop tunnel connect <tunnel-id>",
	"relay-stopped": "On that computer: lop mobile",
	"computer-offline": "On that computer: lop tunnel status",
};

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
}): RefusalView | null {
	if (input.surface === "none") return null;
	if (input.error instanceof TunnelConnectionError) {
		return {
			kind: input.error.refusalKind,
			subject: input.subject,
			detail: input.error.detail ?? null,
			remedy: null,
			retryAfterMs: input.retryAfterMs,
		};
	}
	return {
		kind: refineConnectionKind(input.error) ?? KIND[input.surface],
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
					: `RelayError · ${input.error?.kind ?? "connection-response"}`
				: (input.detail ?? input.error?.displayableMessage ?? null),
		remedy: REMEDY[input.surface] ?? null,
		retryAfterMs: input.retryAfterMs,
	};
}
