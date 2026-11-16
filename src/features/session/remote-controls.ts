import type { Capabilities } from "@/contracts";
import type { ComposerChip } from "@/features/session/chip-labels";
import type { PendingView } from "@/features/session/pending";
import { t } from "@/i18n";

/**
 * Which session controls a REMOTE conversation may offer, read from the relay's
 * own `capabilities.remote_sessions.supported_command_ops` — never a hardcoded
 * list (PR #271 review round 1, R1-1 / U2).
 *
 * Why this exists: the version-1 remote contract (core #4057) forwards only the
 * ops it lists — today `["prompt", "steer"]`. Every other control on the session
 * screen (Stop, approval/ask answers, the slash palette, the model/effort
 * pickers, Resume) used to stay live for a remote row and leaned on the relay's
 * `409 remote_unsupported`, so the reader tapped Stop or Approve, got an error
 * telling them to update both computers, and the agent kept waiting. A control
 * the protocol cannot carry must not be offered at all.
 *
 * Constraints:
 *  - Local conversations are untouched: `allows` is always true for them.
 *  - Driven by the capability, so a later relay that advertises e.g. `abort`
 *    lights Stop back up with no client change. An absent list allows nothing
 *    beyond what admission already proved (`remoteSessionsAvailable` requires
 *    prompt + steer before the screen mounts).
 *  - `resume` is not a command op (it is `POST /api/sessions/resume`, a
 *    connected-computer route with no remote form in v1); it is gated by the
 *    same set so that a future relay can advertise it the same way.
 *  - The owner name used in copy is DISPLAY-ONLY; it never reaches a transport.
 */
export type SessionControlOp =
	| "prompt"
	| "steer"
	| "abort"
	| "approval_answer"
	| "ask_answer"
	| "ask_respond"
	| "ask_decline"
	| "ask_dismiss"
	| "slash"
	| "set_model"
	| "set_effort"
	| "resume";

export type SessionControlPolicy = {
	remote: boolean;
	allows: (op: SessionControlOp) => boolean;
};

export const sessionControlPolicy = (
	capabilities: Capabilities | null | undefined,
	remote: boolean,
): SessionControlPolicy => {
	if (!remote) return { remote: false, allows: () => true };
	const supported = new Set(
		capabilities?.remote_sessions?.supported_command_ops ?? [],
	);
	return { remote: true, allows: (op) => supported.has(op) };
};

/** The one honest sentence for a withheld remote control, naming where the
 *  action does work. Used as the pending card's boundary, the chips' hint and the
 *  composer's refusal of a typed slash command. */
export const remoteOwnerOnlyCopy = (owner: string): string =>
	t("mobile.remote_sessions.owner_only", { owner });

/** A pending approval/ask on a remote conversation whose answer op the relay
 *  does not forward: keep the card (the reader must still see the agent is
 *  waiting) but drop its controls through the card's existing `terminalOnly`
 *  path and say where to answer. */
export const remotePendingView = (
	view: PendingView,
	policy: SessionControlPolicy,
	owner: string,
): PendingView => {
	if (!policy.remote) return view;
	const op =
		view.kind === "approval" ? "approval_answer" : ("ask_answer" as const);
	if (policy.allows(op)) return view;
	return {
		...view,
		terminalOnly: true,
		boundarySentence: remoteOwnerOnlyCopy(owner),
	};
};

/** The model/effort chip of a remote conversation whose `set_model`/`set_effort`
 *  is not forwarded: keep the value visible (it is still true information about
 *  what the owner runs) but render it through the kit's existing disabled
 *  `unavailable` state, with the reason in the hint. */
export const remoteChip = (
	chip: ComposerChip,
	allowed: boolean,
	owner: string,
): ComposerChip => {
	if (allowed || chip.kind === "unavailable") return chip;
	return {
		kind: "unavailable",
		text: chip.kind === "value" ? chip.text : "—",
		accessibilityLabel: chip.accessibilityLabel,
		accessibilityHint: remoteOwnerOnlyCopy(owner),
	};
};
