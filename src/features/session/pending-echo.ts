/**
 * Pending echoes — the client-local row for an instruction that is in flight.
 *
 * Ported from the relay's web client (`local_operator/mobile/web/src/pending-echo.ts`
 * in the Local Operator repository) so the phone and the relay reconcile a sent
 * message by the same rules. Before this, a send — and especially a STEER, the one
 * flow that exists only while a turn is running — left the user's words in the
 * composer until the daemon answered, so on a phone link a send looked like
 * nothing had happened until the message popped into the conversation. The row is
 * painted the instant the envelope is held, and withdrawn or replaced the instant
 * the truth about it arrives.
 *
 * ## Reconciliation is by IDENTITY, never by words
 *
 * The key is the retry envelope's own `command_id`, and it is exact because that
 * id is ALSO the id of the user message the session will write: the relay's phone
 * route hands `message_id=command.command_id` to `Session.prompt`, the durable
 * writer keeps it as the transcript entry id, and the projection emits the row
 * with `id=message.id` — live and on replay alike. Matching on the TEXT instead
 * would take a second "yes" for the first one already on screen and never paint
 * it.
 *
 * The KIND is not part of the identity: the fold writes a phone row as `user`, as
 * `steer`, or — for a hub-envelope rewrite — as `parent_message`, all under that
 * one id (`COMMAND_ROW_KINDS`). Matching `user` alone shipped a permanent
 * duplicate on the relay's steer path.
 *
 * ## Exactly one row, structurally
 *
 * A held echo is never rendered while the transcript already carries its id (see
 * `usePendingEchoes`), so the pending row and its real row cannot both be on
 * screen in any frame — including the frame between the projection arriving and
 * the store entry being dropped. That holds whichever arrives first: a real row
 * that lands BEFORE the echo is even registered (a fast steer echo racing the
 * POST's resolution) filters the echo out on its first render.
 *
 * ## Everything that ends an echo
 *
 *   - the transcript carries the id: the real row owns the message now (drop);
 *   - the send threw: the composer's own failure line — with its Retry under the
 *     SAME envelope id when delivery is ambiguous — is the honest state from
 *     there, never a row that looks sent (withdraw), and the draft goes back.
 *
 * There is deliberately NO timeout, as on the relay: a `prompt admitted` that the
 * transcript has not caught up with yet, and a steer queued for a later step, are
 * both rows the session genuinely still owes.
 *
 * Nothing is persisted: the retry envelope already survives a relaunch and the
 * composer's mount offers the retained retry. The echo is still PRIVATE content —
 * it holds what the user typed — so `clearAuthorizationData` drops it with every
 * other content-bearing store.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PromptImage, TranscriptEntry } from "@/contracts";
import { t } from "@/i18n";
import type { ContinuationEnvelope, ContinuationOp } from "@/relay";

/** One in-flight command, as the row that stands in for it needs it. */
export interface PendingEcho {
	/** The envelope's id, and the id the session will write its row under. */
	commandId: string;
	/** Exactly the body the envelope carries — never the live draft. */
	text: string;
	/** Attachment count only: the composer owns the image bytes. */
	imageCount: number;
	/** Which command this was: a steer settles into the transcript's steer row and
	 *  a prompt into the user bubble, and the pending row takes that box so the
	 *  receipt is a caption leaving rather than a row changing register. */
	op: ContinuationOp;
	/** Whether the daemon ACKNOWLEDGED the command (the POST answered 2xx): the
	 *  only thing separating "we do not know yet" from "the session has it and
	 *  has not written the row yet", and the two need different words. */
	accepted: boolean;
}

/** The kinds a user-authored row is written under, carrying the command id the
 *  client minted (see the header). An id-only test is deliberately not used:
 *  `notice`, `tool` and `assistant` ids are minted by the session, the provider
 *  or the fold, and a collision there would retire a row the session never
 *  wrote. */
const COMMAND_ROW_KINDS: ReadonlySet<TranscriptEntry["kind"]> = new Set([
	"user",
	"steer",
	"parent_message",
]);

/** What the pending row says, for the state the echo is in — the relay's three
 *  states, word for word:
 *
 *  - `sending…` — no receipt yet: nothing is known about what happened.
 *  - `queued — …` — the receipt named a STEER: delivered, waiting for a step
 *    boundary. Saying `sending…` for the rest of a long turn is the reading that
 *    invited a second send on the relay. The two tenses are the TUI's own two
 *    states for a queued steer.
 *  - `sent` — accepted, and not a steer: the session's own row is imminent. */
export function pendingEchoCaption(
	echo: PendingEcho,
	streaming: boolean,
): string {
	if (!echo.accepted) return t("mobile.session.pending_echo.sending");
	if (echo.op !== "steer") return t("mobile.session.pending_echo.sent");
	return streaming
		? t("mobile.session.pending_echo.queued_step")
		: t("mobile.session.pending_echo.queued_next");
}

/** Per session, because two conversations can each have a send in flight. */
const echoes = new Map<string, PendingEcho[]>();
const listeners = new Set<() => void>();

/** One stable empty list, so a session with no echo keeps a referentially stable
 *  snapshot (`useSyncExternalStore` compares with Object.is). */
const NONE: PendingEcho[] = [];

function emit(): void {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Paint the row for a held envelope. Idempotent per id: a retry of an envelope
 *  whose echo is still up must not paint a second row. */
export function registerPendingEcho(
	sessionId: string,
	echo: PendingEcho,
): void {
	const held = echoes.get(sessionId);
	if (held) {
		if (held.some((item) => item.commandId === echo.commandId)) return;
		echoes.set(sessionId, [...held, echo]);
	} else {
		echoes.set(sessionId, [echo]);
	}
	emit();
}

export function withdrawPendingEcho(
	sessionId: string,
	commandId: string,
): void {
	const held = echoes.get(sessionId);
	if (!held) return;
	const next = held.filter((item) => item.commandId !== commandId);
	if (next.length === held.length) return;
	if (next.length === 0) echoes.delete(sessionId);
	else echoes.set(sessionId, next);
	emit();
}

/** Record the daemon's acknowledgement. `op` is the op the command was finally
 *  delivered as: the send path may replay a refused prompt as a steer under the
 *  same id (or the reverse), and the row has to take the box it will settle
 *  into. A silent no-op when the echo is already gone — the transcript may have
 *  answered it first, and a steer's receipt can land after its row. */
export function markPendingEchoAccepted(
	sessionId: string,
	commandId: string,
	op?: ContinuationOp,
): void {
	const held = echoes.get(sessionId);
	if (!held) return;
	const index = held.findIndex((item) => item.commandId === commandId);
	const current = held[index];
	if (current === undefined) return;
	const nextOp = op ?? current.op;
	if (current.accepted && current.op === nextOp) return;
	const next = [...held];
	next[index] = { ...current, accepted: true, op: nextOp };
	echoes.set(sessionId, next);
	emit();
}

/** The composer surface the two helpers below move a draft through. */
export interface EchoDraft {
	/** The visible draft, trimmed, and how many images it holds — read at call
	 *  time, so text typed while the request was out is seen. */
	read(): { text: string; imageCount: number };
	clear(): void;
	restore(text: string, images: PromptImage[]): void;
}

/** What `paintPendingEcho` did, for `unpaintPendingEcho` to undo. */
export interface PaintedEcho {
	commandId: string;
	movedDraft: boolean;
}

/** Paints the pending row for a just-held envelope and, when the envelope IS what
 *  the composer was sending, moves the draft out of the composer and into that
 *  row. Leaving it in both places reads as a send that had not happened — the
 *  relay's original defect.
 *
 *  A replay of a DIFFERENT body (an earlier unresolved envelope, or a Retry while
 *  the reader has typed something new) paints its row and leaves the draft:
 *  that text was not sent, and clearing it would be the loss the envelope design
 *  refuses. The move itself loses nothing: the envelope is durably held BEFORE
 *  this runs (`sendPersistedCommand`'s `onHeld`), so a kill mid-flight reopens on
 *  the retained-retry affordance. */
export function paintPendingEcho(
	sessionId: string,
	envelope: ContinuationEnvelope,
	sent: { text: string; images: readonly PromptImage[] | undefined },
	draft: EchoDraft,
): PaintedEcho {
	registerPendingEcho(sessionId, {
		commandId: envelope.command_id,
		text: envelope.text,
		imageCount: envelope.images?.length ?? 0,
		op: envelope.op,
		accepted: false,
	});
	const movedDraft =
		envelope.text === sent.text &&
		JSON.stringify(envelope.images ?? []) === JSON.stringify(sent.images ?? []);
	if (movedDraft) draft.clear();
	return { commandId: envelope.command_id, movedDraft };
}

/** A send that threw: the row comes DOWN — a row left standing would be a
 *  message the reader believes went — and the composer's failure line (with
 *  Retry under the SAME envelope id when delivery is ambiguous) is the honest
 *  state from there. A draft the send moved out goes back, but only into an
 *  EMPTY composer: text typed since is theirs, and the retained envelope behind
 *  Retry still carries the failed body. */
export function unpaintPendingEcho(
	sessionId: string,
	painted: PaintedEcho | null,
	sent: { text: string; images: PromptImage[] },
	draft: EchoDraft,
): void {
	if (painted === null) return;
	withdrawPendingEcho(sessionId, painted.commandId);
	if (!painted.movedDraft) return;
	const visible = draft.read();
	if (visible.text === "" && visible.imageCount === 0)
		draft.restore(sent.text, sent.images);
}

/** Drop every echo on this device — for the auth boundary: a signed-out user's
 *  words must not be shown to whoever signs in next. */
export function clearPendingEchoes(): void {
	if (echoes.size === 0) return;
	echoes.clear();
	emit();
}

/** The ids the transcript carries a user-authored row for. */
function projectedCommandIds(entries: readonly TranscriptEntry[]): Set<string> {
	const ids = new Set<string>();
	for (const entry of entries) {
		if (COMMAND_ROW_KINDS.has(entry.kind)) ids.add(entry.id);
	}
	return ids;
}

/** Pure form of the hook's filter, for tests and for any caller outside React. */
export function owedPendingEchoes(
	held: readonly PendingEcho[],
	entries: readonly TranscriptEntry[],
): PendingEcho[] {
	const projected = projectedCommandIds(entries);
	return held.filter((echo) => !projected.has(echo.commandId));
}

/** The echoes this session still owes a row for — excluding any the transcript
 *  already answered, so exactly one row per command is ever on screen.
 *
 *  The session screen repaints on every streamed frame; see `live` for why the
 *  answer stays the same array until an echo actually changes. */
export function usePendingEchoes(
	sessionId: string,
	entries: readonly TranscriptEntry[],
): PendingEcho[] {
	const held = useSyncExternalStore(
		subscribe,
		() => echoes.get(sessionId) ?? NONE,
		() => echoes.get(sessionId) ?? NONE,
	);
	const projected = useMemo(() => projectedCommandIds(entries), [entries]);
	/* Kept referentially STABLE while its contents are: `entries` is a new array
	 * on every streamed frame, so a plain memo would still hand the screen a new
	 * list ten times a second and re-render the footer that hosts the rows. */
	const previous = useRef<PendingEcho[]>(NONE);
	const live = useMemo(() => {
		const owed = held.filter((echo) => !projected.has(echo.commandId));
		const last = previous.current;
		if (
			owed.length === last.length &&
			owed.every((item, index) => item === last[index])
		)
			return last;
		return owed;
	}, [held, projected]);
	previous.current = live;
	/* Drop answered entries from module state. Separate from the filter on
	 * purpose: the filter makes the frame correct, this keeps a long-lived app
	 * from accumulating one dead entry per send — and stops a transcript that
	 * later loses the row (a re-cap) from resurrecting a phantom. */
	useEffect(() => {
		for (const echo of held) {
			if (projected.has(echo.commandId)) {
				withdrawPendingEcho(sessionId, echo.commandId);
			}
		}
	}, [held, projected, sessionId]);
	return live;
}
