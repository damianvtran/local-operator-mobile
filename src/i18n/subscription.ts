import type { ConfigStoreApi } from "../state/config-store";

/** React and tests share this subscription seam. No locale is persisted here:
 * a route reset immediately removes the previous computer's language, and a
 * late baseline/live frame is always read from the existing backend store. */
export function localeSource(store: ConfigStoreApi) {
	const getSnapshot = () => store.getState().language ?? "en";
	return {
		getSnapshot,
		subscribe: (notify: () => void) =>
			store.subscribe((next, previous) => {
				if ((next.language ?? "en") !== (previous.language ?? "en")) notify();
			}),
	};
}
