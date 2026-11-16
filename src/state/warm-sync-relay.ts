/** Relay/cache adapter for a registered, already-authorized route. Type-only
 * imports keep the background task free of native storage and React imports. */
import type { RelayEndpoints, RelayStream } from "@/relay/endpoints";
import type { createWarmCache, WarmScope } from "./warm-cache";
import type { WarmSyncScope } from "./warm-sync";

export function relayWarmSyncScope(options: {
	client: RelayEndpoints;
	scope: WarmScope;
	cache: ReturnType<typeof createWarmCache>;
	isActive(): boolean;
	background?: { key: string; matches(computer: string): Promise<boolean> };
}): WarmSyncScope {
	const { client, scope, cache, isActive } = options;
	return {
		isActive,
		...(options.background
			? {
					background: {
						...options.background,
						async refreshList(signal: AbortSignal) {
							const frame = await client.sessions({
								includePeers: true,
								signal,
							});
							if (signal.aborted || !isActive()) return false;
							return cache.saveList(
								scope,
								frame,
								() => !signal.aborted && isActive(),
							);
						},
					},
				}
			: {}),
		async resolve(handle, signal) {
			const answer = await client.resolveConversation(handle, { signal });
			return answer.session_id;
		},
		seed(sessionId, signal) {
			return new Promise<boolean>((resolve) => {
				if (signal.aborted || !isActive()) {
					resolve(false);
					return;
				}
				let stream: RelayStream | undefined;
				// RelayEndpoints accepts an external request signal. stop() aborts
				// the SSE loop's INTERNAL signal, so also cancel this transport's
				// signal or a quiet body could linger until its next keepalive.
				const transport = new AbortController();
				let settled = false;
				const finish = (saved: boolean) => {
					if (settled) return;
					settled = true;
					transport.abort();
					stream?.stop();
					signal.removeEventListener("abort", abort);
					resolve(saved);
				};
				const abort = () => finish(false);
				signal.addEventListener("abort", abort, { once: true });
				try {
					stream = client.sessionStream(sessionId, {
						signal: transport.signal,
						onFrame(frame) {
							if (settled || frame.kind !== "projection") return;
							// The first projection IS the screen's seed. Stop before saving,
							// not after: persistence must never keep the phone view alive.
							stream?.stop();
							transport.abort();
							if (signal.aborted || !isActive()) {
								finish(false);
								return;
							}
							settled = true;
							signal.removeEventListener("abort", abort);
							void cache
								.saveSession(
									scope,
									sessionId,
									frame.data,
									() => !signal.aborted && isActive(),
								)
								.then(resolve, () => resolve(false));
						},
						onError: () => finish(false),
					});
					// Also closes synchronous injected first-frame/error streams.
					if (settled) stream.stop();
					else stream.connection.start();
				} catch {
					finish(false);
				}
			});
		},
	};
}
