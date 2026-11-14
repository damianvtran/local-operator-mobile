/**
 * Serialize register → unregister for one process/install. A PUT may already be
 * authenticated when sign-out starts: deleting its row first lets that late PUT
 * resurrect it. Retirement therefore closes admission synchronously, drains the
 * already admitted request, THEN issues DELETE under its captured account client.
 * New-account registration queues after that deletion, never in front of it.
 * Network failures remain best effort (the hub's unseen-device TTL is a backstop),
 * but concurrent local callbacks cannot reorder these mutations.
 */
export function createPushLifecycle(deps: {
	register: (isCurrent: () => boolean) => Promise<void>;
	unregister: () => Promise<void>;
}) {
	let epoch = 0;
	let active = false;
	let tail = Promise.resolve();
	let pending: Promise<void> | null = null;
	function append(run: () => Promise<void>): Promise<void> {
		const next = tail.then(run);
		tail = next.catch(() => undefined);
		return next;
	}
	return {
		activate() {
			active = true;
		},
		suspend() {
			active = false;
			epoch++;
		},
		register(): Promise<void> {
			if (!active) return Promise.resolve();
			if (pending) return pending;
			const owned = epoch;
			const isCurrent = () => active && epoch === owned;
			const work = append(async () => {
				if (isCurrent()) await deps.register(isCurrent);
			});
			pending = work;
			void work
				.finally(() => {
					if (pending === work) pending = null;
				})
				.catch(() => undefined);
			return work;
		},
		/**
		 * The Team Bridge switch turned off while signed in: drain an admitted
		 * PUT (it could otherwise resurrect the row after the DELETE, the same
		 * race `retire` closes), then DELETE — but stay ACTIVE, because the
		 * account is still signed in and turning the switch back on registers
		 * again through `register()`.
		 */
		withdraw(): Promise<void> {
			epoch++;
			pending = null;
			return append(deps.unregister);
		},
		retire(): Promise<void> {
			active = false;
			epoch++;
			pending = null;
			return append(deps.unregister);
		},
	};
}
