import type { ConfigStoreApi } from "../state/config-store";

/** A fixture export has no live relay config stream. Feed its chosen locale
 * through the SAME config store instead of replacing the runtime's language
 * source. Connection initialization/route retirement can reset that store after
 * mount: subscribe before applying, repair only a differing language and remove
 * the subscription with the fixture. No timing assumptions, polling or writes
 * to preference/identity/notice persistence are involved.
 */
export function installFixturePresentation(
	fixture: {
		locale: string;
		scale: "100" | "200";
		theme: "light" | "dark";
	} | null,
	store: ConfigStoreApi,
	setScale: (scale: "100" | "200") => void,
	setTheme: (theme: "light" | "dark") => void,
) {
	// A normal export never subscribes or changes any presentation preference.
	if (!fixture) return;
	setScale(fixture.scale);
	setTheme(fixture.theme);
	return holdFixtureLocale(store, fixture.locale);
}

export function holdFixtureLocale(store: ConfigStoreApi, locale: string) {
	const apply = () => {
		if (store.getState().language !== locale)
			store.getState().applyFrame({ changed_keys: [], language: locale });
	};
	const unsubscribe = store.subscribe(apply);
	apply();
	return unsubscribe;
}
