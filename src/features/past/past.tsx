import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import type { PastSession } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import { CONTROL, EMPTY, pastRowId, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/empty-state";
import { Input } from "@/ui/components/input";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Skeleton } from "@/ui/components/skeleton";

/**
 * Past sessions, and resuming one (docs/ux/flows.md § 8, F-8).
 *
 * Three facts about this list shape it:
 *
 *  1. **Search is the server's, and it can match the conversation's BODY.** A
 *     result whose title does not contain the query is a legitimate match, not a
 *     bug, so it is marked (`search-result-body-match-marker`) rather than left
 *     looking like a bad result.
 *  2. **Resume does not restore the working directory.** The relay's own route
 *     does not (`daemon.py`: the runtime starts at the account home), so the
 *     screen must not promise otherwise — it says the folder comes from the home
 *     directory.
 *  3. **A refusal is recoverable and never leaks an id.** `docs/ux/flows.md` § 8
 *     is explicit, citing PR #1784's U26: "This session is no longer saved." is
 *     the sentence, and no session id appears anywhere on this screen.
 */
export default function PastSessions() {
	const router = useRouter();
	const { relay } = useConnection();

	const [rows, setRows] = useState<PastSession[]>([]);
	const [degraded, setDegraded] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** The row currently being resumed, so its own button can say `opening…`
	 *  instead of the whole screen going busy — the reader keeps their place. */
	const [opening, setOpening] = useState<string | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);

	const load = useCallback(
		async (search: string) => {
			const client = relay();
			if (!client) {
				setLoading(false);
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const result = search.trim()
					? await client.searchSessions({ query: search.trim() })
					: await client.pastSessions();
				setRows(result.sessions);
				setDegraded(result.degraded);
			} catch {
				/* Never the status code: what a reader can act on is that the list
				 * could not be read, and that retrying is the move. */
				setError("We couldn't read your past sessions just now.");
			} finally {
				setLoading(false);
			}
		},
		[relay],
	);

	useEffect(() => {
		void load("");
	}, [load]);

	/** Search runs on submit rather than per keystroke: this is a server round
	 *  trip over a tunnel, and a request per character is a request per character
	 *  on the reader's phone bill. */
	const onSearch = async () => {
		setSearching(true);
		try {
			await load(query);
		} finally {
			setSearching(false);
		}
	};

	const resume = async (session: PastSession) => {
		const client = relay();
		if (!client) return;
		setOpening(session.id);
		setRefusal(null);
		try {
			await client.resumeSession(session.id);
			router.push(`/session/${session.id}`);
		} catch {
			setRefusal("This session is no longer saved.");
		} finally {
			setOpening(null);
		}
	};

	const items = useMemo(() => rows, [rows]);

	return (
		<Screen
			title="Past sessions"
			testID={SCREEN.past}
			headerLeading={
				<Button
					testID={CONTROL.pastBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<View className="gap-3 pt-2">
				<View className="flex-row items-end gap-2">
					<View className="flex-1">
						<Input
							testID={CONTROL.pastSearchField}
							/* The field shares its row with the "Search" button, so this label's box is
							 *  the field's column and NOT the pane: 150 pt at 320 pt. At 200 % text
							 *  "conversations" is 173 pt in that box, so the old label ("Search past
							 *  conversations") broke mid-word across three lines ("Search past /
							 *  conversatio / ns") and cost the chrome 40.59 pt the list did not have — the
							 *  Past list's first row ended 20.16 pt below a 568 pt viewport (design round 4,
							 *  D24; measured 470.56 → 588.16 before, 429.97 → 547.56 after). This copy breaks at the SPACE instead, in two lines, at both sizes,
							 *  and it mirrors the sessions screen's own field ("Search sessions"); it is
							 *  also the field's accessible name. */
							label="Search past sessions"
							value={query}
							onChangeText={setQuery}
							/* Short enough for the narrowest phone: the field shares its row with the
							 *  "Search" button, so at 320 pt with the button beside it the previous
							 *  copy ("What was said, or the title", 28 characters) painted as
							 *  "What was said, or the tit" — a placeholder that truncates
							 *  mid-word reads as a rendering fault rather than as a hint (QA F-2).
							 *  Fourteen characters is the same length as the sessions field's
							 *  "Name or folder", which the harness measured as fitting, and it keeps
							 *  both facts the search actually covers: words from the transcript AND
							 *  the title. */
							placeholder="Words or title"
							returnKeyType="search"
							onSubmitEditing={() => void onSearch()}
						/>
					</View>
					<Button
						testID={CONTROL.pastSearch}
						label="Search"
						onPress={() => void onSearch()}
						loading={searching}
						variant="outline"
					/>
				</View>

				{refusal ? (
					<Alert severity="warning" title="Could not resume">
						{refusal}
					</Alert>
				) : null}
				{degraded.length > 0 ? (
					<Alert severity="info">
						Some conversations could not be read just now, so this list may be
						missing rows.
					</Alert>
				) : null}
			</View>

			{loading ? (
				<View className="gap-3 py-3">
					<Skeleton lines={1} />
					<Skeleton lines={1} />
				</View>
			) : error ? (
				<View className="pt-4">
					<Alert severity="error" title="We couldn't load these">
						{error}
					</Alert>
					<View className="pt-3">
						<Button
							label="Try again"
							onPress={() => void load(query)}
							testID={CONTROL.pastRetry}
						/>
					</View>
				</View>
			) : items.length === 0 ? (
				<EmptyState
					headline={
						query.trim()
							? "Nothing matches that."
							: "No past conversations yet."
					}
					next={
						query.trim()
							? "Search covers what was said as well as the titles, so a shorter word may match."
							: "Conversations you have finished will be listed here, and you can pick one up again."
					}
					action={{
						testID: CONTROL.pastSearchClear,
						label: query.trim() ? "Clear the search" : "Back to sessions",
						onPress: () => {
							if (query.trim()) {
								setQuery("");
								void load("");
							} else {
								router.back();
							}
						},
					}}
					testID={EMPTY.past}
				/>
			) : (
				<FlatList
					data={items}
					keyExtractor={(item) => item.id}
					ListHeaderComponent={
						<SectionHeader
							/* Singular at one: "1 CONVERSATIONS" is the kind of detail that makes a
							 *  list look machine-written (design round 2, D15). `SectionHeader`
							 *  upper-cases the label, so the singular has to be correct HERE. */
							label={`${items.length} ${
								items.length === 1 ? "conversation" : "conversations"
							}`}
						/>
					}
					refreshControl={
						<RefreshControl
							refreshing={loading}
							onRefresh={() => void load(query)}
						/>
					}
					renderItem={({ item }) => (
						<Pressable
							accessibilityRole={ROLE.button}
							accessibilityLabel={`${item.name || "untitled"}${item.forked ? ", a copy" : ""}`}
							onPress={() => void resume(item)}
							testID={pastRowId(item.id)}
						>
							{({ pressed }) => (
								<View
									className={`gap-1 border-b border-hairline py-3 ${
										pressed ? "bg-row-hover" : ""
									}`}
								>
									<Text className="text-body-sm text-ink" numberOfLines={1}>
										{item.name.trim() || "untitled"}
									</Text>
									<View className="flex-row items-center gap-2">
										<Text
											className="flex-1 text-meta text-ink-dim"
											numberOfLines={1}
											ellipsizeMode="tail"
										>
											{relativeTime(item.mtime)}
											{" · "}
											{absoluteDate(item.mtime)}
											{item.forked ? " · a copy" : ""}
										</Text>
										{/* Body-only matches are marked: the title not containing
										 *  the query is a legitimate result, and an unmarked one
										 *  looks like a broken search. */}
										{item.body_match ? (
											<Text
												className="shrink-0 text-meta text-accent"
												testID={REGION.searchBodyMatch}
											>
												matched what was said
											</Text>
										) : null}
										<Button
											testID={CONTROL.pastBackToSessions}
											label={opening === item.id ? "opening…" : "Resume"}
											onPress={() => void resume(item)}
											loading={opening === item.id}
											size="sm"
											variant="outline"
										/>
									</View>
								</View>
							)}
						</Pressable>
					)}
				/>
			)}
		</Screen>
	);
}

/** A coarse age. "3 h ago" is the resolution a reader needs from a list; the
 *  exact minute is on the session itself. */
export function relativeTime(mtime: number): string {
	/* `mtime` is SECONDS (`fixtures/relay/http/past-with-rows.json` carries
	 *  1790727370 — 2026-09-29T00:16Z). Subtracting it from `Date.now()`'s
	 *  MILLISECONDS dated every row to 1970: the shipped fixture value rendered
	 *  "20706 d ago" where the honest reading is "21 h ago", and it also meant the
	 *  minute/hour rungs below could never be reached. */
	const seconds = Math.max(0, Math.round(Date.now() / 1000 - mtime));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return `${Math.round(hours / 24)} d ago`;
}

/**
 * The absolute date, beside the coarse age.
 *
 * The age says how recent; only a date says WHEN, and a list of past
 * conversations is exactly where a reader compares against their own calendar
 * ("the debugging session from the 29th"). One row carried the age alone, so
 * two entries three days apart were indistinguishable from two an hour apart on a
 * different day (design round 2, N3; still open in round 3).
 *
 * LOCAL time, not UTC, and a fixed day-month-year order rather than
 * `toLocaleDateString`: the reader's own calendar is the thing being compared
 * against, and a locale-dependent string would render differently on the two
 * machines that read this list.
 */
export function absoluteDate(mtime: number): string {
	const date = new Date(mtime * 1000);
	return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** Short month names, so the date is one line even at 200 % platform text. */
const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;
