import { useEffect, useRef, useState } from "react";

import type { CheckpointManifest } from "@/contracts";
import type { RelayEndpoints } from "@/relay";

/**
 * The checkpoint rail's data half: one manifest read per conversation, and the
 * short poll that follows a `building` answer (design D2/D9's client
 * discipline, re-read for this route).
 *
 * WHY ONE READ AND A POLL, rather than a subscription: the manifest is derived
 * from the journal on demand, not pushed — the relay's only "come back later"
 * signal is `index.state: "building"` (a cold cache's FIRST answer is exactly
 * that, and serves whatever the previous scan held, which may be nothing). So
 * the hook paints whatever the last answer carried and polls ONLY while the
 * relay says `building`/`stale`; `stale` rides with `building` for the reason
 * the model groups them (the desktop rail's own grouping). A `ready` answer
 * ends the episode until the next conversation open — the desktop rail's
 * once-per-conversation read, kept deliberately: re-deriving ticks from
 * projection frames as they stream would be a second derivation beside the
 * journal's, and the wire has no per-frame checkpoint signal to follow.
 *
 * THE SNAPSHOT CONSEQUENCE, named so it is not mistaken for a bug: a turn
 * that completes while the reader is on the screen is not marked until the
 * conversation is reopened (the desktop rail's own behaviour — parity, not
 * a regression), and past the 45 s ceiling the last answer keeps painting —
 * a slow scan's `building` pulse can outlive its poll. A refresh on
 * completion settle is a possible follow-up lane, deliberately not built
 * here.
 *
 * THE FAILURES, TOLD APART (the rail's whole honesty story, `checkpoint-rail
 * .ts`): a read that FAILS with no manifest held reads as `unavailable` — no
 * claim either way, which is what an older relay's 404 must keep rendering
 * (the rail is pure decoration and degrades silently). A failure AFTER a
 * manifest exists keeps the last answer painting and stops the poll, because
 * the reader is looking at it and a poll failure is transient by construction.
 * The relay's OWN `index.state: "error"` is neither of these — it is an
 * answer, and the rail renders it as the failure mark, never as "no
 * checkpoints".
 *
 * A SESSION SWITCH NEVER LETS THE PREVIOUS ANSWER PAINT: the state carries
 * the session it belongs to, and a value for another conversation reads as
 * "no answer yet" until the new read lands (the `find.ts` rule for state that
 * does not belong to the screen it arrived on).
 *
 * POLL BUDGET. An episode runs at `CHECKPOINT_POLL_INTERVAL_MS` until the
 * relay stops answering `building` or the episode outlives
 * `CHECKPOINT_POLL_CEILING_MS` — the ceiling belongs to the EPISODE, not the
 * interval, so "45 s" is 45 seconds of polling rather than 45 seconds per
 * tick (the desktop hook's own rule). When it passes, the last answer keeps
 * painting and the poll stops; nothing retries until the next conversation
 * open. The endpoint's `signal` bounds each read, so a hung request cannot
 * pin the loop.
 */

/** The poll cadence while the relay answers `building`/`stale`. Sibling of the
 *  desktop rail's own 1.5 s — one product, one rhythm. */
export const CHECKPOINT_POLL_INTERVAL_MS = 1500;

/** How long one polling EPISODE may live before it gives up quietly. */
export const CHECKPOINT_POLL_CEILING_MS = 45_000;

export interface CheckpointsSession {
	/** The last manifest answered for THIS conversation, or `null`. */
	manifest: CheckpointManifest | null;
	/** A read failed while no manifest is held (older relay, dropped route). */
	readFailed: boolean;
}

export const useCheckpoints = (input: {
	sessionId: string;
	endpoints: RelayEndpoints | null;
}): CheckpointsSession => {
	const { sessionId, endpoints } = input;
	/**
	 * The answer AND the conversation it belongs to, in one value: a switch
	 * needs no reset effect (the stale answer simply stops matching), and a
	 * late read from the previous session cannot paint over the new one's.
	 */
	const [answer, setAnswer] = useState<{
		session: string;
		manifest: CheckpointManifest | null;
		readFailed: boolean;
	}>({ session: "", manifest: null, readFailed: false });

	/** Bumped on every session change and unmount: every async continuaton
	 *  guards on it (the desktop hook's epoch latch, same reason). */
	const epoch = useRef(0);
	const inFlight = useRef<AbortController | null>(null);
	const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pollDeadline = useRef<number | null>(null);

	useEffect(() => {
		if (endpoints === null || sessionId.length === 0) return;
		/* The client this episode reads from, frozen at effect time: a route
		 *  switch swaps `endpoints` identity, which re-runs this effect (and
		 *  bumps the epoch), so a later read never mixes two clients. */
		const client = endpoints;
		epoch.current += 1;
		const mine = epoch.current;

		const stopPoll = () => {
			if (pollTimer.current !== null) {
				clearTimeout(pollTimer.current);
				pollTimer.current = null;
			}
			pollDeadline.current = null;
		};

		/** Arm the next poll of this episode, if one is not already armed. */
		const schedulePoll = () => {
			if (mine !== epoch.current) return;
			if (pollTimer.current !== null) return;
			const deadline =
				pollDeadline.current ?? Date.now() + CHECKPOINT_POLL_CEILING_MS;
			pollDeadline.current = deadline;
			pollTimer.current = setTimeout(() => {
				pollTimer.current = null;
				if (mine !== epoch.current) return;
				if (Date.now() >= deadline) {
					pollDeadline.current = null;
					return;
				}
				void read();
			}, CHECKPOINT_POLL_INTERVAL_MS);
		};

		async function read() {
			if (mine !== epoch.current) return;
			inFlight.current?.abort();
			const controller = new AbortController();
			inFlight.current = controller;
			try {
				const manifest = await client.checkpoints(sessionId, controller.signal);
				if (mine !== epoch.current) return;
				setAnswer({ session: sessionId, manifest, readFailed: false });
				if (
					manifest.index.state === "building" ||
					manifest.index.state === "stale"
				) {
					schedulePoll();
				} else {
					stopPoll();
				}
			} catch {
				if (mine !== epoch.current || controller.signal.aborted) return;
				// Any failure keeps whatever answer is held (the rail decides
				// what a held manifest reads as); it only becomes a fact when
				// there is nothing to paint.
				setAnswer((current) =>
					current.session === sessionId
						? { ...current, readFailed: true }
						: { session: sessionId, manifest: null, readFailed: true },
				);
				stopPoll();
			}
		}

		void read();

		return () => {
			// Release the episode: a late answer from this conversation must
			// not paint after the switch, and a poll must not re-arm.
			epoch.current += 1;
			stopPoll();
			inFlight.current?.abort();
			inFlight.current = null;
		};
	}, [endpoints, sessionId]);

	if (answer.session !== sessionId) {
		return { manifest: null, readFailed: false };
	}
	return { manifest: answer.manifest, readFailed: answer.readFailed };
};
