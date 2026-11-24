import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	Pressable,
	RefreshControl,
	Text,
	type TextInput,
	View,
} from "react-native";

import type { PastSession } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import { SessionTagLine } from "@/features/sessions/tag-line";
import { tagAnnouncement } from "@/features/sessions/tags";
import { t } from "@/i18n";
import {
	CONTROL,
	EMPTY,
	pastRowId,
	pastTagLineId,
	REGION,
	ROLE,
	SCREEN,
} from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { BackButton } from "@/ui/components/back-button";
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

	/** The search field's own height, read after layout so the Search button
	 *  beside it can match it at any text size (the label above the field is
	 *  in the same column, so the row's height is not the field's). */
	const searchFieldRef = useRef<TextInput | null>(null);
	const [searchFieldHeight, setSearchFieldHeight] = useState<number | null>(
		null,
	);
	const measureSearchField = () =>
		searchFieldRef.current?.measure((_x, _y, _width, height) => {
			if (height > 0) setSearchFieldHeight(height);
		});

	return (
		<Screen
			title="Past sessions"
			testID={SCREEN.past}
			headerLeading={
				<BackButton testID={CONTROL.pastBack} onPress={() => router.back()} />
			}
		>
			<View className="gap-3 pt-2">
				<View className="flex-row items-end gap-2">
					<View className="flex-1" onLayout={measureSearchField}>
						<Input
							testID={CONTROL.pastSearchField}
							fieldRef={searchFieldRef}
							/* The field shares its row with the "Search" button, so this label's box is
							 *  the field's column and NOT the pane: 150 pt at 320 pt. At 200 % text
							 *  "conversations" is 173 pt in that box, so the old label ("Search past
							 *  conversations") broke mid-word across three lines ("Search past /
							 *  conversatio / ns") and cost the chrome 40.59 pt the list did not have — the
							 *  Past list's first row ended 20.16 pt below a 568 pt viewport (design round 4,
							 *  D24; measured 470.56 → 588.16 before, 429.97 → 547.56 after). This copy breaks at the SPACE instead, in two lines, at both sizes,
							 *  and it mirrors the sessions screen's own field ("Search sessions"); it is
							 *  also the field's accessible name.
							 *
							 *  NO PLACEHOLDER (review round 1, operator ruling): the label already
							 *  says what the field is for, the old "Words or title" hint repeated it
							 *  in a box too narrow to paint it whole at 200 % ("Words or"), and the
							 *  no-match state says what the search covers. A placeholder never stands
							 *  in for this label (docs/design/components.md § 4, § 23). */
							label={t("mobile.past.search_label")}
							value={query}
							onChangeText={setQuery}
							returnKeyType="search"
							onSubmitEditing={() => void onSearch()}
						/>
					</View>
					{/* As tall as the FIELD at every text size (design round 1, D2): the
					 *  field grows with the reader's type (48 pt at 100 %, 66 pt at 200 %)
					 *  and a `md` button does not, so the container takes the field's
					 *  measured height and the button fills it. Until the first
					 *  measurement the button keeps its own height. */}
					<View
						style={
							searchFieldHeight === null
								? undefined
								: { height: searchFieldHeight }
						}
					>
						<Button
							testID={CONTROL.pastSearch}
							label={t("relay.chrome.list.search_open")}
							onPress={() => void onSearch()}
							loading={searching}
							variant="outline"
							fill
						/>
					</View>
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
							label={t("mobile.common.try_again")}
							onPress={() => void load(query)}
							testID={CONTROL.pastRetry}
						/>
					</View>
				</View>
			) : items.length === 0 ? (
				<EmptyState
					headline={
						query.trim()
							? t("mobile.common.no_matches")
							: t("mobile.past.empty_headline")
					}
					next={
						query.trim()
							? t("mobile.past.no_matches_next")
							: t("mobile.past.empty_next")
					}
					action={{
						testID: CONTROL.pastSearchClear,
						label: query.trim()
							? t("mobile.chrome.clear_search")
							: t("mobile.common.not_found.action"),
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
							accessibilityLabel={`${item.name || "untitled"}${item.forked ? ", a copy" : ""}${
								(item.tags?.length ?? 0) > 0
									? `, ${tagAnnouncement(item.tags ?? [])}`
									: ""
							}`}
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
									{/* Read-only: past rows carry the same `tags`/`primary` pair as a
									 *  live row (the schema defaults an older relay to `[]`), and this
									 *  screen has no assignment action — resuming is its only verb. */}
									<SessionTagLine
										tags={item.tags ?? []}
										testID={pastTagLineId(item.id)}
										/* The pressable row announces the tags; a second
										 *  accessible node here would say them twice. */
										announce={false}
									/>
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
	if (seconds < 60) return t("mobile.time.relative.just_now");
	const minutes = Math.round(seconds / 60);
	if (minutes < 60)
		return t("mobile.time.relative.minutes_ago", { count: minutes });
	const hours = Math.round(minutes / 60);
	if (hours < 24) return t("mobile.time.relative.hours_ago", { count: hours });
	return t("mobile.time.relative.days_ago", { count: Math.round(hours / 24) });
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
