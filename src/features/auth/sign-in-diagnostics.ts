/** Ephemeral, bounded stage history. Never accept arbitrary error names/messages:
 * native/network errors can contain redirect queries or credentials. */
export type SignInDiagnostic = { stage: string; errorClass?: string };
const STAGES = new Set([
	"idle",
	"starting",
	"waiting-for-browser",
	"exchanging",
	"cancelled",
	"unavailable",
	"retiring",
	"persisting",
	"discovering",
	"signed-in",
	"failed",
]);
const CLASSES = new Set([
	"Error",
	"AbortError",
	"RadientAuthError",
	"LoopbackUnavailableError",
	"SignInSupersededError",
]);
export const signInErrorClass = (error: unknown): string =>
	error instanceof Error && CLASSES.has(error.name) ? error.name : "Error";
export class SignInSupersededError extends Error {
	override name = "SignInSupersededError";
}
export const appendSignInDiagnostic = (
	trail: readonly SignInDiagnostic[],
	stage: string,
	errorClass?: string,
): SignInDiagnostic[] => [
	...trail.slice(-11),
	{
		stage: STAGES.has(stage) ? stage : "failed",
		...(errorClass
			? { errorClass: CLASSES.has(errorClass) ? errorClass : "Error" }
			: {}),
	},
];
