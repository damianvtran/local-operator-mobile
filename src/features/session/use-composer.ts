import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PromptImage } from "@/contracts";
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
	deviceStore,
	readDraft,
	writeDraft,
} from "@/features/session/device-storage";
import type { SessionRelaySource } from "@/features/session/relay-source";
import { parseSlashDraft, slashQuery } from "@/features/session/slash";
import {
	type ContinuationEnvelope,
	isRelayError,
	RetryEnvelopeStore,
	settleOutcomeFromError,
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
	/** Runs or fills a slash command from the sheet. */
	slash: (fill: string, submit: boolean) => void;
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

	const envelopeStore = useMemo(
		() => new RetryEnvelopeStore({ store: deviceStore }),
		[],
	);

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
				/* The envelope's op belongs to the envelope: `streaming` can change
				 * between the admission and the acknowledgement, so a retry replays the
				 * op it was minted with rather than one derived from the current frame. */
				const envelope = await envelopeStore.holdNew(
					sessionId,
					op,
					trimmed,
					payloadImages,
				);
				setRetained(envelope);
				const ack = await endpoints.command(sessionId, {
					op: envelope.op,
					command_id: envelope.command_id,
					text: envelope.text,
					...(envelope.images ? { images: envelope.images } : {}),
				});
				void ack;
				await envelopeStore.settle(sessionId, { kind: "ack" });
				setRetained(null);
				// Only clear the visible draft when the acknowledged bytes ARE the
				// visible draft. If the reader edited while the request was out, the ack
				// proves the OLD instruction was delivered and says nothing about what is
				// on screen — so the edit stays, as the next command.
				if (
					acknowledgedCurrentDraft(
						{
							text: envelope.text,
							...(envelope.images ? { images: envelope.images } : {}),
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
				/* The envelope's disposition is decided by the relay error layer, which
				 * already resolved the status and the gateway's reason vocabulary into
				 * one of four outcomes. A second reading of the same status here is how
				 * one failure acquires two rules.
				 *
				 * A throw that is NOT a `RelayError` is an unknown failure, so the
				 * envelope is kept (`transport`) and the reader gets the product's own
				 * sentence — never `String(exception)`, which is how "Load failed" became
				 * a shipped first impression (U3). */
				if (isRelayError(failure)) {
					const receipt = receiptForError(failure);
					await envelopeStore.settle(
						receipt.kind === "sign-out" ? null : sessionId,
						settleOutcomeFromError(failure),
					);
					setRetained(
						receipt.kind === "ambiguous"
							? await envelopeStore.peek(sessionId)
							: null,
					);
					setError(receipt.message);
				} else {
					await envelopeStore.settle(sessionId, { kind: "transport" });
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
				const ack = await endpoints.command(sessionId, {
					op: held.op,
					command_id: held.command_id,
					text: held.text,
					...(held.images ? { images: held.images } : {}),
				});
				void ack;
				await envelopeStore.settle(sessionId, { kind: "ack" });
				setRetained(null);
				// The replayed instruction is the ENVELOPE's, so the visible draft is
				// never the thing that was delivered: it stays for the reader to send.
				setNotice(COMPOSER_COPY.retryAckNotice);
			} catch (failure) {
				if (isRelayError(failure)) {
					const receipt = receiptForError(failure);
					await envelopeStore.settle(
						receipt.kind === "sign-out" ? null : sessionId,
						settleOutcomeFromError(failure),
					);
					setRetained(
						receipt.kind === "ambiguous"
							? await envelopeStore.peek(sessionId)
							: null,
					);
					setError(receipt.message);
				} else {
					await envelopeStore.settle(sessionId, { kind: "transport" });
					setRetained(await envelopeStore.peek(sessionId));
					setError(ambiguousMessage(streaming));
				}
			} finally {
				setSending(false);
			}
		})();
		// Same reason as `runSend`: the fallback sentence reads the turn's state.
	}, [endpoints, sessionId, envelopeStore, streaming]);

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
		(fill: string, submit: boolean) => {
			setDraft(fill);
			if (submit) void runSend("prompt");
		},
		[setDraft, runSend],
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
