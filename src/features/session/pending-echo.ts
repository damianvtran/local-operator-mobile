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
 *   - the send threw and the composer is EMPTY: the draft goes back into it and
 *     the row comes down — the composer's failure line (with its Retry under
 *     the SAME envelope id when delivery is ambiguous) is the honest state;
 *   - the send threw while the reader had typed something since: the row STAYS,
 *     re-captioned as a failure (`failure`), because it is now the only place
 *     the sent words are visible — a definitive refusal discards the envelope,
 *     and overwriting the new draft would lose THAT text instead. A refused row
 *     puts itself back ahead of the draft on a tap (`putBackPendingEcho`); an
 *     unconfirmed one waits for the composer's Retry, which repaints it under
 *     the same id. (Review round 1, R1/Q1/U1 and U3: withdrawing it lost text.)
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
import { USER_BUBBLE_BOX_CLASS } from "@/features/session/user-bubble";
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
	/** Set when the send threw and the row was KEPT because the reader had typed
	 *  since (see the header): `refused` — definitively not delivered, the row
	 *  is the text's only copy and puts itself back on a tap; `unconfirmed` — a
	 *  timeout or transport loss, and the retained envelope behind the composer's
	 *  Retry still holds it. Absent while the send is live. */
	failure?: "refused" | "unconfirmed";
	/** The image objects a `refused` row hands back with its text. Only a refused
	 *  row carries them: the composer has let go of them, and nothing else holds
	 *  them once the envelope is discarded. */
	images?: readonly PromptImage[];
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
	/* The failure captions name the remedy where the eye already is: the row is
	 *  what the reader watched go out, so it is where they look for what became
	 *  of it (design round 1, on the failure state). */
	if (echo.failure === "refused")
		return t("mobile.session.pending_echo.not_sent");
	if (echo.failure === "unconfirmed")
		return t("mobile.session.pending_echo.not_confirmed");
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
 *  whose echo is still up must not paint a second row. A row kept as a FAILURE
 *  is the exception: the composer's Retry replays that envelope under the same
 *  id, and the row goes back to `sending…` in place rather than staying failed
 *  beside a live send. */
export function registerPendingEcho(
	sessionId: string,
	echo: PendingEcho,
): void {
	const held = echoes.get(sessionId);
	if (held) {
		const index = held.findIndex((item) => item.commandId === echo.commandId);
		const existing = held[index];
		if (existing !== undefined) {
			if (existing.failure === undefined) return;
			const next = [...held];
			next[index] = echo;
			echoes.set(sessionId, next);
			emit();
			return;
		}
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
	/** Put text and images back AHEAD of the current draft (a newline between
	 *  the two texts), leaving what the reader has typed since intact. */
	prepend(text: string, images: readonly PromptImage[]): void;
}

/** What `paintPendingEcho` did, for `unpaintPendingEcho` to undo. */
export interface PaintedEcho {
	commandId: string;
	/** The draft was moved out of the composer into the row. */
	movedDraft: boolean;
	/** The envelope IS the draft that was sent, but the reader edited it before
	 *  the hold resolved, so it was left in place — the composer still holds
	 *  (an edit of) these words, and a failure need not keep the row. */
	draftKeepsBody: boolean;
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
 *  the retained-retry affordance.
 *
 *  The clear also requires the composer to STILL hold exactly what was sent:
 *  `holdNew` persists and may queue behind another send, so the reader can type
 *  between the tap and this call, and that text is not in the envelope (review
 *  round 1, R3). */
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
	const bodyIsDraft =
		envelope.text === sent.text &&
		JSON.stringify(envelope.images ?? []) === JSON.stringify(sent.images ?? []);
	const visible = draft.read();
	const draftUnchanged =
		visible.text === sent.text &&
		visible.imageCount === (sent.images?.length ?? 0);
	const movedDraft = bodyIsDraft && draftUnchanged;
	if (movedDraft) draft.clear();
	return {
		commandId: envelope.command_id,
		movedDraft,
		draftKeepsBody: bodyIsDraft && !draftUnchanged,
	};
}

/** A send that threw. Where the sent words go depends on what they would
 *  displace (see the header):
 *
 *  - the composer is EMPTY: they go back into it and the row comes down, so the
 *    composer's failure line is about the text in front of the reader —
 *    `"restored"`;
 *  - the composer still holds (an edit of) them, the reader having typed
 *    between tap and hold: the row comes down, nothing is lost — `"none"`;
 *  - the reader has typed something new since: the row STAYS, captioned with
 *    `failure`, and the new draft is untouched — `"kept"`. The caller words
 *    its failure line for an EARLIER message, because the text in the composer
 *    is not the one that failed (UX round 1, U1).
 *
 *  `failure` is the composer's reading of the error: `refused` when the relay
 *  definitively did not take it (the envelope is discarded, so the row is the
 *  only copy left), `unconfirmed` when delivery is ambiguous (the retained
 *  envelope still holds it, and Retry repaints this row). */
export function unpaintPendingEcho(
	sessionId: string,
	painted: PaintedEcho | null,
	sent: { text: string; images: readonly PromptImage[] },
	draft: EchoDraft,
	failure: "refused" | "unconfirmed",
): "none" | "restored" | "kept" {
	if (painted === null) return "none";
	const visible = draft.read();
	if (visible.text === "" && visible.imageCount === 0) {
		withdrawPendingEcho(sessionId, painted.commandId);
		draft.restore(sent.text, [...sent.images]);
		return "restored";
	}
	if (painted.draftKeepsBody) {
		withdrawPendingEcho(sessionId, painted.commandId);
		return "none";
	}
	failPendingEcho(
		sessionId,
		painted.commandId,
		failure,
		failure === "refused" ? sent.images : undefined,
	);
	return "kept";
}

/** Re-caption a row as failed, in place. A no-op when it is already gone. */
function failPendingEcho(
	sessionId: string,
	commandId: string,
	failure: "refused" | "unconfirmed",
	images: readonly PromptImage[] | undefined,
): void {
	const held = echoes.get(sessionId);
	if (!held) return;
	const index = held.findIndex((item) => item.commandId === commandId);
	const current = held[index];
	if (current === undefined) return;
	const next = [...held];
	next[index] = {
		...current,
		accepted: false,
		failure,
		...(images && images.length > 0 ? { images } : {}),
	};
	echoes.set(sessionId, next);
	emit();
}

/** The tap on a `refused` row: its words (and images) go back into the
 *  composer AHEAD of whatever is there, and the row comes down — the composer
 *  is the one place a message is edited and sent from. A no-op for any other
 *  row: a live one is still going out, and an unconfirmed one may have been
 *  delivered, so putting it back would invite a duplicate (Retry is its path). */
export function putBackPendingEcho(
	sessionId: string,
	commandId: string,
	draft: EchoDraft,
): void {
	const echo = echoes
		.get(sessionId)
		?.find((item) => item.commandId === commandId);
	if (echo?.failure !== "refused") return;
	withdrawPendingEcho(sessionId, commandId);
	draft.prepend(echo.text, echo.images ?? []);
}

/** The composer's failure line while a `refused` row is kept: it names the
 *  EARLIER message, because the text in the composer is not what failed, and
 *  points at the row's remedy. `reason` is the relay's own receipt sentence. */
export const earlierNotSentMessage = (reason: string): string =>
	t("mobile.session.pending_echo.earlier_not_sent", { reason });

/** The acknowledgement of an earlier message while the composer holds text the
 *  reader has not sent — a Retry over a new draft, or a draft edited while the
 *  request was out. It claims only that the earlier one WENT (its row says
 *  whether it is queued), and calls the text below unsent rather than "edited":
 *  in the rapid-steer case it is the next message (UX round 1, U2). */
export const earlierWentThroughNotice = (): string =>
	t("mobile.session.pending_echo.earlier_went_through");

/** The pending row's inner box, per op. Kept here, in a plain module, so a
 *  Node test can pin it. `items-end` is load-bearing: without it the block is as
 *  wide as its widest child, and under a caption wider than a short steer the
 *  steer's text sat left-aligned, then jumped ~77 px right when the caption
 *  left at handover (design round 1, D1). Hugging the end edge keeps the text's
 *  right edge where the settled row puts it.
 *
 *  A prompt takes the settled bubble's box EXACTLY (`USER_BUBBLE_BOX_CLASS`, no
 *  hairline), so the fill does not jump at handover (agent review round 1, M1;
 *  design D2). The pending signal stays in ink (`ink-muted`) and in the caption,
 *  which `pending-echo-row.tsx` renders BELOW the box, on canvas: `ink-dim` and
 *  `danger` are contracted on canvas but not on `user-bubble`.
 *
 *  A steer takes the SAME box (operator report, iOS 2026-11-11): it used to be
 *  an unfilled `px-1` block, which read as bare indented text rather than the
 *  operator's own message. The `op` parameter stays so a caller still says
 *  which command the row is, but the answer no longer depends on it. */
export const pendingEchoBoxClass = (_op: ContinuationOp): string =>
	`max-w-[85%] items-end ${USER_BUBBLE_BOX_CLASS}`;

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
