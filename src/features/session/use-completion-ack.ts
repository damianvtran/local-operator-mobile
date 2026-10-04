/**
 * Ack-on-view: the phone's half of the completion read receipt.
 *
 * This is the native mirror of the web's `use-completion-view.ts` — same gates,
 * same cadence, same refusal discipline — expressed with `AppState` and the
 * transcript's own geometry instead of `document.visibilityState` and
 * `elementFromPoint`. The rule it implements (ADR 0006 §1.3 / :367-372):
 * **only a gesture, or a result a human actually rendered, may acknowledge
 * anything** — arriving, tapping or being woken by a push is NOT a read.
 *
 * What counts as "rendered", in this app's terms:
 *
 * - the app is foregrounded (`AppState === "active"`),
 * - the session screen is the focused route,
 * - the completion is present, settled (`!streaming`), and `unseen`,
 * - the anchored completion is COMPLETE (`final && text_complete` — the web
 *   selector's `data-completion-complete` half): a settled row can still be a
 *   transport-capped prefix, and a prefix's "end" is not the end,
 * - the token and anchor exist and the attention record names THIS
 *   conversation (identity is part of the verdict, never assumed),
 * - no sheet or panel holds the screen (the web's `blocked`), and
 * - the completion's END is genuinely on screen — the anchor row's bottom
 *   inside the transcript viewport, computed from the list's measurements
 *   (`completion-visibility.ts`, fed by `TranscriptList`).
 *
 * The recognition of the answer is the web's hard-won lesson, verbatim: a
 * resolved call is not a read. The response's own state must say
 * `unseen === false`, about this conversation, for this token; anything else —
 * including a 2xx that still says `unseen` (the superseded-token answer the
 * shipped daemon gave) — counts as an UNRESOLVED outcome and keeps the poll
 * running. Consecutive unresolved outcomes back the 500 ms cadence off up to
 * one attempt a minute; a `409` resolves itself the same way every other
 * refusal does: the next attempt re-reads the token the CURRENT projection
 * names (the daemon wakes the projection stream on a supersede; the refusal
 * carries no state on purpose).
 *
 * No `device_id` is sent: pre-registration it is meaningless, and the scope
 * says so. No local clearing either: the visible claim is the mark clearing on
 * the repaint the daemon wakes, never an optimistic edit.
 */

import { useIsFocused } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import type { SessionProjection } from "@/contracts";
import {
	ACK_CHECK_MS,
	ACK_FAILURES_BEFORE_BACKOFF,
	type AckGates,
	mayAcknowledge,
	retryDelayMs,
	settlesCompletion,
} from "@/features/session/completion-ack";
import { entryComplete } from "@/features/session/completion-visibility";
import type { RelayEndpoints } from "@/relay";

export interface CompletionAckInput {
	sessionId: string;
	/** The session screen's own relay client — the same one the composer sends
	 *  through. `null` while there is no route. */
	endpoints: RelayEndpoints | null;
	projection: SessionProjection | null;
	/** From `TranscriptList`: the anchor row's bottom is inside the viewport. */
	anchorVisible: boolean;
	/** A sheet or panel is open (models, effort, asks, slash, todos/subagents). */
	blocked: boolean;
}

export const useCompletionAck = ({
	sessionId,
	endpoints,
	projection,
	anchorVisible,
	blocked,
}: CompletionAckInput): void => {
	/* The latest render, read per attempt rather than closed over — the desktop
	 * twin's `live.current` pattern, and the reason a superseded token heals:
	 * the attempt sends the token the CURRENT projection names. */
	const liveRef = useRef({
		sessionId,
		endpoints,
		projection,
		anchorVisible,
		blocked,
	});
	liveRef.current = {
		sessionId,
		endpoints,
		projection,
		anchorVisible,
		blocked,
	};

	const focused = useIsFocused();
	const focusedRef = useRef(focused);
	focusedRef.current = focused;

	const appActiveRef = useRef(AppState.currentState === "active");
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			appActiveRef.current = state === "active";
		});
		return () => subscription.remove();
	}, []);

	const attention = projection?.attention ?? null;

	/* The dependency list is FIELD-level on purpose — the web client's own list —
	 * and exhaustive-deps wants the OBJECTS (`attention`/`projection`). Listing
	 * them would be worse than the rule it satisfies: their identity changes on
	 * every frame the stream repaints, so the loop would be torn down and its
	 * refusal budget restarted constantly — the cadence exists precisely to keep
	 * a completion acknowledged ONCE, as the same completion. The fields below
	 * are the facts that make a NEW completion / a new anchor / new unseen-ness
	 * or a new conversation identity — the events this loop exists for. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above
	useEffect(() => {
		/* The loop exists only while there is something to acknowledge — the
		 * web's rule: `unseen` is the one fact the loop is ABOUT, and every other
		 * gate is asked again per attempt so a momentary flip cannot kill it. */
		if (
			attention === null ||
			attention.unseen !== true ||
			attention.completion_token === null ||
			attention.anchor_id === null ||
			projection === null ||
			projection.streaming ||
			blocked ||
			endpoints === null
		) {
			return;
		}

		let cancelled = false;
		let pending = false;
		let acknowledged = false;
		/** Consecutive unresolved outcomes, and the earliest next attempt. */
		let refusals = 0;
		let nextAttempt = 0;

		const unresolved = (reason: unknown) => {
			refusals += 1;
			if (refusals === ACK_FAILURES_BEFORE_BACKOFF) {
				console.warn(
					`[attention] could not mark ${sessionId} read after ${refusals} attempts; backing off`,
					reason,
				);
			}
			if (refusals >= ACK_FAILURES_BEFORE_BACKOFF) {
				nextAttempt = Date.now() + retryDelayMs(refusals);
			}
		};

		const check = () => {
			if (cancelled || pending || acknowledged) return;
			if (Date.now() < nextAttempt) return;
			const live = liveRef.current;
			const client = live.endpoints;
			const current = live.projection?.attention ?? null;
			/* The anchored row's completeness, re-read per attempt like every other
			 * gate — the transcript can change between attempts, and a row that is
			 * not loaded resolves to NOT complete (the unknown-geometry direction,
			 * by the CURRENT anchor_id). */
			const anchorEntry = live.projection?.transcript.find(
				(entry) => entry.id === current?.anchor_id,
			);
			const gates: AckGates = {
				appActive: appActiveRef.current,
				focused: focusedRef.current,
				blocked: live.blocked,
				anchorVisible: live.anchorVisible,
				completionComplete:
					anchorEntry !== undefined && entryComplete(anchorEntry),
				streaming: live.projection?.streaming === true,
				unseen: current?.unseen === true,
				hasToken: typeof current?.completion_token === "string",
				hasAnchor: typeof current?.anchor_id === "string",
				sameConversation:
					live.projection?.session_id === live.sessionId &&
					current?.conversation_id === `session/${live.sessionId}`,
				hasClient: client !== null,
			};
			if (!mayAcknowledge(gates) || client === null) return;
			const token = current?.completion_token;
			if (typeof token !== "string") return;
			pending = true;
			void client
				.seen(live.sessionId, token)
				.then((answer) => {
					/* VERIFY, never latch on resolution — the three fields, and the
					 * token checks the one this attempt SENT. */
					if (
						settlesCompletion(answer.attention, {
							conversationId: `session/${live.sessionId}`,
							token,
						})
					) {
						acknowledged = true;
					} else {
						unresolved("answer did not settle the rendered completion");
					}
				})
				.catch((error: unknown) => {
					/* A refusal is not a read. 409 `superseded_completion_token`
					 * resolves itself: the next attempt reads the token the current
					 * projection names (the daemon wakes its stream on a supersede,
					 * and the refusal deliberately carries no state). */
					unresolved(error);
				})
				.finally(() => {
					pending = false;
				});
		};

		const timer = setInterval(check, ACK_CHECK_MS);
		check();
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [
		sessionId,
		endpoints,
		attention?.completion_token,
		attention?.anchor_id,
		attention?.unseen,
		attention?.conversation_id,
		projection?.session_id,
		projection?.streaming,
		blocked,
	]);
};
