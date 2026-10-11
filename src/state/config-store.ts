/**
 * The relay's resolved language, as the config stream paints it (wave-5 slice D).
 *
 * Two rules, and the second is the one a reviewer asks about:
 *
 * - **A frame replaces; there are no versions.** The stream opens with the
 *   current resolved language as its baseline frame (`changed_keys: []`, never a
 *   replay) and then publishes one frame per real change — so unlike the
 *   projections beside it, there is nothing here to fence, order or drop.
 * - **Absence is a state, not an error.** An older relay does not serve
 *   `/api/config/events` at all and answers a relay-own `404`; `supported:
 *   false` records that fact once — terminal for the route — so nothing
 *   re-attempts a route that cannot appear mid-session, and a consumer can tell
 *   "this relay has no language channel" (`false`) from "no frame has arrived
 *   yet" (`null`).
 */
import { createStore } from "zustand/vanilla";

export interface ConfigSnapshot {
	/** The RESOLVED locale tag the last frame carried, or `null` before the
	 *  first. Never the raw setting: the relay resolves `auto` before it is
	 *  sent, and an unshipped configured tag arrives as `en`. */
	language: string | null;
	/** `null` until the stream is attempted; `true` once it opens or a frame
	 *  arrives; `false` once a relay-own `404` proves the route absent. */
	supported: boolean | null;
	/** Frames applied. Diagnostics and tests — a change is observable here even
	 *  while every shipped locale still resolves to the same tag. */
	frameCount: number;
	/** Epoch ms of the last applied frame, or `null`. */
	lastFrameAt: number | null;
}

export interface ConfigActions {
	/** One `config` frame's payload, applied wholesale. `at` is injectable for
	 *  tests; it defaults to the wall clock. */
	applyFrame: (
		payload: { changed_keys: string[]; language: string },
		at?: number,
	) => void;
	/** The stream opened: this relay serves the route. */
	markSupported: () => void;
	/** A relay-own `404` proved the route absent (an older daemon). */
	markAbsent: () => void;
	/** Discards everything: a route end, where the value belongs to another
	 *  computer and the next route must be free to attempt the stream again. */
	reset: () => void;
}

export type ConfigStore = ConfigSnapshot & ConfigActions;

export type ConfigStoreApi = ReturnType<typeof createConfigStore>;

const INITIAL: ConfigSnapshot = {
	language: null,
	supported: null,
	frameCount: 0,
	lastFrameAt: null,
};

export function createConfigStore(deps: { now?: () => number } = {}) {
	const now = deps.now ?? (() => Date.now());
	return createStore<ConfigStore>()((set, get) => ({
		...INITIAL,
		applyFrame(payload, at) {
			set({
				language: payload.language,
				/* A frame can only arrive on an open stream; recording that here as
				 * well keeps `supported` true for a consumer that missed the open. */
				supported: true,
				frameCount: get().frameCount + 1,
				lastFrameAt: at ?? now(),
			});
		},
		markSupported() {
			set({ supported: true });
		},
		markAbsent() {
			set({ supported: false });
		},
		reset() {
			set({ ...INITIAL });
		},
	}));
}
