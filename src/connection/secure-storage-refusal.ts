/**
 * Why this device's secure storage refused a request — kept as a SANITISED
 * cause, never as the platform's raw error.
 *
 * **Why it exists.** A keystore read, clear or write that rejects used to be
 * collapsed into `noteFailure({ surface: "diagnostic" })` with the reason
 * discarded (diagnostic run 42855980853, local-operator-mobile PR #216): the
 * reader saw "Not connected / Not answering" on home and nothing said that the
 * phone's own Keychain/Keystore was the thing refusing. Support could not tell a
 * missing entitlement (`-34018`) from a locked device either.
 *
 * **What is kept, and why only that.** The platform error's MESSAGE is never
 * kept: expo-secure-store builds it from the native exception and can quote a
 * key name or, on Android, a provider's own text, and nothing guarantees it is
 * free of stored values. Only three facts survive, each shape-checked so free
 * text cannot ride along:
 *
 *  - `step` — which of the three keystore operations refused (`read`, `clear`,
 *    `write`), decided by the CALLER that knows which one it ran;
 *  - `kind` — the error's class name (`Error`, `CodedError`, …), letters only;
 *  - `code` — a platform code: Expo's `ERR_*` identifier and/or a numeric
 *    status (an OSStatus such as `-34018`, an Android keystore code) when the
 *    error carries one. Digits and `[A-Z0-9_]` only.
 *
 * The record is plain data so it can sit in the connection store and cross
 * into copy (`secureStorageRefusalSentence` in the auth feature) without the
 * original error object being retained anywhere a screen can reach.
 */

export type SecureStorageStep = "read" | "clear" | "write";

export type SecureStorageRefusal = Readonly<{
	step: SecureStorageStep;
	kind: string;
	/** Expo identifier and/or numeric status, space-joined; `null` when the error
	 *  carried neither. */
	code: string | null;
}>;

/** A keystore rejection tagged with the step that produced it. The message is
 *  the original's so existing `rejects.toThrow(<message>)` expectations and
 *  logs keep reading the same; the original stays on `cause`. */
export class SecureStorageStepError extends Error {
	override readonly name = "SecureStorageStepError";
	readonly step: SecureStorageStep;
	constructor(step: SecureStorageStep, cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.step = step;
	}
}

/** Runs one keystore operation and tags its rejection with `step`. A rejection
 *  that is already tagged keeps its own (inner) step — the innermost caller
 *  knows best which operation it ran. */
export function secureStorageStep<T>(
	step: SecureStorageStep,
	operation: () => Promise<T>,
): Promise<T> {
	/* Started SYNCHRONOUSLY, as the untagged call was: the retirement queue starts
	 *  its tombstone write and its purges in one tick, and deferring them by a
	 *  microtask would reorder them against anything the caller does next. */
	let started: Promise<T>;
	try {
		started = Promise.resolve(operation());
	} catch (error) {
		started = Promise.reject(error);
	}
	return started.catch((error: unknown) => {
		throw error instanceof SecureStorageStepError
			? error
			: new SecureStorageStepError(step, error);
	});
}

const STEPS: ReadonlySet<string> = new Set(["read", "clear", "write"]);

/** Whether `value` is a refusal record this module built — the check a
 *  `RelayError.cause` is read through, so an arbitrary cause (a platform error,
 *  a string) is never mistaken for sanitised data. */
export function isSecureStorageRefusal(
	value: unknown,
): value is SecureStorageRefusal {
	if (typeof value !== "object" || value === null) return false;
	const { step, kind, code } = value as Record<string, unknown>;
	/* Every field is re-checked against the shape `describeSecureStorageRefusal`
	 *  emits (code review R1-m2, PR #220), so a hand-built object carrying free
	 *  text in `kind` or `code` is refused rather than rendered as "sanitised".
	 *  `CLASS_NAME` also admits `kindOf`'s `typeof` fallback (letters only). */
	return (
		typeof step === "string" &&
		STEPS.has(step) &&
		typeof kind === "string" &&
		CLASS_NAME.test(kind) &&
		(code === null || (typeof code === "string" && isCodeShape(code)))
	);
}

/** `codeOf`'s output: one Expo identifier and/or one numeric status, space-joined. */
function isCodeShape(code: string): boolean {
	const parts = code.split(" ");
	return (
		parts.length >= 1 &&
		parts.length <= 2 &&
		parts.every((part) => EXPO_CODE.test(part) || NUMERIC.test(part))
	);
}

const EXPO_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const CLASS_NAME = /^[A-Za-z]{1,48}$/;
/* A numeric status QUOTED in a message, in the two forms a status is written in
 * and nothing looser: `OSStatus -34018` (the iOS keychain's own wording), or
 * `code: -25300` / `status=5` with an explicit `:` or `=`. Only the number is
 * lifted out — the message itself is dropped. A bare `error 482913` or
 * `code 42` is NOT a status form (code review R1-m1, PR #220): a message can
 * quote a stored value after those words, and the record must carry platform
 * codes only. Bounded to 7 digits: OSStatus is an Int32 and every observed
 * keychain/keystore status fits in 6, so a longer run is more likely an id. */
const QUOTED_STATUS =
	/\b(?:OSStatus\s*[:=]?|(?:status|code)\s*[:=])\s*(-?\d{1,7})\b/i;
const NUMERIC = /^-?\d{1,7}$/;

/**
 * Reduces any rejection to a `SecureStorageRefusal`. `fallbackStep` is used when
 * the rejection was not tagged by `secureStorageStep` (a caller that knows only
 * the operation as a whole). An `AggregateError` (several steps refused at once)
 * reports its FIRST tagged member: one sentence is what the reader can act on,
 * and every step shares the same remedy.
 */
export function describeSecureStorageRefusal(
	reason: unknown,
	fallbackStep: SecureStorageStep,
): SecureStorageRefusal {
	let error: unknown = reason;
	if (reason instanceof AggregateError && reason.errors.length > 0)
		error =
			reason.errors.find(
				(member) => member instanceof SecureStorageStepError,
			) ?? reason.errors[0];
	const step =
		error instanceof SecureStorageStepError ? error.step : fallbackStep;
	const original =
		error instanceof SecureStorageStepError ? error.cause : error;
	return { step, kind: kindOf(original), code: codeOf(original) };
}

function kindOf(error: unknown): string {
	if (!(error instanceof Error)) return typeof error;
	const name = error.constructor?.name ?? error.name;
	return CLASS_NAME.test(name) ? name : "Error";
}

function codeOf(error: unknown): string | null {
	if (typeof error !== "object" || error === null) return null;
	const parts: string[] = [];
	const { code } = error as { code?: unknown };
	if (typeof code === "string" && EXPO_CODE.test(code)) parts.push(code);
	else if (typeof code === "number" && NUMERIC.test(String(code)))
		parts.push(String(code));
	const message = error instanceof Error ? error.message : undefined;
	const status = message?.match(QUOTED_STATUS)?.[1];
	if (status !== undefined && !parts.includes(status)) parts.push(status);
	return parts.length > 0 ? parts.join(" ") : null;
}
