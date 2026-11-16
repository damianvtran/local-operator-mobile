import { t } from "../i18n";

/** Closed, server-owned failure vocabulary. A peer's permission refusal is not
 * phone authentication, and an ambiguous receipt must never authorize replay. */
const REMOTE_ERRORS = {
	remote_owner_unresolved: { status: 503, key: "owner_unresolved" },
	remote_unreachable: { status: 503, key: "unreachable" },
	remote_unsupported: { status: 409, key: "unsupported" },
	remote_forbidden: { status: 403, key: "forbidden" },
	remote_session_missing: { status: 404, key: "session_missing" },
	remote_cursor_missing: { status: 409, key: "cursor_missing" },
	remote_command_ambiguous: { status: 409, key: "command_ambiguous" },
} as const;

export type RemoteErrorCode = keyof typeof REMOTE_ERRORS;
export const isRemoteErrorCode = (code: unknown): code is RemoteErrorCode =>
	typeof code === "string" && Object.hasOwn(REMOTE_ERRORS, code);

export const remoteFailureMessage = (code: RemoteErrorCode): string =>
	t(`mobile.remote_sessions.${REMOTE_ERRORS[code].key}`);

export const isRemoteFailureResponse = (
	status: number,
	body: Record<string, unknown> | undefined,
): boolean =>
	body?.remote === true &&
	isRemoteErrorCode(body.code) &&
	REMOTE_ERRORS[body.code].status === status;
