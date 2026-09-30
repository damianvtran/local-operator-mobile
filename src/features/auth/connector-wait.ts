import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/**
 * Waiting for a connector to come up, observing only what a phone can see
 * (docs/ux/flows.md § 2 step 3).
 *
 * The screen switches to this as soon as the setup command is copied, and the
 * states are named after the two signals that are actually observable:
 *
 *  1. **the tunnel's row in the control plane** — `status` moves
 *     `pending` → `active`. This says the CLOUD route is provisioned. It says
 *     nothing about the machine: `radient-ml`'s API cannot report whether the
 *     connector is running, and `docs/relay/tunnel-edge.md` § 4 is explicit that
 *     `active` is not a heartbeat.
 *  2. **the host answering through the relay** — `GET /healthz` returns the
 *     relay's health JSON once the connector is forwarding. The daemon's health
 *     gate is deliberately unauthenticated, which is what makes this usable
 *     without a credential dance.
 *
 * So the states are `W1`..`W5` and every one of them names something OBSERVED.
 * "Setting up…" is banned: a reader watching a spinner cannot tell a slow
 * install from a command that never ran, and the two have different fixes.
 *
 * Polling pauses while the app is backgrounded (`W5`): a phone in a pocket
 * polling every four seconds for minutes is the battery cost this state would
 * otherwise hide.
 */

export type ConnectorWaitState =
	/** Nothing observed yet. */
	| { kind: "w1" }
	/** Radient has the tunnel; the machine has not answered. The common middle
	 *  state, and the one that changes soonest. */
	| { kind: "w2"; tunnelStatus: string }
	/** The host answered. */
	| { kind: "w3"; version: number | null; sessions: number | null }
	/** Two to three minutes with nothing observed. Terminal for this screen:
	 *  it hands over to the three-routes setup rather than waiting forever. */
	| { kind: "w4" }
	/** Backgrounded: polling is paused and the screen says so. */
	| { kind: "w5" };

export const CONNECTOR_WAIT = {
	/** How often both signals are re-read. */
	pollMs: 4_000,
	/** The health probe's own budget: a tunnel that accepts a connection and then
	 *  never answers is not "up", and a probe with no timeout would hang the
	 *  state machine on exactly that case. */
	probeTimeoutMs: 4_000,
	/** When to give up and say so. */
	giveUpMs: 180_000,
} as const;

/**
 * The shape `/healthz` answers with (`docs/relay/contract.md` § 1), narrowed
 * rather than asserted: an endpoint reachable by anyone on the path is exactly the
 * one whose body must not be trusted to be what it claims. Each field is optional
 * because a relay older than this client may omit it.
 */
type HealthPayload = { ok: true; version?: number; sessions?: number };

/** Reads a health body, or `null` when it is not the shape it must be. */
function parseHealth(value: unknown): HealthPayload | null {
	if (typeof value !== "object" || value === null) return null;
	const record: Record<string, unknown> = { ...value };
	if (record.ok !== true) return null;
	const version =
		typeof record.version === "number" ? record.version : undefined;
	const sessions =
		typeof record.sessions === "number" ? record.sessions : undefined;
	return version === undefined && sessions === undefined
		? { ok: true }
		: { ok: true, version, sessions };
}

/**
 * One health probe. Resolves `null` when the host did not answer, which is the
 * only signal a phone has for "not up yet".
 */
export async function probeHealth(
	hostname: string,
	options: { timeoutMs?: number; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<HealthPayload | null> {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? CONNECTOR_WAIT.probeTimeoutMs,
	);
	try {
		const response = await fetchImpl(`https://${hostname}/healthz`, {
			method: "GET",
			headers: { accept: "application/json" },
			credentials: "omit",
			signal: controller.signal,
		});
		if (!response.ok) return null;
		return parseHealth(await response.json());
	} catch {
		/* A refused connection, a DNS failure and a timeout are the same fact to
		 * this screen: the machine has not answered yet. */
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export type ConnectorWait = {
	state: ConnectorWaitState;
	/** Restarts the clock — the reader pressed the command again, or came back
	 *  from a check on the machine. */
	restart: () => void;
};

export function useConnectorWait(input: {
	/** Signs the loop up for the thing being waited FOR: reads the control plane
	 *  and returns the tunnel that appeared, or `null` when nothing has yet.
	 *  Null is not a failure — "no row yet" IS `W1`. */
	acquire: () => Promise<{ hostname: string; status: string } | null>;
	enabled: boolean;
	now?: () => number;
}): ConnectorWait {
	const { acquire, enabled } = input;
	const [state, setState] = useState<ConnectorWaitState>({ kind: "w1" });
	const [runId, setRunId] = useState(0);
	const nowRef = useRef(input.now ?? (() => Date.now()));

	/**
	 * The id of the loop that is allowed to paint.
	 *
	 * Bumped by `restart()` and by every new effect run, and read by the tick that
	 * is in flight: a probe that resolves after a restart must not resurrect the
	 * state of the loop the reader already started over. Without it, "Start again"
	 * could be undone a second later by the previous attempt's answer.
	 */
	const liveRunRef = useRef(0);

	/* Held in a ref so the polling effect does not restart on every render: a
	 * restart per render is a poll per render, and the caller's `acquire` is a
	 * fresh closure each time. */
	const acquireRef = useRef(acquire);
	acquireRef.current = acquire;

	const restart = useCallback(() => {
		setState({ kind: "w1" });
		setRunId((value) => value + 1);
	}, []);

	useEffect(() => {
		if (!enabled) return;
		liveRunRef.current = runId;
		const startedAt = nowRef.current();

		/** True while this effect's run is still the current one. */
		const isCurrent = () => liveRunRef.current === runId;

		const tick = async () => {
			if (!isCurrent()) return;
			const found = await acquireRef.current();
			if (!isCurrent()) return;

			if (found) {
				/* Radient's own word for the row, as the control plane spells it — never
				 * rewritten into "active", because `disabled` and `suspended` are statuses
				 * this app must not call provisioned. */
				setState({ kind: "w2", tunnelStatus: found.status });
				/* `status: active` means the cloud route exists. It is NOT a heartbeat, so
				 * the only thing that promotes this to `W3` is the machine answering. */
				const health = await probeHealth(found.hostname);
				if (!isCurrent()) return;
				if (health) {
					setState({
						kind: "w3",
						version: health.version ?? null,
						sessions: health.sessions ?? null,
					});
					return;
				}
			}

			if (nowRef.current() - startedAt > CONNECTOR_WAIT.giveUpMs) {
				setState({ kind: "w4" });
				return;
			}
			setTimeout(() => {
				void tick();
			}, CONNECTOR_WAIT.pollMs);
		};

		void tick();
	}, [enabled, runId]);

	/* Backgrounding pauses the loop. The state is stated rather than silent, so a
	 * reader who comes back to a screen that has not moved knows why. */
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (next) => {
			if (next === "active") return;
			setState((current) =>
				current.kind === "w3" || current.kind === "w4"
					? current
					: { kind: "w5" },
			);
		});
		return () => subscription.remove();
	}, []);

	return { state, restart };
}
