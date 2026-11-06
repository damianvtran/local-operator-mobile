/**
 * Warming the simulator's File Provider registration before the document seed.
 *
 * Run 42237784275 failed `document-seed` with "no Files location exists; checked
 * iCloud Drive … and On My iPhone …", while run 42132547421 on the same code path
 * DID resolve the local File Provider group and listed the seeded row. So the
 * group is created lazily: on a fresh simulator nothing has asked the Files
 * system for it yet, and the directory cannot be found until some Files-side
 * component has registered the provider.
 *
 * The warm-up opens the simulator's Files app once, then polls the same
 * container-metadata scan the seeder already uses. It never makes a missing
 * provider look present: if the group never appears the seed still fails, and the
 * failure now names the wait as well as both paths.
 *
 * The waiting cap is a BOUND, not a derivation — no attempt has yet measured how
 * long registration takes, so 60 s (one poll per second) is chosen to be generous
 * against a cold Files app, and every receipt records the measured `elapsedMs` so
 * the next cap can be derived from data instead of chosen.
 */
export const STAGE_B_REGISTRATION_CAP_MS = 60_000;
export const STAGE_B_REGISTRATION_INTERVAL_MS = 1_000;
export type StageBProviderName = "cloud" | "local";
export interface StageBRegistrationOutcome {
	/** Whether the warm-up was needed at all (a provider was already registered). */
	needed: boolean;
	/** The Files app bundle id that was launched, or null when none resolved. */
	filesApp: string | null;
	provider: StageBProviderName | null;
	elapsedMs: number;
	polls: number;
}
/**
 * Resolve the Files app's bundle id from the simulator's own app inventory
 * (`simctl listapps`), never from a hardcoded guess: a wrong id would launch
 * nothing and the failure would look like a missing provider.
 */
export function resolveFilesBundleId(
	apps: Record<string, { CFBundleDisplayName?: string; CFBundleName?: string }>,
): string | null {
	for (const [id, value] of Object.entries(apps)) {
		if (id === "com.apple.DocumentsApp") return id;
		if (
			value.CFBundleDisplayName === "Files" ||
			value.CFBundleName === "Files" ||
			id.endsWith(".DocumentsApp")
		)
			return id;
	}
	return null;
}
/** Poll first, launch once if needed, then poll until the cap. */
export async function awaitProviderRegistration(input: {
	probe: () => StageBProviderName | null;
	launch: () => string | null;
	capMs?: number;
	intervalMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}): Promise<StageBRegistrationOutcome> {
	const capMs = input.capMs ?? STAGE_B_REGISTRATION_CAP_MS;
	const intervalMs = input.intervalMs ?? STAGE_B_REGISTRATION_INTERVAL_MS;
	const now = input.now ?? Date.now;
	const sleep =
		input.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const started = now();
	let polls = 0;
	const immediate = input.probe();
	polls += 1;
	if (immediate !== null)
		return {
			needed: false,
			filesApp: null,
			provider: immediate,
			elapsedMs: 0,
			polls,
		};
	const filesApp = input.launch();
	/* No Files app resolved means nothing was opened, so nothing will register:
	 * waiting the full cap would only spend the caller's budget on a certainty. */
	if (filesApp === null)
		return {
			needed: true,
			filesApp: null,
			provider: null,
			elapsedMs: now() - started,
			polls,
		};
	while (now() - started < capMs) {
		polls += 1;
		const found = input.probe();
		if (found !== null)
			return {
				needed: true,
				filesApp,
				provider: found,
				elapsedMs: now() - started,
				polls,
			};
		await sleep(intervalMs);
	}
	return {
		needed: true,
		filesApp,
		provider: null,
		elapsedMs: now() - started,
		polls,
	};
}
