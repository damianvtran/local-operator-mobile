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
 */
import { isRelayMissing, type RelayEndpoints, type RelayStream } from "@/relay";
import type { ConfigStoreApi } from "@/state/config-store";

/** How long the stream waits before reopening after a transport failure — the
 *  list stream's cadence (connection-provider `RESTART_MS`), kept in step by
 *  intent. The provider passes its own constant; this default serves callers
 *  that are not the provider (tests, tooling). */
const DEFAULT_RESTART_MS = 2_000;

export interface ConfigStreamHandle {
	stop: () => void;
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

	const run = (): void => {
		if (stopped) return;
		stream = client.configStream({
			onFrame: (frame) => {
				if (frame.kind !== "config") return;
				store.getState().applyFrame(frame.data);
			},
			onState: (status) => {
				/* An OPEN is what proves the route served: `supported` answers
				 * "does this relay speak the config stream", and a `404` can never
				 * open. Frames then carry the value. */
				if (status.state === "open") store.getState().markSupported();
			},
			onError: (error) => {
				if (stopped) return;
				if (isRelayMissing(error)) {
					store.getState().markAbsent();
					return;
				}
				if (
					error.surface &&
					error.surface !== "none" &&
					error.surface !== "retry" &&
					error.surface !== "computer-offline"
				) {
					return;
				}
				timer = setTimeout(run, restartMs);
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
		stop: () => {
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			stream?.stop();
		},
	};
}
