/**
 * A sign-out participant, not a second credential owner. The hub provider
 * registers the device-removal callback; the connection provider invokes it
 * while its OAuth grant is still usable. Keeping the seam free of React/native
 * imports avoids a provider cycle and makes cleanup safe during startup too.
 */
let current: (() => Promise<void>) | null = null;

export function registerTeamBridgeRetirement(
	run: () => Promise<void>,
): () => void {
	current = run;
	return () => {
		if (current === run) current = null;
	};
}

/** Never hold local sign-out hostage to an unreachable push registry. */
export async function retireTeamBridgeDevice(): Promise<void> {
	const run = current;
	if (!run) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			run().catch(() => undefined),
			new Promise<void>((resolve) => {
				// The hub client bounds each request at 15s. Drain an admitted
				// registration, then DELETE (up to 30s combined) before clearing OAuth.
				timer = setTimeout(resolve, 35000);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
