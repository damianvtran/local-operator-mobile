/**
 * What the composer home sends, and what it may honestly say, once the computer
 * has answered its two reads.
 *
 * WHY THESE ARE FUNCTIONS RATHER THAN EXPRESSIONS IN THE SCREEN. Both defects this
 * module exists for shipped as one-line expressions inside `home.tsx`, and both
 * were about what reaches the wire rather than what a screenshot shows: the start
 * body named `catalogue.models[0]` as the model — one nobody chose, which the
 * computer then applied as an override of the operator's configured default — and
 * the start body named `home` as the folder while the computer's own `default`
 * went unread. A screenshot shows neither, and asserting on rendered props would
 * not have caught them, so the decisions live here and their tests assert the BODY.
 */
import type { ModelEntry, Payload } from "@/contracts";
import type { ModelReading } from "@/features/session/chip-labels";
import type { ResumeClock } from "@/features/session/resume-hold";
import { insideResumeWindow } from "@/features/session/resume-plan";
import type { StartSessionRequest } from "@/relay/endpoints";
import {
	isRelayError,
	type RelayError,
	type RelayErrorKind,
} from "@/relay/errors";

/** The two directory lists a reader chooses between, as the computer spelt them. */
export type HomeFolders = Readonly<{
	/** The owner's home directory. */
	home: string;
	/** Where a session starts when the reader names no folder. Resolved by the
	 *  computer, never re-derived here: a second answer to "where does a one-tap
	 *  start land" drifts from the first. */
	default: string;
	/** Recently active directories the computer's spawn gate admits, so every row
	 *  is a directory a session can actually start in. */
	recent: readonly string[];
	/** The computer's temp folder, which its spawn gate also admits — offered as a
	 *  scratch start by the folder picker. Absent from an older computer. */
	tmp?: string;
}>;

/** The folder list, from the read's payload. `home` is the fallback only for a
 *  computer that publishes no `default`: it is the one path its gate always
 *  admits, so the fallback is a start that cannot be refused. */
export const foldersFrom = (payload: Payload<"directories">): HomeFolders => {
	const published = payload.default?.trim() ?? "";
	return {
		home: payload.home,
		default: published.length > 0 ? published : payload.home,
		recent: payload.recent,
		...(payload.tmp !== undefined && payload.tmp.length > 0
			? { tmp: payload.tmp }
			: {}),
	};
};

/** A value the screen holds FOR ONE COMPUTER, tagged with the computer it came
 *  from (`tunnelId`; `null` is a custom route, which has no tunnel id).
 *
 * WHY THE TAG (review round 2, R2-1). The header computer chip switches computers
 * in place, so Home stays mounted and its state survives the switch. A folder or a
 * folder list held untagged is then computer A's answer sitting in computer B's
 * start body — a path B's spawn gate refuses, or worse, one that exists on B and
 * starts the session in the wrong directory. Tagged, A's value reads as `null` on
 * B in the very render the switch lands in (no effect has to run first to clear
 * it), so B's own read is what fills the slot, and a failed read on B sends
 * nothing rather than A's path. */
export type ForComputer<T> = Readonly<{ computer: string | null; value: T }>;

/** The held value when it belongs to `computer`, else `null`. */
export const heldOn = <T>(
	held: ForComputer<T> | null,
	computer: string | null,
): T | null =>
	held !== null && held.computer === computer ? held.value : null;

/** The folder the screen holds once a read has succeeded.
 *
 * WHY IT TAKES THE CURRENT VALUE (review R2). Every successful read of the folder
 * list — the mount's own and the retry's — ends here, and a read must never move a
 * folder the reader applied in the sheet. So it fills a slot nobody has filled and
 * otherwise leaves the holder alone: either the reader's choice or the first
 * successful read's `default` got there first, and both outrank a later read.
 * Replacing the slot unconditionally was the second half of the model-retry defect:
 * that retry re-ran this read and put the computer's default back over the reader's
 * folder, silently.
 *
 * "Nobody has filled" is judged ON THE READ'S OWN COMPUTER (R2-1): a folder held
 * for another computer is not a fill, so the read's `default` replaces it. */
export const foldersApplied = (
	current: ForComputer<string> | null,
	computer: string | null,
	read: HomeFolders,
): ForComputer<string> => ({
	computer,
	value: heldOn(current, computer) ?? read.default,
});

/** The failure as it happened, KIND INCLUDED — the banner names the cause, and an
 *  auth failure is the one kind a renewal answers. A throw that is not a
 *  `RelayError` keeps no kind (`null`) rather than being dressed as one. */
export const foldersFailure = (cause: unknown): RelayError | null =>
	isRelayError(cause) ? cause : null;

/** The kinds that mean "the credential moved", not "the computer said no": the
 *  connection layer renews the tunnel behind the reader on exactly these
 *  (`client-factory.ts`'s refusal predicate), so a read that fails with one may
 *  simply have raced that renewal and is owed ONE automatic re-ask. Every other
 *  kind is an answer, and retrying it would only repeat it. */
const AUTH_FAILURE_KINDS: readonly RelayErrorKind[] = [
	"relay-unauthorized",
	"radiant-login-required",
];

export const isAuthFailure = (error: RelayError | null): boolean =>
	error !== null && AUTH_FAILURE_KINDS.includes(error.kind);

/**
 * Whether a failed home read (folders, models) is HELD rather than shown
 * (PR #246, the QA round's resume blip): inside the route's resume window the
 * radio or the tunnel may still be waking, so "We couldn't read this
 * computer's folders / model list just now" painted for a read that one
 * re-ask a few seconds later answers. A held failure is re-read once when the
 * window closes, and only that re-read's failure shows — the same policy as
 * the conversation's held history read (`holdResumeRead`). A credential
 * failure is never held: its banner names a sign-in, which waiting cannot fix.
 */
export const holdReadFailure = (
	error: RelayError | null,
	clock: ResumeClock,
): boolean => !isAuthFailure(error) && insideResumeWindow(clock);

/**
 * The body `POST /api/sessions/start` receives.
 *
 * TWO RULES, both learned from the operator's own report:
 *
 * - `provider`/`model_id` appear ONLY when the reader picked a model in the sheet.
 *   Absent, the computer applies its configured default — the behaviour the reader
 *   expects — whereas a field the app invented silently overrode it, so the app's
 *   first catalogue row (rather than the configured Opus) ran the session.
 * - `cwd` is the folder the reader chose, else the computer's OWN default. Naming
 *   home instead moved every first send out of the directory they had been working
 *   in, and disagreed with what a cwd-less start would have done anyway.
 *
 * `null` means "no start is possible yet": with no folder from either side there is
 * nothing to name, and inventing one is how the folder defect started.
 */
export const homeStartSelection = (input: {
	/** The folder the home will start in, once a read has resolved it. */
	cwd: string | null;
	chosenModel: ModelEntry | null;
	/** The level the reader picked in the effort picker, `null` when none. */
	chosenEffort?: string | null;
	/** `capabilities.session_start.effort`: the relay accepts `effort`. */
	effortSupported?: boolean;
}): StartSessionRequest | null => {
	if (input.cwd === null) return null;
	return {
		cwd: input.cwd,
		...modelFields(input.chosenModel),
		...effortField(input.chosenEffort ?? null, input.effortSupported ?? false),
	};
};

/** `provider`/`model_id` for a chosen model, nothing otherwise — one writer for
 *  both bodies below, so their key order (which `restoredSupersede` compares)
 *  cannot drift. */
const modelFields = (
	model: ModelEntry | null,
): Pick<StartSessionRequest, "provider" | "model_id"> =>
	model !== null ? { provider: model.provider, model_id: model.model_id } : {};

/**
 * `effort` ONLY when the reader chose one AND the relay advertises
 * `capabilities.session_start.effort` (local-operator v0.101.9). The same rule as
 * the model's: an absent field is how the computer applies its configured
 * default, so the app never fills it in. And the capability gate is not a
 * nicety — an older relay REFUSES `effort` on a keyed start
 * (`invalid_start_request`) and silently DROPS it on an unkeyed one, starting the
 * session at a level the reader did not pick while the chip said they had.
 */
const effortField = (
	effort: string | null,
	supported: boolean,
): Pick<StartSessionRequest, "effort"> =>
	effort !== null && supported ? { effort } : {};

/**
 * What the home must WRITE INTO a restored record, or `null` when the record
 * already says the only thing it can honestly say.
 *
 * WHY A RESTORED RECORD IS OVERRULED AT ALL. The coordinator keeps a restored
 * selection rather than replacing it, which is right for a choice the reader made
 * in an earlier session — but a build that predates this fix wrote a record naming
 * `catalogue.models[0]` as the model, and that record would keep POSTing the
 * invented override forever, because a restored selection is never re-derived.
 *
 * WHY THE RECORD IS NOT SIMPLY REPLACED WITH THE LIVE SELECTION (review R3). The
 * live selection is built from the folder read alone, so on a remount it names
 * `default` before the reader has said anything — replacing the record with it
 * would throw away the folder they actually chose last time. So the record is
 * corrected IN PLACE: everything it holds is kept except what the app itself put
 * there.
 *
 * - `provider`/`model_id` are STRIPPED whenever the reader has chosen nothing,
 *   whatever the folder read did (QA round 1, Q2). The app cannot tell an invented
 *   model from a chosen one on disk, so the record is no evidence of choice and the
 *   model is absent — which is how the computer applies its own configured default.
 *   Gating this on a resolved folder was the pre-remediation bug: when the folder
 *   read failed — the state the operator reported — the invented model still went
 *   out on the wire.
 * - `cwd` is left EXACTLY as the record holds it, with one exception: the value the
 *   old build invented is the computer's own `home`, so when the record names
 *   `folders.home`, the read resolved and the reader has applied nothing in this
 *   mount, it is replaced with `folders.default` —
 *   the directory a cwd-less start would have landed in. A path that is not that
 *   invented value is the reader's, and nothing here may move it.
 *
 * `null` means "no write": the record already agrees, so the coordinator's own
 * configure write and the reader's live choices stay the only authors.
 */
export const restoredSupersede = (input: {
	/** The selection the coordinator restored, `null` when it restored none. */
	stored: StartSessionRequest | null;
	/** The folders the computer published, or `null` while that read is pending or
	 *  failed — without it the invented `home` cannot be told from a chosen one. */
	folders: HomeFolders | null;
	chosenModel: ModelEntry | null;
	/** The reader's effort, and whether the relay accepts one: an effort is
	 *  written into the record by exactly the rule the live body follows, so a
	 *  restored effort nobody chose in this mount is stripped like a model. */
	chosenEffort?: string | null;
	effortSupported?: boolean;
	/** Whether the reader has applied a folder on this computer since the screen
	 *  mounted. Once they have, the record is THEIR choice, not a restored one. */
	readerApplied: boolean;
}): StartSessionRequest | null => {
	const { stored, folders, chosenModel, readerApplied } = input;
	if (stored === null) return null;
	/* The home rewrite applies ONLY to a record restored before the reader chose
	 *  anything in this mount (review round 2, R2-2). This function re-runs after
	 *  every write, including the reader's own Apply, so without the gate a reader
	 *  who picked exactly their home folder had it silently rewritten to `default`
	 *  — the value is the same one the old build invented, and only WHEN it was
	 *  written tells them apart. The model strip below stays unconditional: it is
	 *  keyed on what the reader chose, not on the record (QA round 1, Q2). */
	const cwd =
		!readerApplied && folders !== null && stored.cwd === folders.home
			? folders.default
			: stored.cwd;
	const next: StartSessionRequest = {
		...(cwd !== undefined ? { cwd } : {}),
		...modelFields(chosenModel),
		...effortField(input.chosenEffort ?? null, input.effortSupported ?? false),
	};
	/* Key order matters to this comparison: `next` is built just above and `stored`
	 *  comes from the coordinator's record (written by `homeStartSelection` or a
	 *  picker's commit, then round-tripped through its JSON `copy`), and every one
	 *  of those writers emits `cwd`, then `provider`, then `model_id`, then
	 *  `effort` — the pickers commit through `homeStartSelection` itself. */
	return JSON.stringify(next) === JSON.stringify(stored) ? null : next;
};

/** The model catalogue's read, as the screen holds it. */
export type CatalogueRead = "loading" | "ready" | "failed";

/**
 * What the model chip may say, in the order the facts arrive.
 *
 * A CHOSEN MODEL ALWAYS WINS: it is known without the catalogue, so a read still in
 * flight (or one that failed) must not replace a selector the reader picked. With
 * nothing chosen the answer is the computer's own default, never a catalogue row.
 *
 * A FAILED READ STILL SAYS "Default" (design review round 1, D2; UX U1). The
 * catalogue is the sheet's MENU, not the model that runs: with nothing chosen the
 * start body names no model and the computer applies its configured default
 * whether or not the list could be read. "Unknown" said something false, and its
 * unavailable chip was disabled — with the folders read failed too, the reader had
 * no way into the sheet at all. The read failure is the models banner's to tell.
 */
export const homeModelReading = (input: {
	chosenModel: ModelEntry | null;
	catalogue: CatalogueRead;
}): ModelReading => {
	if (input.chosenModel !== null)
		return { kind: "selector", selector: input.chosenModel.selector };
	if (input.catalogue === "loading") return { kind: "loading" };
	return { kind: "default" };
};

/** One row of the model picker: the computer's default, or an entry. `isDefault`
 *  marks the catalogue row the computer's `default` names. */
export type HomeModelRow =
	| Readonly<{ kind: "default"; selected: boolean }>
	| Readonly<{
			kind: "model";
			model: ModelEntry;
			selected: boolean;
			isDefault: boolean;
	  }>;

/**
 * The model half of the options sheet, in render order.
 *
 * THE DEFAULT ROW IS ALWAYS THERE (design review round 1, D1; UX U3). It used to
 * render only while a model was held, and its own tap set the held model to `null`
 * — so the tap unmounted the row it landed on, every entry moved up a row, and the
 * catalogue's first model came to rest under the reader's finger: a second "make
 * sure" tap chose the invented default this module exists to remove. Kept mounted,
 * the list's length and order depend on the catalogue alone and never on a tap.
 *
 * Selection is exactly one row: the default while nothing is held — the truthful
 * state, since the start body then names no model and the computer decides — or
 * the held entry. A held selector the catalogue does not list (a re-read dropped
 * it) selects nothing rather than guessing a neighbour.
 */
export const homeModelRows = (input: {
	models: readonly ModelEntry[];
	optionModel: ModelEntry | null;
	/** `default.selector` from `GET /api/models`, when the computer published one. */
	defaultSelector?: string | null;
}): readonly HomeModelRow[] => {
	/* WHEN THE DEFAULT IS NAMED AND LISTED, ITS OWN ROW IS THE WAY BACK (design
	 *  spec §6: "the effective model is always the ✓ row"). The separate "use this
	 *  computer's default" row would put a second ✓ beside the default model's row
	 *  for one choice, so it is dropped, and the default model's row carries the
	 *  meaning instead: the picker maps a tap on it to "choose nothing", so the
	 *  start still names no model and the configured default — not a pinned copy of
	 *  it — is what runs. Either way the row set depends on the catalogue alone,
	 *  never on a tap (D1). */
	const named =
		input.defaultSelector !== undefined &&
		input.defaultSelector !== null &&
		input.models.some((model) => model.selector === input.defaultSelector);
	const rows = input.models.map((model): HomeModelRow => {
		const isDefault = named && model.selector === input.defaultSelector;
		return {
			kind: "model",
			model,
			isDefault,
			selected:
				input.optionModel === null
					? isDefault
					: input.optionModel.selector === model.selector,
		};
	});
	return named
		? rows
		: [{ kind: "default", selected: input.optionModel === null }, ...rows];
};
