/**
 * The config stream's lifecycle: opened once per live route, stopped with it.
 *
 * The failure rules are the two the contract draws, and they differ on purpose:
 *
 * 1. **A relay-own `404` is ABSENCE, never a failure.** An older relay does not
 *    serve `/api/config/events` at all; `isRelayMissing` recognises its `404` —
 *    and deliberately NOT an edge/gateway `unknown-tunnel` 404, which is a dead
 *    tunnel owned by the connection surface and proves nothing about the route.
 *    Absence marks the store and NEVER retries: the route cannot appear
 *    mid-session, and the relay web's client reached the same conclusion (its
 *    one probe before subscribing). `supported: false` is how a later reader of
 *    the store tells "no language channel" from "no frame yet".
 * 2. **Everything else follows the list stream's policy, verbatim** (see the
 *    `onError` branch in `connection-provider.tsx`): a failure whose `surface`
 *    the reader must act on ends the loop — never retry a 401 or a revoked
 *    tunnel in a tight cycle — and a transient one (`none` / `retry` /
 *    `computer-offline`) reopens after `restartMs`. The phone's network is the
 *    phone's network; the two streams ride it the same way.
 *
 * This stream paints nothing: it fills `config-store` only, and no screen reads
 * that store yet (wave-5 slice D is the mechanism; the catalogue slices are
 * what will). That is also why the fatal branch does not touch the connection
 * store — the list stream owns the surfaces, and a second writer would
 * double-paint a refusal the reader has already been shown.
 *
 * One habit is borrowed from the sessions stream (its round-1 R1-1): a frame
 * the schema refuses is DROPPED with a warning — the last good value stays,
 * and the drop is never silent.
 */

import { shouldWakeStream } from "@/features/session/resume-plan";
import { isRelayMissing, type RelayEndpoints, type RelayStream } from "@/relay";
import type { ConfigStoreApi } from "@/state/config-store";

/** How long the stream waits before reopening after a transport failure — the
 *  list stream's cadence (connection-provider `RESTART_MS`), kept in step by
 *  intent. The provider passes its own constant; this default serves callers
 *  that are not the provider (tests, tooling). */
const DEFAULT_RESTART_MS = 2_000;

export interface ConfigStreamHandle {
	stop: () => void;
	/** A return to the foreground (`connection-provider.tsx`'s resume owner).
	 *  Reopens at once when the stream has been silent past the wake threshold or
	 *  is waiting out its restart delay; a stream that is terminal (an older
	 *  relay's 404, or a refusal the reader must act on) stays stopped. Returns
	 *  whether it reopened. */
	wake: (now?: number) => boolean;
}

/**
 * Starts the stream and returns the handle that ends it. `stop()` is final: no
 * timer survives it and no later frame reaches the store.
 */
export function startConfigStream(
	client: RelayEndpoints,
	store: ConfigStoreApi,
	options: { restartMs?: number } = {},
): ConfigStreamHandle {
	const restartMs = options.restartMs ?? DEFAULT_RESTART_MS;
	let stopped = false;
	let stream: RelayStream | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	/* Wake bookkeeping: when the stream last showed a sign of life, and whether
	 * it ended for good. A suspended phone's socket dies without a word, so
	 * silence — not an error — is what a return has to read. */
	let seenAt: number | null = null;
	let terminal = false;
	/* Tags each `run()`'s stream so one a wake retired cannot schedule a
	 * restart (or flip `terminal`) from a late callback. */
	let runSeq = 0;

	const run = (): void => {
		if (stopped) return;
		const seq = ++runSeq;
		stream = client.configStream({
			onFrame: (frame) => {
				if (frame.kind === "malformed") {
					/* NOT SILENT — the sessions stream's own round-1 rule
					 * (`connection-provider.tsx:341-356`): a frame the schema refuses is
					 * dropped so the last good value stays, but the drop is REPORTED, on the
					 * log, for whoever is diagnosing a language that stopped moving. No
					 * stale mark: that mark exists to paint the list's "Last updated" label,
					 * and nothing renders from this store yet. */
					console.warn(
						`[config] an unreadable ${frame.event} frame was dropped; the language keeps its last good value`,
						frame.error,
					);
					return;
				}
				seenAt = Date.now();
				if (frame.kind !== "config") return;
				store.getState().applyFrame(frame.data);
			},
			onState: (status) => {
				/* An OPEN is what proves the route served: `supported` answers
				 * "does this relay speak the config stream", and a `404` can never
				 * open. Frames then carry the value. */
				if (status.state === "open" || status.state === "rotating")
					seenAt = Date.now();
				if (status.state === "open") store.getState().markSupported();
			},
			onError: (error) => {
				if (stopped || seq !== runSeq) return;
				if (isRelayMissing(error)) {
					terminal = true;
					store.getState().markAbsent();
					return;
				}
				if (
					error.surface &&
					error.surface !== "none" &&
					error.surface !== "retry" &&
					error.surface !== "computer-offline"
				) {
					terminal = true;
					return;
				}
				timer = setTimeout(() => {
					timer = undefined;
					run();
				}, restartMs);
			},
		});
		/* START IT: `SseConnection` is inert until `start()` — the constructor
		 * only stores its options (the same rule the list stream documents at
		 * length in `connection-provider.tsx`, where a stream that was built and
		 * never started left the list unpainted for four app loads). Re-started
		 * on every `run()`: the retry path builds a new stream, and a stream that
		 * is not started is the same defect with a fresh object. */
		stream.connection.start();
	};

	run();

	return {
		wake: (now = Date.now()) => {
			if (stopped || terminal) return false;
			if (
				!shouldWakeStream({
					silentMs: seenAt === null ? null : now - seenAt,
					inBackoff: timer !== undefined,
				})
			)
				return false;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			runSeq += 1;
			stream?.stop();
			seenAt = now;
			run();
			return true;
		},
		stop: () => {
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			stream?.stop();
		},
	};
}
