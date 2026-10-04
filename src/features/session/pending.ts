/**
 * The pending card's projection: `PendingRequest` in, the card's regions out.
 *
 * Three findings from the shipped client's own audit drive this file, and each one
 * is a rule rather than a layout choice:
 *
 *   - **`R10` — an approval raised by a TERMINAL session cannot be answered from
 *     the phone.** That is a deliberate v1 boundary of the relay
 *     (`docs/mobile.md` L250 at the pinned SHA, cited by
 *     `docs/ux/current-relay-audit.md` R10): the phone "shows the wait and says
 *     so". So `terminalOnly` is derived from the projection's own `kind`, and when
 *     it is true the card renders NO answer control at all — a button that cannot
 *     work is worse than no button, because the reader presses it and concludes
 *     the app is broken rather than that the approval belongs to their terminal.
 *   - **`R12` — "remember this choice" must name its scope.** The shipped row never
 *     said *which* choice: this command, this tool, this session? The label is
 *     built here so it can name the tool and the scope in one sentence.
 *   - **The `1 of N` badge**, and `Question N of M` for a multi-question ask:
 *     a card that shows one question of several without saying so reads as a card
 *     that lost the rest.
 *
 * No React, no React Native.
 */

import type { PendingRequest } from "@/contracts";
import { askOptionId, askQuestionId } from "@/ui/a11y";

/** Approval, or ask. The two share a frame and disagree about their controls. */
export type PendingKind = "approval" | "ask";

export interface PendingOptionView {
	label: string;
	/** The option's own consequence line. An option without one is a guess the
	 *  reader has to make (`components.md` § 13). */
	description: string;
	/** Index into `options` AS CARRIED. Never re-derive after sorting: the wire
	 *  index is what the answer cites. */
	index: number;
	recommended: boolean;
	testID: string;
}

export interface PendingView {
	kind: PendingKind;
	requestId: string;
	/** `approval requested · bash`, or `question · bash`. */
	meta: string;
	title: string;
	detail: string;
	/** `1 of N` when more than one decision is waiting, else `null`. */
	badge: string | null;
	/** `Question 1 of 2` for a multi-question ask, else `null`. */
	questionLabel: string | null;
	/** `ask-question-1-of-2`, built from the NUMBERS rather than parsed back out of
	 *  the label: `05-approval-answer` addresses this anchor by name, and an id
	 *  recovered by regex from display copy is one copy edit away from vanishing. */
	questionTestID: string | null;
	options: PendingOptionView[];
	/** A free-text answer, as opposed to a picker: `options` empty. */
	freeText: boolean;
	secret: boolean;
	/** The remember row's label, naming the tool and the scope (`R12`). */
	rememberLabel: string;
	/** True for a terminal session: the phone shows the wait and offers nothing. */
	terminalOnly: boolean;
	/** The sentence the card shows instead of controls, or `null` when it can be
	 *  answered from here. */
	boundarySentence: string | null;
	/** The detail is a command that will execute on the reader's machine. */
	runsOnComputer: boolean;
	/** The detail matched a known-destructive pattern, so the sentence hardens. */
	destructive: boolean;
	/** The sentence beside the destructive marker. */
	riskLabel: string;
}

/**
 * Patterns that make an approval's sentence say "destructive" rather than merely
 * "runs on your computer".
 *
 * A text heuristic, and it is stated as one: the wire carries no risk field
 * (`PendingRequest` in `contract.md` §6.7 has none), so the honest options are a
 * heuristic or no signal at all, and a reader about to approve `rm -rf` deserves
 * the signal. A miss is loud in one direction only — the generic "runs on …"
 * sentence is still true — so a false negative is a missed emphasis, never a lie.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
	/\brm\s+-[a-z]*[rf]/i,
	/\bmkfs\b/i,
	/\bdd\s+if=/i,
	/\bgit\s+push\b[^\n]*--force/i,
	/\bgit\s+reset\s+--hard\b/i,
	/\bgit\s+clean\s+-[a-z]*[fd]/i,
	/\bdrop\s+(table|database|schema)\b/i,
	/\btruncate\s+table\b/i,
	/\bshutdown\b|\breboot\b|\bkillall\b/i,
	/\bchmod\s+-R\b|\bchown\s+-R\b/i,
	/>\s*\/dev\/[sd]/i,
	/\bcurl\b[^\n]*\|\s*(ba)?sh/i,
];

/** Whether the approval's detail is an execution on the reader's machine. */
const COMMAND_PATTERNS: RegExp[] = [
	/\brun\s*:/i,
	/\bexec(ute)?\b\s*[:(]/i,
	/\bshell\b/i,
	/\bbash\b/i,
	/\bsudo\b/i,
];

export const isDestructiveDetail = (detail: string): boolean =>
	DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(detail));

const isExecutionDetail = (detail: string, title: string): boolean =>
	COMMAND_PATTERNS.some(
		(pattern) => pattern.test(detail) || pattern.test(title),
	);

/**
 * Where the command will run.
 *
 * Named rather than implied, and that is the point of `R10`'s sibling finding:
 * "the destination must be named rather than implied". The computer's label is
 * passed in because this module cannot know it, and `cwd` comes from the
 * projection because the working directory is what turns "a command" into "a
 * command in that repository".
 */
export const riskSentence = (input: {
	destructive: boolean;
	cwd: string;
	computerLabel: string;
}): string => {
	const where = input.cwd.length > 0 ? input.cwd : input.computerLabel;
	return input.destructive
		? `Destructive — runs on ${where}`
		: `Runs on ${where}`;
};

export interface PendingViewInput {
	pending: PendingRequest;
	/** The projection's `kind`: `tui` is the terminal-owned session. */
	sessionKind: string;
	/** The projection's `ended` receipt: the daemon watched this session's process
	 *  die. A request cannot still be answerable then, whatever its `kind`. */
	ended: boolean;
	/** How many decisions are waiting, for the `1 of N` badge. */
	pendingCount: number;
	/** The computer's label, for the risk sentence. */
	computerLabel: string;
	/** The session's working directory. */
	cwd: string;
}

/**
 * Why a request cannot be answered from this screen, in the reader's terms.
 *
 * Two different boundaries with one behaviour and two sentences: a session the
 * reader's own terminal is driving (the relay answers it at the terminal — `R10`),
 * and a session that has ENDED. Saying "waiting in your terminal" to a reader whose
 * session is over names the wrong cause, and the cause is the only thing this card
 * has left to give them.
 */
export const PENDING_BOUNDARY_COPY = {
	terminal:
		"This approval is waiting in your terminal. Answer it there and this card will clear.",
	ended:
		"This session has ended, so this request can no longer be answered here.",
} as const;

export const pendingView = (input: PendingViewInput): PendingView => {
	const { pending } = input;
	const kind: PendingKind = pending.kind === "ask" ? "ask" : "approval";
	const tool = pending.title.length > 0 ? pending.title : "this tool";
	const terminalKind = input.sessionKind === "tui";
	const destructive =
		kind === "approval" && isDestructiveDetail(pending.detail);
	return {
		kind,
		requestId: pending.request_id,
		// An approval's `title` is the TOOL (`bash`), so the meta line names it. An
		// ask's `title` is the whole QUESTION, which the body already renders in full:
		// repeating it here printed the question twice and wrapped the meta line into
		// the `1 of N` badge (seen in the 390 pt frame).
		meta: kind === "approval" ? `approval requested · ${tool}` : "question",
		title: pending.title,
		detail: pending.detail,
		badge: input.pendingCount > 1 ? `1 of ${input.pendingCount}` : null,
		questionLabel:
			pending.question_total > 1
				? `Question ${pending.question_index + 1} of ${pending.question_total}`
				: null,
		questionTestID:
			pending.question_total > 1
				? askQuestionId(pending.question_index + 1, pending.question_total)
				: null,
		options: pending.options.map((option, index) => ({
			label: option.label,
			description: option.description,
			index,
			// `recommended` is an index into the options AS CARRIED, and a client that
			// re-sorted them and kept the index would mark the wrong one.
			recommended: pending.recommended === index,
			testID: askOptionId(index),
		})),
		freeText: pending.options.length === 0,
		secret: pending.secret,
		// `R12`: the scope is named, in the reader's words, after the word this card
		// actually grants. "this session" is the true scope — a remember choice is
		// stored per session on the runtime, not globally.
		rememberLabel: `Always allow \`${tool}\` in this session`,
		/* The wire fact, cited rather than guessed: the committed capture of an ended
		 * session's frame carries `pending: null, pending_count: 0`
		 * (`fixtures/relay/sse/sse_projection_ended.json`, captured 2026-09-30 at
		 * `fc851a94e`), so a pending request outliving `ended` is not something the
		 * relay produces today. The gate is here anyway because the failure it
		 * prevents is unbounded in the bad direction: an ended session's approval
		 * rendered WITH controls offers the reader a button that can only refuse,
		 * and `ended` is the reliable signal that nothing can be answered — more
		 * reliable than `kind`, which a non-`tui` session also has. */
		/* R10 narrows to APPROVALS (ADR 0005 §6, E2): a queued ask is answerable
		 *  even on a `tui`-hosted session — the TUI process that adopted the
		 *  session reconciles the queue within a ≤60 s bound — and with no live
		 *  owner the RELAY refuses, in its own sentence, which the app renders
		 *  verbatim in the pinned controls region. Greying an ask's form here
		 *  would hide a working path behind a boundary that no longer applies to
		 *  it, and a silently disabled control is the failure this whole card
		 *  contract exists to avoid. */
		terminalOnly:
			kind === "approval" && (input.sessionKind === "tui" || input.ended),
		boundarySentence:
			kind === "approval"
				? input.ended
					? PENDING_BOUNDARY_COPY.ended
					: terminalKind
						? PENDING_BOUNDARY_COPY.terminal
						: null
				: null,
		runsOnComputer:
			kind === "approval" &&
			(isExecutionDetail(pending.detail, pending.title) || destructive),
		destructive,
		riskLabel: riskSentence({
			destructive,
			cwd: input.cwd,
			computerLabel: input.computerLabel,
		}),
	};
};
