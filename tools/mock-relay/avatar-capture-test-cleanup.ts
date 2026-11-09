/** Test-fixture lifecycle only. Never normalize an arbitrary AbortError: a real
 * network/read failure must survive teardown, even when retirement also aborts
 * another stream. Reader identity, controller identity and the unique deliberate
 * retirement reason must all agree before cancellation is considered complete. */
type Reader = { cancel(): Promise<void> };
export function createOwnedStreamCleanup() {
	const owners = new Map<Reader, AbortController>();
	const retirements = new Map<AbortController, DOMException>();
	return {
		register(reader: Reader, controller: AbortController) {
			if (owners.has(reader))
				throw new Error("reader ownership already registered");
			owners.set(reader, controller);
		},
		abort(controller: AbortController) {
			// Do not overwrite a prior timeout, network error or failed read reason.
			if (controller.signal.aborted) return;
			const reason = new DOMException("fixture stream retired", "AbortError");
			retirements.set(controller, reason);
			controller.abort(reason);
		},
		async cancel(reader: Reader) {
			const controller = owners.get(reader);
			try {
				await reader.cancel();
			} catch (error) {
				const reason = controller && retirements.get(controller);
				if (
					reason &&
					error === reason &&
					reason.name === "AbortError" &&
					controller.signal.aborted &&
					controller.signal.reason === reason &&
					owners.get(reader) === controller
				)
					return;
				throw error;
			}
		},
	};
}

type Stage =
	| "release holds"
	| "abort stream"
	| "cancel reader"
	| "destroy request"
	| "shutdown"
	| "request completions"
	| "owner";
type FailureType =
	| "AbortError"
	| "TimeoutError"
	| "TypeError"
	| "Error"
	| "Other"
	| "Deadline";
type Issue = { stage: Stage; type: FailureType };
type Work = { stage: Stage; run: () => unknown | Promise<unknown> };
class CleanupDeadline extends Error {}
class CleanupFailure extends Error {
	readonly issues: Issue[];
	constructor(issues: Issue[]) {
		// Only internal finite codes enter the exception. No original rejection,
		// message, stack, request, response, credential or image becomes a cause.
		super(
			`fixture cleanup failed: ${issues.map(({ stage, type }) => `${stage}/${type}`).join(", ")}`,
		);
		this.issues = issues;
	}
}
const failureType = (error: unknown): FailureType => {
	if (error instanceof CleanupDeadline) return "Deadline";
	if (!(error instanceof Error)) return "Other";
	const name = error.name;
	return name === "AbortError" ||
		name === "TimeoutError" ||
		name === "TypeError" ||
		name === "Error"
		? name
		: "Other";
};
async function deadline(work: Promise<unknown>, milliseconds: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new CleanupDeadline()), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Launch every owner before awaiting any result. A failed reader cannot block
 * socket destruction or shutdown, and safe diagnostics survive the outer rig
 * aggregate instead of being replaced by an uninformative generic exception. */
export async function runCleanupStages(work: Work[], milliseconds = 5500) {
	const results = await Promise.allSettled(
		work.map(({ run }) => deadline(Promise.resolve().then(run), milliseconds)),
	);
	const issues: Issue[] = [];
	for (let index = 0; index < results.length; index++) {
		const result = results[index];
		const owner = work[index];
		if (result?.status === "rejected" && owner) {
			issues.push({ stage: owner.stage, type: failureType(result.reason) });
		}
	}
	if (issues.length) throw new CleanupFailure(issues);
}

export function throwCleanupFailures(results: PromiseSettledResult<unknown>[]) {
	const issues: Issue[] = [];
	for (const result of results) {
		if (result.status !== "rejected") continue;
		if (result.reason instanceof CleanupFailure)
			issues.push(...result.reason.issues);
		else issues.push({ stage: "owner", type: "Other" });
	}
	if (issues.length) throw new CleanupFailure(issues);
}
