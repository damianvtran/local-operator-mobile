import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelEntry } from "@/contracts";
import {
	effortAfterModelChange,
	effortOffer,
} from "@/features/home/picker-model";
import type { RelayEndpoints } from "@/relay";

export type StoredModelChoice = { model: ModelEntry; effort: string | null };

/**
 * Failures where the runtime refused `set_model`/`set_effort` AFTER the session
 * was reachable (resumed by this attempt, or already live). Told apart from a
 * failed resume on purpose: the composer words an ended-session Send failure as
 * "couldn't be reopened … tap Ended", which is false once the resume landed —
 * the header already reads Live/Idle and has no Ended control (PR #350 D2/U1).
 *
 * A mark, not a wrapper class: the thrown value stays the relay's own error, so
 * its `status`/`kind` reach every existing reader (the sheet callers and the
 * HTTP contract tests assert the 409) unchanged. Only the relay commands are
 * marked; local pre-checks and ownership-drift errors are not a statement about
 * a reopened session and keep the old wording.
 */
const refusedSettings = new WeakSet<object>();

export const isStoredSettingsRefusal = (error: unknown): boolean =>
	typeof error === "object" && error !== null && refusedSettings.has(error);

const markedRefusal = async (run: () => Promise<unknown>) => {
	try {
		await run();
	} catch (error) {
		const marked =
			typeof error === "object" && error !== null
				? error
				: new Error(String(error));
		refusedSettings.add(marked);
		throw marked;
	}
};

export const storedEfforts = (model: ModelEntry) => {
	const offer = effortOffer({
		supported: true,
		chosenModel: model,
		models: [model],
		catalogueDefault: undefined,
	});
	return offer.kind === "ladder" ? [...offer.rungs] : [];
};

/** The relay cannot set a cold runtime's model. Keep intent on the phone until an
 * explicit Resume/Send, then use the existing same-session protocol. In particular,
 * neither opening the picker nor choosing a row may spawn a process. A refusal
 * keeps the intent and never admits a prompt under the wrong model. */
export async function applyStoredModel(
	client: Pick<RelayEndpoints, "resumeSession" | "command">,
	sessionId: string,
	choice: StoredModelChoice,
	resume: boolean,
	assertCurrent: () => void = () => {},
) {
	if (choice.model.connected === false)
		throw new Error("model is not connected");
	if (
		choice.effort !== null &&
		!storedEfforts(choice.model).includes(choice.effort)
	)
		throw new Error("effort is not supported by the selected model");
	assertCurrent();
	if (resume) await client.resumeSession(sessionId);
	assertCurrent();
	await markedRefusal(() =>
		client.command(sessionId, {
			op: "set_model",
			provider: choice.model.provider,
			model_id: choice.model.model_id,
		}),
	);
	assertCurrent();
	const effort = choice.effort;
	if (effort !== null)
		await markedRefusal(() =>
			client.command(sessionId, { op: "set_effort", effort }),
		);
	assertCurrent();
}

export function useStoredModel(input: {
	client: RelayEndpoints | null;
	sessionId: string;
	/** Remote ownership/capabilities are enforced before enabling this path. */
	enabled: boolean;
	ended: boolean;
	/** Stable admission identity, independent of ended → live projection changes. */
	ownership?: string;
}) {
	const { client, sessionId, enabled, ended, ownership = "local" } = input;
	const owner = useMemo(
		() => ({ client, sessionId, ownership }),
		[client, sessionId, ownership],
	);
	const live = useRef({ ended, enabled });
	live.current = { ended, enabled };
	const currentOwner = useRef<object | null>(owner);
	currentOwner.current = owner;
	useEffect(() => {
		currentOwner.current = owner;
		return () => {
			if (currentOwner.current === owner) currentOwner.current = null;
		};
	}, [owner]);
	const [choice, setChoice] = useState<{
		owner: object;
		value: StoredModelChoice;
	} | null>(null);
	const pending = choice?.owner === owner ? choice.value : null;
	/* Which picker change last failed, owned HERE rather than in the screen
	 * (PR #350 U2): the screen's own state had no way to learn that the choice it
	 * described was later applied, so "Could not change the model." outlived a
	 * successful retry and delivery. It clears only when settings this lane owns
	 * land (a new pick's ACK, or `prepare` applying the stored choice) — never on
	 * a delivered message by itself, which says nothing about a live switch that
	 * was refused and is still not in effect. */
	const [settingsError, setSettingsError] = useState<"model" | "effort" | null>(
		null,
	);
	// Retain revoked intent as a refusal rather than silently sending with a
	// different model. The screen hides it, but Send must still explain failure.
	const choiceRef = useRef(choice);
	choiceRef.current = choice;
	const pendingRef = useRef(pending);
	pendingRef.current = pending;
	const remember = useCallback(
		(value: StoredModelChoice) => {
			const next = { owner, value };
			choiceRef.current = next;
			pendingRef.current = value;
			setChoice(next);
		},
		[owner],
	);
	const [catalogue, setCatalogue] = useState<{
		owner: object;
		models: ModelEntry[];
		loading: boolean;
		failed: boolean;
	}>({ owner, models: [], loading: enabled, failed: false });
	const [epoch, retry] = useState(0);
	useEffect(() => {
		// Explicit retry invalidates only this catalogue read, never the runtime.
		void epoch;
		if (!enabled) return;
		if (!client) {
			setCatalogue({ owner, models: [], loading: false, failed: true });
			return;
		}
		let cancelled = false;
		setCatalogue((previous) => ({
			owner,
			models: previous.owner === owner ? previous.models : [],
			loading: true,
			failed: false,
		}));
		// /api/models belongs to the computer, not an attached session runtime.
		void client.models().then(
			(result) => {
				if (!cancelled)
					setCatalogue({
						owner,
						models: result.models,
						loading: false,
						failed: false,
					});
			},
			() => {
				if (!cancelled)
					setCatalogue((previous) => ({
						...previous,
						loading: false,
						failed: true,
					}));
			},
		);
		return () => {
			cancelled = true;
		};
	}, [client, owner, enabled, epoch]);
	const pick = useCallback(
		(model: ModelEntry, effort?: string | null) => {
			if (!enabled || model.connected === false) return;
			const offer = effortOffer({
				supported: true,
				chosenModel: model,
				models: [model],
				catalogueDefault: undefined,
			});
			const valid = effortAfterModelChange(
				effort === undefined ? (pendingRef.current?.effort ?? null) : effort,
				offer,
			);
			remember({ model, effort: valid });
		},
		[enabled, remember],
	);
	// Header Resume and composer Send share preparation, including an ack that
	// arrives before React repaints. Otherwise two explicit actions can interleave
	// a late set_model with the first admitted prompt.
	const applying = useRef<{
		owner: object;
		choice: StoredModelChoice;
		promise: Promise<void>;
	} | null>(null);
	const assertOwner = useCallback(() => {
		if (!client || currentOwner.current !== owner)
			throw new Error("session route or ownership changed");
		if (choiceRef.current && choiceRef.current.owner !== owner)
			throw new Error("model selection unavailable after ownership changed");
		return client;
	}, [client, owner]);
	const prepare = useCallback(async () => {
		const endpoints = assertOwner();
		// Serialize newer intent behind the old ACK, then read the synchronous
		// ref, not a render snapshot. Header Resume and Send share this barrier.
		for (;;) {
			const captured = pendingRef.current;
			const existing = applying.current;
			if (existing?.owner === owner) {
				try {
					await existing.promise;
				} catch (error) {
					assertOwner();
					if (pendingRef.current === existing.choice) throw error;
				}
				assertOwner();
				continue;
			}
			if (!captured) return;
			const assertCurrent = () => {
				assertOwner();
				if (owner.ownership !== "local")
					throw new Error("stored model selection requires local ownership");
				if (pendingRef.current !== captured)
					throw new Error("model selection changed during preparation");
			};
			const promise = applyStoredModel(
				endpoints,
				sessionId,
				captured,
				live.current.ended,
				assertCurrent,
			);
			applying.current = { owner, choice: captured, promise };
			try {
				await promise;
				if (pendingRef.current === captured) {
					pendingRef.current = null;
					choiceRef.current = null;
					setChoice(null);
					// The newest stored choice is now the runtime's: any earlier
					// picker failure on this lane no longer applies (U2).
					setSettingsError(null);
				}
			} catch (error) {
				assertOwner();
				if (pendingRef.current === captured) throw error;
			} finally {
				if (applying.current?.promise === promise) applying.current = null;
			}
		}
	}, [assertOwner, sessionId, owner]);
	/* A picker change starts by retiring the previous failure (the reader acted
	 * again) and records its own kind if it fails; the rejection still reaches
	 * the caller, whose sheet handler only needs to stop it going unhandled. */
	const recordingFailure = useCallback(
		async (kind: "model" | "effort", run: () => Promise<void>) => {
			setSettingsError(null);
			try {
				await run();
			} catch (error) {
				setSettingsError(kind);
				throw error;
			}
		},
		[],
	);
	// Both sheet callbacks use this same intent lane after Resume. A failed
	// effort ACK must never resurrect model A over a later explicit model B.
	const selectModel = useCallback(
		async (model: ModelEntry) =>
			recordingFailure("model", async () => {
				const endpoints = assertOwner();
				if (live.current.enabled) {
					pick(model);
					return;
				}
				if (pendingRef.current) {
					remember({
						model,
						effort: effortAfterModelChange(
							pendingRef.current.effort,
							effortOffer({
								supported: true,
								chosenModel: model,
								models: [model],
								catalogueDefault: undefined,
							}),
						),
					});
					await prepare();
				} else {
					await endpoints.command(sessionId, {
						op: "set_model",
						provider: model.provider,
						model_id: model.model_id,
					});
					assertOwner();
				}
			}),
		[assertOwner, pick, remember, prepare, sessionId, recordingFailure],
	);
	const selectEffort = useCallback(
		async (effort: string, model?: ModelEntry | null) =>
			recordingFailure("effort", async () => {
				const endpoints = assertOwner();
				if (live.current.enabled) {
					if (model) pick(model, effort);
					return;
				}
				if (pendingRef.current) {
					remember({ ...pendingRef.current, effort });
					await prepare();
				} else {
					await endpoints.command(sessionId, { op: "set_effort", effort });
					assertOwner();
				}
			}),
		[assertOwner, pick, remember, prepare, sessionId, recordingFailure],
	);
	const resume = useCallback(async () => {
		const endpoints = assertOwner();
		if (pendingRef.current || choiceRef.current) return prepare();
		if (owner.ownership !== "local")
			throw new Error("resume requires local ownership");
		await endpoints.resumeSession(sessionId);
		assertOwner();
	}, [prepare, assertOwner, owner, sessionId]);
	return {
		resume,
		pending,
		pick,
		selectModel,
		selectEffort,
		prepare,
		settingsError,
		clearSettingsError: () => setSettingsError(null),
		models: catalogue.owner === owner ? catalogue.models : [],
		loading: catalogue.owner !== owner || catalogue.loading,
		failed: catalogue.owner === owner && catalogue.failed,
		retry: () => retry((value) => value + 1),
	};
}
