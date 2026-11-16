import type { Capabilities, SessionSummary } from "@/contracts";
import { isRemoteRow } from "./session-projection";

/** Owner metadata survives navigation even when a later list omits an offline
 * peer. It is NOT authority: every request still uses the relay's session-id
 * route, whose server resolves and pins the authorized owner. */
export const sessionLocation = (session: SessionSummary): string => {
	const path = `/session/${encodeURIComponent(session.session_id)}`;
	if (!isRemoteRow(session)) return path;
	const query = new URLSearchParams({ remote: "1" });
	if (session.owner_device) query.set("owner", session.owner_device);
	return `${path}?${query}`;
};

/** Whether the open conversation is remote. The live list row wins once it
 * exists — a conversation recalled to this computer while open must stop being
 * treated as remote (review R1-6) — and the route's `remote=1` covers a peer
 * that dropped out of the listing. */
export const remoteConversationOf = (
	row: SessionSummary | undefined,
	routeRemote: string | undefined,
): boolean => (row !== undefined ? isRemoteRow(row) : routeRemote === "1");

/** Dictation uploads audio to the CONNECTED computer. A remote conversation
 * cannot claim that as its owner's audio support or carry its local input_path
 * to the peer. Omitting STT hides both record and misleading local setup UI;
 * image-only pickers and ordinary typed prompt/steer remain available. */
export const sessionCapabilities = (
	capabilities: Capabilities,
	remote: boolean,
): Capabilities => {
	if (!remote) return capabilities;
	const { stt: _localStt, ...remoteCapabilities } = capabilities;
	return remoteCapabilities;
};

/** An absent/partial capability is an older or incomplete relay, not an empty
 * conversation. Only the agreed version-1 baseline admits the normal screen. */
export const remoteSessionsAvailable = (
	capabilities: Capabilities,
): boolean => {
	const capability = capabilities.remote_sessions;
	return (
		capability?.available === true &&
		capability.version === 1 &&
		capability.view === true &&
		capability.history === true &&
		capability.supported_command_ops?.includes("prompt") === true &&
		capability.supported_command_ops.includes("steer") &&
		capability.media === true &&
		["image", "video", "file"].every((kind) =>
			capability.supported_media_kinds?.includes(kind),
		) &&
		capability.file_sources?.includes("retained_document") === true
	);
};

/** v1 has no owner-bound generated/supplement-file contract. Never expose a
 * stale Highlights/preview client merely because a projection contains beats. */
export const sessionSupplementClient = <T>(
	remote: boolean,
	client: T,
): T | undefined => (remote ? undefined : client);
