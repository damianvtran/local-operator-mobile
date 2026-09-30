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

import type { ErrorSurface, RelayError } from "@/relay";
import type { RefusalKind } from "@/ui/components/refusal-surface";

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
 * `ErrorSurface` → `RefusalKind`.
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
/** `ErrorSurface` → `RefusalKind`, exhaustively over the CURRENT union: a surface
 *  added upstream breaks this file's types until it has copy, which is the point —
 *  the alternative is a failure that maps to `undefined` and renders nothing. */
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

export function refusalFromError(input: {
	error: RelayError | null;
	surface: ErrorSurface;
	detail: string | null;
	retryAfterMs: number | null;
	subject: string;
}): RefusalView | null {
	if (input.surface === "none") return null;
	return {
		kind: refineConnectionKind(input.error) ?? KIND[input.surface],
		subject: input.subject,
		/* The relay's own sentence wins when it has one, and reaches the surface
		 * only when it is not secret material: `RelayError.detail` is already
		 * redacted by the protocol layer, and it never carries a status code. */
		detail: input.detail ?? input.error?.detail ?? null,
		remedy: REMEDY[input.surface] ?? null,
		retryAfterMs: input.retryAfterMs,
	};
}
