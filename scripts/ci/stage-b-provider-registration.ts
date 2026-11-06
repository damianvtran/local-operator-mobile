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
 * the next cap can be derived from data instead of chosen. The loop can overshoot
 * by at most one interval (round 38, R38-3); the last sleep is clamped so the
 * recorded wait stays within the stated bound.
 */
export const STAGE_B_REGISTRATION_CAP_MS = 60_000;
export const STAGE_B_REGISTRATION_INTERVAL_MS = 1_000;
export type StageBProviderName = "cloud" | "local";
/** Which step the Files resolution reached. A bare `null` could not tell a
 * missing app from a parse failure, and that is exactly what made run
 * 42237784275 look like "no Files app resolved" (round 38, R38-1). */
export type StageBFilesStage =
	| "listapps"
	| "convert"
	| "parse"
	| "resolve"
	| "launch"
	| "launched";
export interface StageBFilesResolution {
	filesApp: string | null;
	stage: StageBFilesStage;
	detail?: string;
}
export interface StageBRegistrationOutcome {
	/** Whether the warm-up was needed at all (a provider was already registered). */
	needed: boolean;
	/** The Files app bundle id that was launched, or null when none resolved. */
	filesApp: string | null;
	/** The step that produced `filesApp` (or the step that refused). */
	filesStage: StageBFilesStage | "not-needed";
	filesDetail?: string;
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
	/* The exact simulator id wins outright, and the display-name fallback is only
	 * consulted when the exact id is absent: returning "the first app whose name
	 * is Files" would depend on object order (round 38, R38-2). */
	if (typeof apps["com.apple.DocumentsApp"] === "object")
		return "com.apple.DocumentsApp";
	for (const [id, value] of Object.entries(apps)) {
		if (
			value.CFBundleDisplayName === "Files" ||
			value.CFBundleName === "Files" ||
			id.endsWith(".DocumentsApp")
		)
			return id;
	}
	return null;
}
/**
 * Walk the Files resolution and name the step that failed.
 *
 * `simctl listapps` prints an old-style NeXTSTEP plist and has no `--json` flag,
 * so parsing it directly threw and the collapsed catch reported "no Files app
 * resolved" — the failure run 42237784275 was mislabelled with. `convert` is
 * injected so a test can run the real `plutil -convert json` on a captured
 * sample.
 */
export function resolveFilesApplication(input: {
	listapps: () => string;
	convert: (plist: string) => string | null;
	launch: (bundleId: string) => void;
}): StageBFilesResolution {
	let plist: string;
	try {
		plist = input.listapps();
	} catch (failure) {
		return {
			filesApp: null,
			stage: "listapps",
			detail: failure instanceof Error ? failure.message : String(failure),
		};
	}
	const json = input.convert(plist);
	if (json === null)
		return {
			filesApp: null,
			stage: "convert",
			detail: "plutil conversion failed",
		};
	let apps: Record<
		string,
		{ CFBundleDisplayName?: string; CFBundleName?: string }
	>;
	try {
		apps = JSON.parse(json) as typeof apps;
	} catch (failure) {
		return {
			filesApp: null,
			stage: "parse",
			detail: failure instanceof Error ? failure.message : String(failure),
		};
	}
	const filesApp = resolveFilesBundleId(apps);
	if (filesApp === null) return { filesApp: null, stage: "resolve" };
	try {
		input.launch(filesApp);
	} catch (failure) {
		return {
			filesApp: null,
			stage: "launch",
			detail: failure instanceof Error ? failure.message : String(failure),
		};
	}
	return { filesApp, stage: "launched" };
}
/** Poll first, launch once if needed, then poll until the cap. */
export async function awaitProviderRegistration(input: {
	probe: () => StageBProviderName | null;
	launch: () => StageBFilesResolution;
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
			filesStage: "not-needed",
			provider: immediate,
			elapsedMs: 0,
			polls,
		};
	const files = input.launch();
	const filesApp = files.filesApp;
	/* No Files app resolved means nothing was opened, so nothing will register:
	 * waiting the full cap would only spend the caller's budget on a certainty. */
	if (filesApp === null)
		return {
			needed: true,
			filesApp: null,
			filesStage: files.stage,
			filesDetail: files.detail,
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
				filesStage: files.stage,
				provider: found,
				elapsedMs: now() - started,
				polls,
			};
		await sleep(Math.min(intervalMs, capMs - (now() - started)));
	}
	return {
		needed: true,
		filesApp,
		filesStage: files.stage,
		provider: null,
		elapsedMs: now() - started,
		polls,
	};
}
