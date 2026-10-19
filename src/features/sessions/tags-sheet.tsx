import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { TagCatalogueEntry, TagRef } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	clearedTags,
	desiredTagWrite,
	settledPrimary,
} from "@/features/sessions/tags";
import { isRelayError, TRANSPORT_SENTENCE } from "@/relay";
import { CONTROL, ROLE, SURFACE, sessionTagOptionId } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
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
 * sentence (`RelayError.displayableMessage`, i.e. the `error` body). The phone
 * never re-words a store's refusal: "Unknown category id" tells the reader the
 * category vanished, and a paraphrase would not.
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
	const [catalogue, setCatalogue] = useState<Catalogue>({ kind: "loading" });
	const [reloadKey, setReloadKey] = useState(0);
	const [draft, setDraft] = useState<Draft | null>(null);
	/** The tag id whose write is in flight, or `"*"` for Remove all. One write at
	 *  a time: a second toggle while one is unanswered would race two desired
	 *  states, and the loser's read-back would paint a stale assignment. */
	const [pending, setPending] = useState<string | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);

	/* The list's own signature. A change here is a newer frame — authoritative
	 *  over the local draft — and the frame after our own write is what retires
	 *  the read-back we painted in between. */
	const listKey = `${tags.map((tag) => tag.id).join(",")}|${primary ?? ""}`;
	const lastListKey = useRef(listKey);
	useEffect(() => {
		if (lastListKey.current !== listKey) {
			lastListKey.current = listKey;
			setDraft(null);
		}
	}, [listKey]);

	/* Opening resets everything the previous conversation left behind. The
	 *  catalogue is re-read per open: the desktop may have created or renamed a
	 *  category since, and a stale list of categories is a control that fails
	 *  with "Unknown category id" for no reason the reader can see. */
	useEffect(() => {
		/* `reloadKey` is a TRIGGER, not a value this body reads: the retry control
		 *  bumps it so the effect re-runs, and the lint needs the reference to see
		 *  that it belongs in the dependency list. */
		void reloadKey;
		if (!visible) return;
		const client = relay();
		setDraft(null);
		setPending(null);
		setRefusal(null);
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
	}, [visible, relay, reloadKey]);

	const current: Draft = draft ?? { tags: [...tags], primary };

	const write = useCallback(
		async (
			desiredTags: string[],
			desiredPrimary: string | null,
			key: string,
		) => {
			const client = relay();
			if (client === null) {
				setRefusal(TRANSPORT_SENTENCE);
				setDraft(null);
				return;
			}
			setPending(key);
			setRefusal(null);
			try {
				const answer = await client.setSessionTags(
					sessionId,
					desiredTags,
					desiredPrimary,
				);
				setDraft({
					tags: answer.tags,
					primary: settledPrimary(answer.tags, answer.primary),
				});
			} catch (error) {
				/* Revert to the list row's state — the frame that was there before
				 *  the press — and put the store's own sentence on screen. */
				setDraft(null);
				setRefusal(
					isRelayError(error) ? error.displayableMessage : TRANSPORT_SENTENCE,
				);
			} finally {
				setPending(null);
			}
		},
		[relay, sessionId],
	);

	const toggle = (tag: TagCatalogueEntry) => {
		if (pending !== null) return;
		const desired = desiredTagWrite(current.tags, current.primary, tag.id);
		const catalogueTags =
			catalogue.kind === "ready" ? catalogue.tags : ([] as TagCatalogueEntry[]);
		setDraft({
			tags: draftTags(desired.tags, current.tags, catalogueTags),
			primary: desired.primary,
		});
		void write(desired.tags, desired.primary, tag.id);
	};

	const removeAll = () => {
		if (pending !== null) return;
		const desired = clearedTags();
		setDraft({ tags: [], primary: null });
		void write(desired.tags, desired.primary, "*");
	};

	const busy = pending !== null;
	const nothingSelected = current.tags.length === 0;

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title="Tags"
			testID={SURFACE.sessionTagsSheet}
			footer={
				<Button
					testID={CONTROL.sessionTagsRemoveAll}
					label="Remove all tags"
					onPress={removeAll}
					disabled={busy || nothingSelected}
					variant="outline"
				/>
			}
		>
			<View className="gap-3 pb-2">
				{refusal !== null ? (
					<Text
						className="text-body-sm text-danger"
						testID={SURFACE.sessionTagsRefusal}
					>
						{refusal}
					</Text>
				) : null}

				{catalogue.kind === "loading" ? (
					<View className="gap-3 py-2" testID={SURFACE.sessionTagsLoading}>
						<Skeleton lines={1} />
						<Skeleton lines={1} />
						<Skeleton lines={1} />
					</View>
				) : catalogue.kind === "error" ? (
					<View className="gap-3" testID={SURFACE.sessionTagsError}>
						<Alert severity="error" title="We couldn't read your tags">
							The relay did not answer with the tag catalogue. Retrying is the
							only way to know whether the categories are still there.
						</Alert>
						<Button
							testID={CONTROL.sessionTagsRetry}
							label="Try again"
							onPress={() => setReloadKey((key) => key + 1)}
							variant="outline"
						/>
					</View>
				) : catalogue.tags.length === 0 ? (
					<EmptyState
						headline="No tags yet."
						next="Tags are created in the desktop app. Once a category exists, it appears here for every conversation."
						testID={SURFACE.sessionTagsEmpty}
					/>
				) : (
					<>
						{/* Relay registry order, never re-sorted: `order` is the store's own
						 *  and the desktop shows the same list. */}
						{catalogue.tags.map((tag) => {
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
									accessibilityState={{ checked, disabled: busy }}
									disabled={busy}
									onPress={() => toggle(tag)}
									testID={sessionTagOptionId(tag.id)}
								>
									<View
										className="flex-row items-center gap-3 border-b border-hairline py-2"
										style={{ minHeight: TOUCH_FLOOR }}
									>
										<View
											className={cx(
												"h-4 w-4 items-center justify-center rounded-sm border",
												checked
													? "border-accent bg-accent"
													: "border-control bg-surface",
											)}
										>
											{checked ? (
												<Text className="text-meta text-on-accent" aria-hidden>
													✓
												</Text>
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
			</View>
		</Sheet>
	);
};
