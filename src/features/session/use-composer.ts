import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PromptImage, SlashCommand } from "@/contracts";
import { pickImage } from "@/features/session/attach";
import {
	acknowledgedCurrentDraft,
	ambiguousMessage,
	COMPOSER_COPY,
	chooseOp,
	composerControls,
	receiptForError,
} from "@/features/session/composer";
import {
	clearDraft,
	readDraft,
	writeDraft,
} from "@/features/session/device-storage";
import { envelopeStoreFor } from "@/features/session/envelope-store";
import type { SessionRelaySource } from "@/features/session/relay-source";
import {
	parseSlashDraft,
	slashQuery,
	slashTap,
	slashTapRequest,
} from "@/features/session/slash";
import {
	type ContinuationEnvelope,
	isRelayError,
	sendPersistedCommand,
} from "@/relay";

/**
 * The composer's state, and the one rule it exists to keep: **a typed instruction
 * whose delivery is unknown is never silently dropped.**
 *
 * `holdNew` before the request and `settle` after it is the whole design. The
 * envelope store mints the UUID once — the identity of those exact bytes — and
 * every later attempt replays them under that same id, so the runtime's durable
 * ledger de-duplicates a retry that a lost acknowledgement made necessary. Minting
 * a fresh id on a retry is the duplicate this exists to prevent
 * (`docs/relay/contract.md` § 5.1).
 *
 * The draft is a separate thing from the envelope on purpose, and the difference is
 * what `C5` turns on: a `401` clears every envelope (the identity that owned them is
 * gone) and clears NO draft (the reader's unfinished sentence is theirs, and
 * deleting it on an auth blip is the failure the shipped client's rule names).
 */
export interface ComposerState {
	draft: string;
	setDraft: (text: string) => void;
	images: PromptImage[];
	addImage: (image: PromptImage) => void;
	removeImage: (index: number) => void;
	clearImages: () => void;
	/** Opens the platform picker and adds the chosen image. A cancel adds nothing
	 *  and says nothing; a failed read says so on the composer's error line. */
	attach: () => void;
	/** A picker is open or an image is being read. */
	attaching: boolean;
	/** The instruction retained under an unknown outcome, or `null`. */
	retained: ContinuationEnvelope | null;
	sending: boolean;
	/** `null` when nothing is wrong; a sentence otherwise. */
	error: string | null;
	/** A definitive acknowledgement of an EDITED draft: a success, not an error. */
	notice: string | null;
	controls: ReturnType<typeof composerControls>;
	send: () => void;
	/** Replays the retained instruction under its own UUID. */
	retry: () => void;
	stop: () => void;
	/** Runs or fills a slash command the reader tapped in the sheet. It takes the
	 *  COMMAND, not the text it would produce: the request is derived from the
	 *  command, so a tap cannot send whatever the draft happened to hold. */
	slash: (command: SlashCommand) => void;
	answerApproval: (
		requestId: string,
		approved: boolean,
		remember: boolean,
	) => void;
	answerAsk: (requestId: string, value: string, questionIndex: number) => void;
}

export const useComposer = (input: {
	sessionId: string;
	source: SessionRelaySource;
	streaming: boolean;
	ended: boolean;
	/** Bumped by the screen when a pending card needs the draft left alone. */
	onSent?: () => void;
}): ComposerState => {
	// `onSent` is destructured rather than kept as `input`: an object prop in a
	// dependency array is a new identity every render, which makes every
	// `useCallback` below it pointless.
	const { sessionId, source, streaming, ended, onSent } = input;
	const endpoints = source.endpoints;

	/* ONE store per session, shared process-wide: two instances on one session
	 * would each mint an id for the same typed instruction, which is the duplicate
	 * POST the retry envelope exists to prevent. See `envelope-store.ts`. */
	const envelopeStore = envelopeStoreFor(sessionId);

	const [draft, setDraftState] = useState("");
	const [images, setImages] = useState<PromptImage[]>([]);
	const [retained, setRetained] = useState<ContinuationEnvelope | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [attaching, setAttaching] = useState(false);

	/* Mirrors of the two values an in-flight send has to compare AFTER it returns:
	 * the reader may have edited the draft while the request was out, and the
	 * comparison decides whether the acknowledgement clears it. */
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const imagesRef = useRef(images);
	imagesRef.current = images;

	/* The draft is loaded per session and written through on every keystroke. A
	 * write per keystroke is the price of surviving an app kill, and it is a single
	 * small string: the envelope path — the one that can be megabytes — is the one
	 * that writes once per send instead. */
	useEffect(() => {
		let cancelled = false;
		setDraftState("");
		setImages([]);
		setError(null);
		setNotice(null);
		readDraft(sessionId).then((stored) => {
			if (!cancelled) setDraftState(stored);
		});
		// The retained envelope is re-read from storage rather than kept in memory:
		// that is the point of it being durable, and it is how a retry survives a
		// reload, a reconnect or a navigation away and back.
		envelopeStore.peek(sessionId).then((held) => {
			if (cancelled) return;
			setRetained(held);
			if (held !== null) setError(COMPOSER_COPY.retainedError);
		});
		return () => {
			cancelled = true;
		};
	}, [sessionId, envelopeStore]);

	const setDraft = useCallback(
		(text: string) => {
			setDraftState(text);
			void writeDraft(sessionId, text);
		},
		[sessionId],
	);

	/* --------------------------------------------------------------- the send */

	const runSend = useCallback(
		async (op: "prompt" | "steer") => {
			if (endpoints === null) return;
			const trimmed = draftRef.current.trim();
			const payloadImages =
				imagesRef.current.length > 0
					? imagesRef.current.map((image) => ({ ...image }))
					: undefined;
			/* A slash draft is the slash op, and only when there is no attachment: a
			 * `/foo` caption with an image is a prompt with a slash in it. */
			const parsed =
				payloadImages === undefined ? parseSlashDraft(trimmed) : null;

			setSending(true);
			setError(null);
			setNotice(null);
			try {
				if (parsed !== null) {
					// No envelope: a slash command carries no durable identity to replay,
					// so there is nothing whose outcome could be ambiguous.
					await endpoints.command(sessionId, {
						op: "slash",
						command: parsed.command,
						args: parsed.args,
					});
					setDraft("");
					return;
				}
				/* Hold, send and settle live in `@/relay`'s `sendPersistedCommand`: one
				 * implementation of the rule that a retry replays the SAME `command_id`, with
				 * the envelope's disposition decided by the error taxonomy rather than here.
				 * The envelope's op belongs to the envelope — `streaming` can change between
				 * admission and acknowledgement — so the op passed in is used only when a NEW
				 * instruction is minted. */
				const result = await sendPersistedCommand({
					client: endpoints,
					envelopes: envelopeStore,
					sessionId,
					op,
					text: trimmed,
					...(payloadImages ? { images: payloadImages } : {}),
				});
				setRetained(null);
				if (result.reusedPreviousDraft) {
					/* An EARLIER unresolved instruction was replayed under its own UUID: the
					 * text the reader just typed was NOT sent as a new instruction, so it is
					 * re-offered — left exactly as they left it, in the composer, with a
					 * notice that says it was not sent. A draft that vanishes without a word
					 * is the failure this mechanism exists to prevent; the same applies to a
					 * draft that looks sent and is not. */
					setNotice(COMPOSER_COPY.reusedDraftNotice);
				} else if (
					// Only clear the visible draft when the acknowledged bytes ARE the
					// visible draft. If the reader edited while the request was out, the ack
					// proves the OLD instruction was delivered and says nothing about what is
					// on screen — so the edit stays, as the next command.
					acknowledgedCurrentDraft(
						{
							text: trimmed,
							...(payloadImages ? { images: payloadImages } : {}),
						},
						{
							text: draftRef.current.trim(),
							...(payloadImages ? { images: payloadImages } : {}),
						},
					)
				) {
					setDraft("");
					setImages([]);
				} else {
					setNotice(COMPOSER_COPY.retryAckNotice);
				}
				onSent?.();
			} catch (failure) {
				/* The envelope's disposition is already settled by `sendPersistedCommand`,
				 * which reads the relay error layer's own `envelope` directive — so this
				 * handler presents and does not decide. Settling again here would be a second
				 * reading of one failure, which is how one failure acquires two rules. */
				if (isRelayError(failure)) {
					const receipt = receiptForError(failure);
					setRetained(
						receipt.kind === "ambiguous"
							? await envelopeStore.peek(sessionId)
							: null,
					);
					setError(receipt.message);
				} else {
					setRetained(await envelopeStore.peek(sessionId));
					setError(ambiguousMessage(streaming));
				}
			} finally {
				setSending(false);
			}
		},
		// `streaming` is a real dependency, not a lint appeasement: `ambiguousMessage`
		// and `chooseOp` both read it, so a stale closure here would ask the reader
		// "couldn't continue this conversation" about a live turn — or send a second
		// prompt into a streaming session where a steer was meant.
		[endpoints, sessionId, envelopeStore, setDraft, onSent, streaming],
	);

	const send = useCallback(() => {
		void runSend(chooseOp(streaming));
	}, [runSend, streaming]);

	const retry = useCallback(() => {
		void (async () => {
			const held = await envelopeStore.peek(sessionId);
			if (held === null || endpoints === null) return;
			setSending(true);
			setError(null);
			try {
				/* The retry IS the replay: `holdNew` returns the stored envelope for this
				 * session, so this sends the bytes and the UUID it was minted with. */
				const result = await sendPersistedCommand({
					client: endpoints,
					envelopes: envelopeStore,
					sessionId,
					op: held.op,
					text: held.text,
					...(held.images ? { images: held.images } : {}),
				});
				void result;
				setRetained(null);
				// The replayed instruction is the ENVELOPE's, so the visible draft is
				// never the thing that was delivered: it stays for the reader to send.
				setNotice(COMPOSER_COPY.retryAckNotice);
			} catch (failure) {
				if (isRelayError(failure)) {
					const receipt = receiptForError(failure);
					setRetained(
						receipt.kind === "ambiguous"
							? await envelopeStore.peek(sessionId)
							: null,
					);
					setError(receipt.message);
				} else {
					setRetained(await envelopeStore.peek(sessionId));
					setError(ambiguousMessage(streaming));
				}
			} finally {
				setSending(false);
			}
		})();
	}, [endpoints, envelopeStore, sessionId, streaming]);

	const stop = useCallback(() => {
		void (async () => {
			if (endpoints === null) return;
			try {
				await endpoints.command(sessionId, { op: "abort" });
			} catch (failure) {
				setError(
					isRelayError(failure)
						? (failure.displayableMessage ?? COMPOSER_COPY.steerError)
						: COMPOSER_COPY.steerError,
				);
			}
		})();
	}, [endpoints, sessionId]);

	/* ------------------------------------------------------------- the answers */

	const answerApproval = useCallback(
		(requestId: string, approved: boolean, remember: boolean) => {
			void (async () => {
				if (endpoints === null) return;
				setSending(true);
				setError(null);
				try {
					await endpoints.command(sessionId, {
						op: "approval_answer",
						request_id: requestId,
						approved,
						remember,
					});
				} catch (failure) {
					setError(
						isRelayError(failure)
							? (failure.displayableMessage ?? COMPOSER_COPY.continuationError)
							: COMPOSER_COPY.continuationError,
					);
				} finally {
					setSending(false);
				}
			})();
		},
		[endpoints, sessionId],
	);

	const answerAsk = useCallback(
		(requestId: string, value: string, questionIndex: number) => {
			void (async () => {
				if (endpoints === null) return;
				setSending(true);
				setError(null);
				try {
					await endpoints.command(sessionId, {
						op: "ask_answer",
						request_id: requestId,
						value,
						question_index: questionIndex,
					});
				} catch (failure) {
					setError(
						isRelayError(failure)
							? (failure.displayableMessage ?? COMPOSER_COPY.continuationError)
							: COMPOSER_COPY.continuationError,
					);
				} finally {
					setSending(false);
				}
			})();
		},
		[endpoints, sessionId],
	);

	const attach = useCallback(() => {
		void (async () => {
			setAttaching(true);
			try {
				const image = await pickImage();
				if (image !== null) setImages((current) => [...current, image]);
			} catch {
				setError(COMPOSER_COPY.attachError);
			} finally {
				setAttaching(false);
			}
		})();
	}, []);

	const slash = useCallback(
		(command: SlashCommand) => {
			const tap = slashTap(command);
			setDraft(tap.fill);
			if (!tap.submit) return;
			/* The run-immediately arm. It sends the request the COMMAND names, never a
			 * re-parse of the draft: the draft ref is assigned during render, so it
			 * still holds the pre-tap text here, and re-parsing it sent the partial
			 * token the reader had typed (`/he`) for a tap on `/help` — 24 of the
			 * relay's 46 commands (QA round 1, Q1). A slash request carries no
			 * attachment, which is the same rule the typed path applies. */
			const request = slashTapRequest(command);
			if (request === null || endpoints === null) return;
			void endpoints.command(sessionId, {
				op: "slash",
				command: request.command,
				args: request.args,
			});
		},
		[endpoints, sessionId, setDraft],
	);

	const controls = useMemo(
		() =>
			composerControls({
				streaming,
				hasDraft: draft.trim().length > 0,
				hasImages: images.length > 0,
				sending,
				envelopePending: retained !== null,
				ended,
			}),
		[streaming, draft, images.length, sending, retained, ended],
	);

	return {
		draft,
		setDraft,
		images,
		addImage: (image) => setImages((current) => [...current, image]),
		removeImage: (index) =>
			setImages((current) => current.filter((_, at) => at !== index)),
		clearImages: () => setImages([]),
		attach,
		attaching,
		retained,
		sending,
		error,
		notice,
		controls,
		send,
		retry,
		stop,
		slash,
		answerApproval,
		answerAsk,
	};
};

/** The slash query the composer's draft implies, or `null` when the sheet should
 *  stay shut. Exported so the screen does not re-derive the trigger. */
export const draftSlashQuery = (draft: string): string | null =>
	slashQuery(draft);

/** Discards a session's draft AND its envelope. The only caller is an explicit
 *  sign-out or an identity change: never a `401`. */
export const discardSessionDraft = async (sessionId: string): Promise<void> => {
	await clearDraft(sessionId);
};
