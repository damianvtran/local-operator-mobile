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
	};
};

/** The folder the screen holds once a read has succeeded.
 *
 * WHY IT TAKES THE CURRENT VALUE (review R2). Every successful read of the folder
 * list — the mount's own and the retry's — ends here, and a read must never move a
 * folder the reader applied in the sheet. So it fills a slot nobody has filled and
 * otherwise leaves the holder alone: either the reader's choice or the first
 * successful read's `default` got there first, and both outrank a later read.
 * Replacing the slot unconditionally was the second half of the model-retry defect:
 * that retry re-ran this read and put the computer's default back over the reader's
 * folder, silently. */
export const foldersApplied = (
	current: string | null,
	read: HomeFolders,
): string => current ?? read.default;

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
}): StartSessionRequest | null => {
	if (input.cwd === null) return null;
	return {
		cwd: input.cwd,
		...(input.chosenModel !== null
			? {
					provider: input.chosenModel.provider,
					model_id: input.chosenModel.model_id,
				}
			: {}),
	};
};

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
 *   `folders.home` and the read resolved, it is replaced with `folders.default` —
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
}): StartSessionRequest | null => {
	const { stored, folders, chosenModel } = input;
	if (stored === null) return null;
	const cwd =
		folders !== null && stored.cwd === folders.home
			? folders.default
			: stored.cwd;
	const next: StartSessionRequest = {
		...(cwd !== undefined ? { cwd } : {}),
		...(chosenModel !== null
			? { provider: chosenModel.provider, model_id: chosenModel.model_id }
			: {}),
	};
	/* Key order matters to this comparison only because both sides are built by the
	 *  same two files (`homeStartSelection` above, the coordinator's `copy`). */
	return JSON.stringify(next) === JSON.stringify(stored) ? null : next;
};

/** The model catalogue's read, as the screen holds it. */
export type CatalogueRead = "loading" | "ready" | "failed";

/**
 * What the model chip may say, in the order the facts arrive.
 *
 * A CHOSEN MODEL ALWAYS WINS: it is known without the catalogue, so a read still in
 * flight (or one that failed) must not replace a selector the reader picked. With
 * nothing chosen the answer is the computer's own default, never a catalogue row —
 * and a failed read says it could not be read rather than reporting the session as
 * connected with no model (`n/a`), which was a silent failure wearing a state's
 * clothes.
 */
export const homeModelReading = (input: {
	chosenModel: ModelEntry | null;
	catalogue: CatalogueRead;
}): ModelReading => {
	if (input.chosenModel !== null)
		return { kind: "selector", selector: input.chosenModel.selector };
	if (input.catalogue === "failed") return { kind: "unknown" };
	if (input.catalogue === "loading") return { kind: "loading" };
	return { kind: "default" };
};
