/** Completion-prefetch coordinator. Only an already-authorized provider may
 * register a scope: neither a notification nor a locked/headless launch opens
 * credentials or starts a route. No native imports in this module.
 *
 * Background pushes additionally prove computer ownership against the authenticated
 * registration mapping. Only push wakes run this path: no polling or held socket. */
export interface WarmSyncScope {
	isActive(): boolean;
	background?: {
		/** Stable account/route identity; never the opaque push handle. */
		key: string;
		matches(computer: string): Promise<boolean>;
		refreshList(signal: AbortSignal): Promise<boolean>;
	};
	seed(sessionId: string, signal: AbortSignal): Promise<boolean>;
	resolve(handle: string, signal: AbortSignal): Promise<string>;
}

export function createWarmSync(now: () => number = Date.now) {
	let scope: WarmSyncScope | null = null;
	let lastViewed: string | null = null;
	let lastOwnerKey: string | undefined;
	let attentionFlight: Promise<boolean> | null = null;
	let attentionAt: number | null = null;
	const views = new Set<{ sessionId: string }>();
	const seeds = new Map<
		string,
		{ promise: Promise<boolean>; controller: AbortController }
	>();
	const successful = new Map<string, number>();
	const controllers = new Set<AbortController>();

	// One deadline includes resolution, the first-frame read and cache save.
	// Abort also settles a non-cooperative adapter; adapters fence eventual writes.
	const bounded = (
		work: (signal: AbortSignal) => Promise<boolean>,
		ms: number,
		parent?: AbortSignal,
	) => {
		const controller = new AbortController();
		controllers.add(controller);
		const abort = () => controller.abort();
		parent?.addEventListener("abort", abort, { once: true });
		let timer: ReturnType<typeof setTimeout> | undefined;
		const promise = (async () => {
			const cancelled = new Promise<boolean>((resolve) => {
				controller.signal.addEventListener("abort", () => resolve(false), {
					once: true,
				});
				timer = setTimeout(abort, Math.max(0, ms));
			});
			if (parent?.aborted) abort();
			try {
				return await Promise.race([
					Promise.resolve()
						.then(() =>
							controller.signal.aborted ? false : work(controller.signal),
						)
						.catch(() => false),
					cancelled,
				]);
			} finally {
				clearTimeout(timer);
				parent?.removeEventListener("abort", abort);
				abort();
				controllers.delete(controller);
			}
		})();
		return { promise, controller };
	};
	const prefetch = (
		sessionId: string,
		budgetMs = 25_000,
		parent?: AbortSignal,
	): Promise<boolean> => {
		const owner = scope;
		if (
			!owner?.isActive() ||
			[...views].some((view) => view.sessionId === sessionId)
		)
			return Promise.resolve(false);
		const existing = seeds.get(sessionId);
		if (existing) return existing.promise;
		// A burst and its received/tapped copies share one successful seed/minute.
		if (now() - (successful.get(sessionId) ?? -Infinity) < 60_000)
			return Promise.resolve(false);
		const task = bounded(
			async (signal) => {
				const saved = await owner.seed(sessionId, signal);
				if (saved && !signal.aborted && scope === owner && owner.isActive()) {
					successful.set(sessionId, now());
					return true;
				}
				return false;
			},
			budgetMs,
			parent,
		);
		seeds.set(sessionId, task);
		void task.promise.finally(() => {
			if (seeds.get(sessionId) === task) seeds.delete(sessionId);
		});
		return task.promise;
	};
	const retire = () => {
		for (const controller of controllers) controller.abort();
		seeds.clear();
		successful.clear();
		attentionFlight = null;
		attentionAt = null;
	};
	return {
		register(next: WarmSyncScope) {
			retire();
			if (next.background?.key !== lastOwnerKey) lastViewed = null;
			lastOwnerKey = next.background?.key;
			scope = next;
			return () => {
				if (scope === next) {
					scope = null;
					retire();
				}
			};
		},
		/** The screen takes ownership BEFORE opening its own stream. View tokens
		 * survive a same-route reconnect, and each cleanup removes only its token. */
		view(sessionId: string) {
			const view = { sessionId };
			lastViewed = sessionId;
			views.add(view);
			seeds.get(sessionId)?.controller.abort();
			return () => {
				views.delete(view);
			};
		},
		prefetch,
		/** A push is a hint, never route authority. The task supplies its REMAINING
		 * budget after the badge/tray clear, so matching, list, resolve, one seed
		 * and persistence all share the original OS wake's deadline. */
		pushed(
			push: {
				reason: "attention" | "completion";
				computer: string;
				conversation?: string;
			},
			budgetMs = 25_000,
		): Promise<boolean> {
			const owner = scope;
			const background = owner?.background;
			if (!owner?.isActive() || !background || budgetMs <= 0)
				return Promise.resolve(false);
			const existing = push.reason === "attention" ? attentionFlight : null;
			const deadline = now() + budgetMs;
			const task = bounded(async (signal) => {
				if (
					!(await background.matches(push.computer)) ||
					signal.aborted ||
					scope !== owner ||
					!owner.isActive()
				)
					return false;
				if (push.reason === "attention") {
					// Repeated acknowledgements must not spend a wake on another list
					// or seed. This uses the coordinator's existing 60 s success limit.
					// Even copies joining a flight must pass the mapping gate above.
					if (existing) return existing;
					const refreshed =
						attentionAt === null || now() - attentionAt >= 60_000
							? await background.refreshList(signal)
							: false;
					if (signal.aborted || scope !== owner || !owner.isActive())
						return false;
					if (refreshed) attentionAt = now();
					// A saved list is not a successful seed: an onscreen skip or failed
					// seed may retry on the next push even while the list is throttled.
					const seeded = lastViewed
						? await prefetch(lastViewed, Math.max(0, deadline - now()), signal)
						: false;
					return refreshed || seeded;
				}
				if (!push.conversation) return false;
				const id = await owner.resolve(push.conversation, signal);
				if (signal.aborted || scope !== owner || !owner.isActive())
					return false;
				return prefetch(id, Math.max(0, deadline - now()), signal);
			}, budgetMs).promise;
			if (push.reason === "attention" && !existing) {
				attentionFlight = task;
				void task.finally(() => {
					if (attentionFlight === task) attentionFlight = null;
				});
			}
			return task;
		},
		received(handle: string): Promise<boolean> {
			const owner = scope;
			if (!owner?.isActive()) return Promise.resolve(false);
			const deadline = now() + 25_000;
			return bounded(async (signal) => {
				const id = await owner.resolve(handle, signal);
				if (signal.aborted || scope !== owner || !owner.isActive())
					return false;
				return prefetch(id, Math.max(0, deadline - now()), signal);
			}, 25_000).promise;
		},
	};
}

export const warmSync = createWarmSync();
