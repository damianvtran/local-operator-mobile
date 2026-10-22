import { useMemo, useSyncExternalStore } from "react";

import type { ConfigStoreApi } from "../state/config-store";
import { createTranslator } from "./runtime";
import { localeSource } from "./subscription";

/** Receive the already-owned store rather than importing connection-provider:
 * catalogue logic must not boot auth/relay/native side effects in Node tests. */
export function useI18n(store: ConfigStoreApi) {
	const source = useMemo(() => localeSource(store), [store]);
	const locale = useSyncExternalStore(
		source.subscribe,
		source.getSnapshot,
		source.getSnapshot,
	);
	return useMemo(() => createTranslator(locale), [locale]);
}
