import { Check } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type {
	SessionTagsResponse,
	TagCatalogueEntry,
	TagRef,
} from "@/contracts";
import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import {
	TagWriteQueue,
	type TagWriteRequest,
} from "@/features/sessions/tag-write-queue";
import {
	catalogueWithAssigned,
	clearedTags,
	desiredTagWrite,
	draftMatchesDesired,
	settledPrimary,
} from "@/features/sessions/tags";
import { isRelayError, TRANSPORT_SENTENCE } from "@/relay";
import { CONTROL, ROLE, SURFACE, sessionTagOptionId } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { EmptyState } from "@/ui/components/empty-state";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/**
 * The conversation-tags sheet: the catalogue, one checkbox per category, and
 * one clearing action.
 *
 * WHAT OWNS THE TRUTH. Nothing in this file caches an assignment beyond the
 * write it is currently asking for. The list row's tags come from the relay's
 * SSE frame (`SessionSummary.tags`, and the contract sends `[]`/`null` rather
 * than absence on a relay that carries the field), and this sheet opens on that
 * state. A toggle derives a whole DESIRED state (`desiredTagWrite`) and sends
 * it: the route is idempotent, so a retry can never flip a tag back the way a
 * replayed delta would.
 *
 * The three readings of a write, in order:
 *  1. **Optimistic** — the checkbox moves the moment it is pressed, because a
 *     control that waits on a tunnel before acknowledging a press feels broken.
 *  2. **Read-back** — the relay's canonical answer replaces the optimistic
 *     state (names resolved, orphans pruned, primary settled). `primary` is
 *     defended against an id outside `tags` (`settledPrimary`).
 *  3. **Next frame** — the list's SSE row is authoritative over both. The local
 *     draft is dropped when the row's own tags change, so the sheet and the row
 *     cannot disagree once the relay has spoken.
 *
 * A refusal reverts the draft to the list's state and shows the relay's own
 * sentence (`RelayError.displayableMessage`, i.e. the `error` body) behind the
 * plain outcome first: "That didn't save." The phone never re-words a store's
 * refusal: "Unknown category id" tells the reader the category vanished, and a
 * paraphrase would not.
 *
 * A SECOND TOGGLE WHILE ONE WRITE IS UNANSWERED IS NOT DROPPED. The queue
 * (`tag-write-queue.ts`) holds one request in flight and coalesces further
 * presses to the newest desired state; each checkbox stays live. The old rule
 * disabled every row instead, and a press in that window silently did nothing —
 * review round 1, U2.
 *
 * EVERY REQUEST IS BOUND TO ITS SUBJECT. The sheet is one mounted instance and
 * outlives `visible=false`, so a queued write cannot resolve its conversation
 * from the current render: a close or a new row would send it to an empty id or
 * onto another conversation. The request carries its `sessionId`, a close or
 * subject change cancels what is queued, and an old answer may only paint while
 * the sheet is still showing that subject (review round 2, R2-1). The same
 * guard keeps an older read-back from repainting over a newer press (R2-2).
 *
 * No category creation or rename exists here — the desktop owns the registry
 * (`GET /api/tags` is read-only on this wire, and the route set has no PUT for
 * categories). An empty catalogue therefore says so honestly instead of
 * offering a control that cannot work.
 */
export type SessionTagsSheetProps = {
	visible: boolean;
	/** The local conversation whose tags are being edited. */
	sessionId: string;
	/** The row's tags/primary, straight from the list frame. */
	tags: readonly TagRef[];
	primary: string | null;
	onClose: () => void;
};

type Catalogue =
	| { kind: "loading" }
	| { kind: "ready"; tags: TagCatalogueEntry[] }
	| { kind: "error" };

type Draft = { tags: TagRef[]; primary: string | null };

/** The draft's tag objects, preserving what only the list row knows (an
 *  assigned tag can be absent from a stale catalogue read) and taking names
 *  from the catalogue for newly selected ids. */
const draftTags = (
	desiredIds: readonly string[],
	current: readonly TagRef[],
	catalogue: readonly TagCatalogueEntry[],
): TagRef[] =>
	desiredIds.map((id) => {
		const assigned = current.find((tag) => tag.id === id);
		if (assigned !== undefined) return assigned;
		const entry = catalogue.find((tag) => tag.id === id);
		return entry === undefined
			? { id, name: id }
			: { id: entry.id, name: entry.name };
	});

export const SessionTagsSheet = ({
	visible,
	sessionId,
	tags,
	primary,
	onClose,
}: SessionTagsSheetProps) => {
	const { relay } = useConnection();
	/* The catalogue is a GLOBAL read, so its reload is keyed on the connection's
	 *  own identity rather than on the `relay` function's. `relay` is rebuilt by
	 *  the provider on incidental renders, and an effect that re-ran on every
	 *  identity change could clear an in-flight write's guard mid-press — the
	 *  review's I. A route/status change is the event that actually means "a new
	 *  relay, re-read its catalogue". */
	const connectionIdentity = useConnectionState(
		(state) => `${state.phase}:${state.revision}`,
	);
	const relayRef = useRef(relay);
	relayRef.current = relay;
	const [catalogue, setCatalogue] = useState<Catalogue>({ kind: "loading" });
	const [reloadKey, setReloadKey] = useState(0);
	const [draft, setDraftState] = useState<Draft | null>(null);
	/* The draft as of the latest press, without waiting for the state's render:
	 *  two presses in one event batch must each derive from the other's result. */
	const draftRef = useRef<Draft | null>(null);
	const setDraft = useCallback((next: Draft | null) => {
		draftRef.current = next;
		setDraftState(next);
	}, []);
	/** The tag id whose write is in flight, or `"*"` for Remove all. */
	const [pending, setPending] = useState<string | null>(null);
	/** Remove all is pressed but its write is still waiting behind another one. */
	const [removeAllQueued, setRemoveAllQueued] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
	/** A read-back has been painted; the toggled capture cell's marker. */
	const [readBack, setReadBack] = useState(false);
	const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
	const onAccent = useTokenColor("on-accent");

	/* The list's own signature. A change here is a newer frame — authoritative
	 *  over the local draft — and the frame after our own write is what retires
	 *  the read-back we painted in between. The sequence is what lets a read-back
	 *  refuse to overwrite a frame that landed while it was in flight (J): the
	 *  write records the sequence it started at, and only paints if the list has
	 *  not moved since. */
	const listKey = `${tags.map((tag) => tag.id).join(",")}|${primary ?? ""}`;
	const lastListKey = useRef(listKey);
	const frameSeq = useRef(0);
	useEffect(() => {
		if (lastListKey.current !== listKey) {
			lastListKey.current = listKey;
			frameSeq.current += 1;
			setDraft(null);
			setReadBack(false);
		}
	}, [listKey, setDraft]);

	/* The sequence each request started at, keyed by the request object. A
	 *  WeakMap is enough — the queue holds the only reference. */
	const startedAt = useRef(new WeakMap<TagWriteRequest, number>());

	/* The subject the sheet is painting RIGHT NOW. A request carries the subject
	 *  it was pressed for; its answer may only paint while both still agree. A
	 *  ref, not the render's `sessionId`, because an old queue's callback closes
	 *  over the value from the render that built it — after a subject change it
	 *  must see the CURRENT subject and stand down (review round 2, R2-1). */
	const subjectRef = useRef(sessionId);
	subjectRef.current = sessionId;

	/* Set once the queue exists, so stable handlers can ask whether a newer
	 *  press is waiting without being re-created with the queue itself. */
	const queueRef = useRef<TagWriteQueue | null>(null);

	const handleSettled = useCallback(
		(request: TagWriteRequest, answer: SessionTagsResponse) => {
			/* An answer for another conversation, or for a state a newer press has
			 *  already replaced, must not repaint this sheet (R2-1, R2-2). */
			if (request.sessionId !== subjectRef.current) return;
			if (queueRef.current?.hasQueued() ?? false) return;
			if (!draftMatchesDesired(draftRef.current, request.desired)) return;
			/* Do not repaint a read-back over a NEWER list frame either: that frame
			 *  is the relay's later answer and the next word on this assignment. */
			if (startedAt.current.get(request) === frameSeq.current) {
				setDraft({
					tags: answer.tags,
					primary: settledPrimary(answer.tags, answer.primary),
				});
				setReadBack(true);
			}
		},
		[setDraft],
	);

	const handleRefused = useCallback(
		(request: TagWriteRequest, error: unknown) => {
			/* Same two guards as the read-back: another subject's refusal is not
			 *  this sheet's, and a newer press owns the draft — reverting it here
			 *  would undo a change the reader made after this request (R2-2). */
			if (request.sessionId !== subjectRef.current) return;
			if (queueRef.current?.hasQueued() ?? false) return;
			if (!draftMatchesDesired(draftRef.current, request.desired)) return;
			/* Revert to the list row's state — the frame that was there before the
			 *  press — and put the store's own sentence after the plain outcome. */
			setDraft(null);
			setReadBack(false);
			setRefusal(
				`That didn't save. ${
					isRelayError(error) ? error.displayableMessage : TRANSPORT_SENTENCE
				}`,
			);
		},
		[setDraft],
	);

	/* One queue for this sheet's life. The send is read through a ref so the
	 *  queue keeps its in-flight state when the provider hands over a new
	 *  `relay` function. */
	const sendRef = useRef<
		(request: TagWriteRequest) => Promise<SessionTagsResponse>
	>(async () => {
		throw new Error("the tags sheet has no transport");
	});
	sendRef.current = async (request: TagWriteRequest) => {
		const client = relayRef.current();
		if (client === null) throw new Error(TRANSPORT_SENTENCE);
		return client.setSessionTags(
			request.sessionId,
			request.desired.tags,
			request.desired.primary,
		);
	};

	const queue = useMemo(
		() =>
			new TagWriteQueue({
				send: (request) => sendRef.current(request),
				onStart: (request) => {
					startedAt.current.set(request, frameSeq.current);
					/* A request is now on the wire; Remove all's wait is over (its
					 *  own start paints `pending === "*"` instead). */
					setRemoveAllQueued(false);
					setPending(request.key);
					setRefusal(null);
				},
				onSettled: handleSettled,
				onRefused: handleRefused,
				onIdle: () => {
					setPending(null);
					setRemoveAllQueued(false);
				},
			}),
		[handleSettled, handleRefused],
	);
	queueRef.current = queue;

	/* Opening resets everything the previous conversation left behind, and a
	 *  close or subject change CANCELS whatever is still queued: a request is
	 *  scoped to the conversation it was pressed for, so it must never start
	 *  after the sheet has moved to the next one (review round 2, R2-1). */
	useEffect(() => {
		/* `sessionId` and `visible` are TRIGGERS, not values this body reads:
		 *  the effect must re-run when the subject changes or the sheet closes,
		 *  and the lint needs the references to see they belong in the list. */
		void sessionId;
		void visible;
		queue.reset();
		setDraft(null);
		setPending(null);
		setRemoveAllQueued(false);
		setRefusal(null);
		setReadBack(false);
		setConfirmRemoveAll(false);
	}, [queue, sessionId, visible, setDraft]);

	/* The catalogue read, per open. It is re-read because the desktop may have
	 *  created or renamed a category since, and a stale list is a control that
	 *  fails with "Unknown category id" for no reason the reader can see. */
	useEffect(() => {
		/* `reloadKey` is a TRIGGER, not a value this body reads: the retry control
		 *  bumps it so the effect re-runs, and the lint needs the reference to see
		 *  that it belongs in the dependency list. */
		void reloadKey;
		/* Same shape for the connection identity: it is a TRIGGER (a new route or
		 *  a phase change re-reads the catalogue), not a value this body reads. */
		void connectionIdentity;
		if (!visible) return;
		const client = relayRef.current();
		setDraft(null);
		setPending(null);
		setRefusal(null);
		setReadBack(false);
		setConfirmRemoveAll(false);
		if (client === null) {
			setCatalogue({ kind: "error" });
			return;
		}
		let cancelled = false;
		setCatalogue({ kind: "loading" });
		client
			.tags()
			.then((answer) => {
				if (!cancelled) setCatalogue({ kind: "ready", tags: answer.tags });
			})
			.catch(() => {
				if (!cancelled) setCatalogue({ kind: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [visible, reloadKey, connectionIdentity, setDraft]);

	const current: Draft = draft ?? { tags: [...tags], primary };
	/* The catalogue the checkboxes actually offer. The row's own tags are merged
	 *  in because the registry read can be stale or omit a category the desktop
	 *  has since deleted: an assigned tag that is not on this list could not be
	 *  unchecked individually (K). */
	const options = useMemo(
		() =>
			catalogue.kind === "ready"
				? catalogueWithAssigned(catalogue.tags, current.tags)
				: [],
		[catalogue, current.tags],
	);

	const toggle = (tag: TagCatalogueEntry) => {
		const base = draftRef.current ?? { tags: [...tags], primary };
		const desired = desiredTagWrite(base.tags, base.primary, tag.id);
		setDraft({
			tags: draftTags(desired.tags, base.tags, options),
			primary: desired.primary,
		});
		queue.push({ sessionId, desired, key: tag.id });
	};

	const removeAll = () => {
		const desired = clearedTags();
		setDraft({ tags: [], primary: null });
		setRemoveAllQueued(true);
		queue.push({ sessionId, desired, key: "*" });
	};

	const nothingSelected = current.tags.length === 0;
	/* An EMPTY REGISTRY is its own state: the sheet renders the explanatory empty
	 *  state instead of a catalogue, and Remove all is the sheet's only
	 *  sheet-level answer, so it belongs in the pinned footer (see `footer`).
	 *  The test is the RAW catalogue, not `options.length`: `catalogueWithAssigned`
	 *  merges the row's own assignment into `options`, so an empty registry on a
	 *  tagged row still offers one checkbox (the captured `tags-empty-catalogue`
	 *  state), and keying on `options` would leave exactly that frame unfixed.
	 *  A disabled render is skipped rather than pinned — a row with nothing to
	 *  clear has no action, and a grey control would claim otherwise. The
	 *  in-flight write keeps it mounted after the optimistic draft empties:
	 *  unmounting it there would also unmount the `Saving…` cue. */
	const emptyCatalogue =
		catalogue.kind === "ready" && catalogue.tags.length === 0;
	const removeAllPinned =
		emptyCatalogue && (!nothingSelected || pending === "*" || removeAllQueued);
	/* One destructive action, rendered in ONE place per state: pinned in the
	 *  footer for an empty registry, above the alert when the catalogue failed
	 *  (the sheet's remaining answer, and a control the 200 % frame must show
	 *  without scrolling), and after the catalogue otherwise. */
	const removeAllAction = (
		<View className="gap-1">
			<Button
				testID={CONTROL.sessionTagsRemoveAll}
				label="Remove all tags"
				onPress={() => setConfirmRemoveAll(true)}
				disabled={nothingSelected}
				variant="danger"
				size="sm"
			/>
			{/* U2's visible saving state covers this control too: `key: "*"` paints
			 *  no row, so without this cue the sheet showed nothing between the
			 *  confirm and the answer. It stays up while the write waits behind an
			 *  older one, then `pending === "*"` takes over on the wire. */}
			{pending === "*" || removeAllQueued ? (
				<Text className="text-meta text-ink-dim">Saving…</Text>
			) : null}
		</View>
	);

	return (
		<>
			<Sheet
				visible={visible}
				onClose={onClose}
				title="Tags"
				testID={SURFACE.sessionTagsSheet}
				/* The answering control is PINNED per state. The error state's
				 *  "Try again" used to sit at the end of the scrolling body and fell
				 *  below the fold at 200 % on both a 320 pt phone and the 390 pt one
				 *  (review round 1, D1). A READY catalogue with options has no footer
				 *  action — the checkboxes are the answer, and Remove all stays a
				 *  destructive body action rather than the strongest slot. An EMPTY
				 *  registry renders the explanation instead of a catalogue (at most
				 *  the row's own merged assignment), so Remove all is its sheet-level
				 *  answer and is pinned: in the body it followed the empty state, and
				 *  the 200 % SE frame cut the sentence and pushed it under the fold
				 *  (round 3). */
				footer={
					catalogue.kind === "error" ? (
						<Button
							testID={CONTROL.sessionTagsRetry}
							label="Try again"
							onPress={() => setReloadKey((key) => key + 1)}
							variant="outline"
						/>
					) : removeAllPinned ? (
						removeAllAction
					) : undefined
				}
			>
				{/* The body's own bottom gutter is for the NO-FOOTER case. With a pinned
				 *  footer the Sheet already spends 16 pt there, and the extra 24 made
				 *  the content overflow the body by a hair in the empty registry — the
				 *  cut-edge fade then painted over the last line of the explanation at
				 *  200 % on a 320 pt phone (round 3). The error state has a footer too,
				 *  so it takes the same branch; nothing moves, the cue just stops
				 *  claiming there is more below. */}
				<View
					className={cx(
						"gap-3",
						catalogue.kind === "error" || emptyCatalogue ? "" : "pb-6",
					)}
				>
					{refusal !== null ? (
						<Text
							className="text-body-sm text-danger"
							testID={SURFACE.sessionTagsRefusal}
						>
							{refusal}
						</Text>
					) : null}
					{readBack ? (
						<View className="h-0 w-0" testID={SURFACE.sessionTagsReadBack} />
					) : null}

					{/* Above the ALERT, not below it: when the catalogue failed this is
					 *  the sheet's remaining answer and must not be the control the
					 *  200 % frame pushes under the fold. The EMPTY state keeps the
					 *  action last — its sentence is the information there, and the
					 *  compact empty state is sized so the sentence is visible without
					 *  scrolling. */}
					{catalogue.kind === "error" ? removeAllAction : null}

					{catalogue.kind === "loading" ? (
						<View className="gap-3 py-2" testID={SURFACE.sessionTagsLoading}>
							<Skeleton lines={1} />
							<Skeleton lines={1} />
							<Skeleton lines={1} />
						</View>
					) : catalogue.kind === "error" ? (
						<View className="gap-3" testID={SURFACE.sessionTagsError}>
							<Alert severity="error" title="Your categories didn't load">
								We couldn't read the list of categories just now. Try again in a
								moment.
							</Alert>
						</View>
					) : options.length === 0 ? (
						<EmptyState
							headline="No categories yet."
							/* The pinned footer IS the second line's action here, so the
							 *  copy names only where categories come from: the old sentence
							 *  repeated the button and was the line the 200 % SE frame cut
							 *  (round 3). Nothing to clear has no button below, and the
							 *  shorter copy is still the whole truth. */
							next="Created on desktop."
							/* The sheet at 200 % is ~300 pt tall; the mark is decorative and
							 *  the full-surface centring pushes the sentence under the fold, so
							 *  the sheet takes the inline form. */
							mark={false}
							compact
							testID={SURFACE.sessionTagsEmpty}
						/>
					) : (
						<>
							{/* Assigned-but-uncatalogued tags are exactly why this branch
							 *  cannot key on the raw catalogue length: `catalogueWithAssigned`
							 *  appends them, and hiding the list behind an empty registry
							 *  would leave an assignment with no way to clear it one tag at a
							 *  time (K). The sentence still explains why the registry is
							 *  empty, above a list it can no longer short-circuit. */}
							{catalogue.tags.length === 0 ? (
								<EmptyState
									headline="No categories yet."
									/* Same short line as the other empty-registry branch: the pinned
									 *  footer names the action, and the longer sentence was the copy
									 *  the 200 % SE body could not show in full (round 3). */
									next="Created on desktop."
									mark={false}
									compact
									testID={SURFACE.sessionTagsEmpty}
								/>
							) : null}
							{/* Relay registry order, never re-sorted: `order` is the store's own
							 *  and the desktop shows the same list. Assigned-but-uncatalogued
							 *  tags are appended by `catalogueWithAssigned`. */}
							{options.map((tag) => {
								const checked = current.tags.some(
									(selected) => selected.id === tag.id,
								);
								const rowBusy = pending === tag.id;
								return (
									<Pressable
										key={tag.id}
										accessibilityRole={ROLE.checkbox}
										/* The name AND the state, in words: a checkbox's `checked`
										 *  state is announced by the platform, but the label is what the
										 *  reader hears first, and "Work" alone does not say whether
										 *  pressing it selects or clears. */
										accessibilityLabel={`${tag.name}, ${checked ? "checked" : "unchecked"}`}
										accessibilityState={{ checked }}
										/* react-native-web does not read `accessibilityState`: the AX tree
										 *  reported this option `checked: false` after a press until the
										 *  ARIA state was written beside it (review round 1, Q1). The
										 *  segmented control carries the same pair for role=radio
										 *  (`segmented.tsx`); native ignores `aria-checked` in favour of
										 *  the state, so both are written, never chosen between. */
										aria-checked={checked}
										onPress={() => toggle(tag)}
										testID={sessionTagOptionId(tag.id)}
									>
										<View
											className="flex-row items-center gap-3 border-b border-hairline py-2"
											style={{ minHeight: TOUCH_FLOOR }}
										>
											<View
												className={cx(
													"h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
													checked
														? "border-accent bg-accent"
														: "border-control bg-surface",
												)}
											>
												{/* A FIXED-SIZE icon, not a ✓ glyph: the glyph is a text run
												 *  and rode the 200 % text scale out of its 16 dp box, crossing
												 *  the border (review round 1, D2). The SVG's own size does not
												 *  scale with type, so the mark stays inside the box at every
												 *  setting while keeping the checked contrast. */}
												{checked ? (
													<Check
														size={12}
														strokeWidth={3}
														color={onAccent}
														aria-hidden
													/>
												) : null}
											</View>
											<Text
												className="min-w-0 flex-1 text-body text-ink"
												numberOfLines={1}
											>
												{tag.name}
											</Text>
											{rowBusy ? (
												<Text className="text-meta text-ink-dim">Saving…</Text>
											) : null}
										</View>
									</Pressable>
								);
							})}
							{/* The registry's count is the desktop's number of EXISTING
							 *  conversations holding the category, not this page's row count;
							 *  it is not repeated here because a phone page is partial and the
							 *  two numbers would invite a false comparison. */}
						</>
					)}

					{/* Remove all is a DESTRUCTIVE body action, at the end of the catalogue
					 *  and never the footer's strongest slot (review round 1, D3/D2). It is
					 *  behind a confirm because clearing an assignment is not undoable from
					 *  this phone; and it is offered even when the catalogue read failed, so
					 *  a row that HAS tags can still be cleared while the registry is down.
					 *  Not while the catalogue is loading: the control would appear and
					 *  move under the thumb as the read settles. */}
					{catalogue.kind === "ready" && !emptyCatalogue
						? removeAllAction
						: null}
				</View>
			</Sheet>
			<Dialog
				visible={confirmRemoveAll}
				testID={CONTROL.sessionTagsRemoveAllDialog}
				title="Remove all tags?"
				body="This clears every category from this conversation. The categories themselves stay in the desktop app."
				confirmLabel="Remove"
				destructive
				onConfirm={() => {
					setConfirmRemoveAll(false);
					removeAll();
				}}
				onCancel={() => setConfirmRemoveAll(false)}
			/>
		</>
	);
};
