/**
 * Browse and search a community's channels and people (RFC v2.4 §5.4; frame
 * M5).
 *
 * The server pages 25 at a time and applies its own `directory` rate window;
 * the search waits for typing to pause (`SEARCH_DEBOUNCE_MS`) so a word typed
 * letter by letter is one read, not five. People results carry only each
 * member's approved profile fields (the server's projection), and a row opens
 * the same profile sheet as an author tap in a conversation.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { Hash, Lock } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { CommunityError } from "@/community/client";
import type { Channel, Profile } from "@/community/contract";
import { useCommunity } from "@/community/provider";
import { t } from "@/i18n";
import {
	CONTROL,
	communityChannelRowId,
	communityPersonId,
	SCREEN,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Segmented } from "@/ui/components/segmented";
import { Skeleton } from "@/ui/components/skeleton";
import { communityPath } from "./home-screen";
import { roleLabel } from "./labels";
import { MemberAvatar } from "./member-avatar";
import { CommunityFrame, CommunityRow, LoadFailure } from "./parts";
import { ProfileSheet } from "./profile-sheet";

/**
 * Typing pause before a search read. 300 ms is the usual type-ahead pause; it
 * is a UX choice bounded by the server's `directory` window, not a measured
 * distribution.
 */
const SEARCH_DEBOUNCE_MS = 300;

type Mode = "channels" | "people";

export default function CommunityBrowseScreen() {
	const { communityId = "" } = useLocalSearchParams<{ communityId: string }>();
	return (
		<CommunityFrame
			title={t("mobile.community.browse.title")}
			fallback={communityPath(communityId)}
			testID={SCREEN.communityBrowse}
		>
			<Browse communityId={communityId} />
		</CommunityFrame>
	);
}

function Browse({ communityId }: { communityId: string }) {
	const router = useRouter();
	const { store, actions } = useCommunity();
	const [mode, setMode] = useState<Mode>("channels");
	const [query, setQuery] = useState("");
	/* Tagged, so a row never has to guess whether it holds a channel or a person. */
	const [items, setItems] = useState<
		(
			| { kind: "channel"; channel: Channel }
			| { kind: "person"; person: Profile }
		)[]
	>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState<CommunityError | null>(null);
	const [profile, setProfile] = useState<Profile | null>(null);
	const ink = useTokenColor("ink-dim");
	const generation = useRef(0);
	const read = useCallback(
		async (after: string | null) => {
			const mine = ++generation.current;
			setState("loading");
			setError(null);
			try {
				const page = await actions.directory(communityId, mode, query, after);
				if (mine !== generation.current) return;
				const rows =
					page.kind === "channels"
						? page.items.map((channel) => ({
								kind: "channel" as const,
								channel,
							}))
						: page.items.map((person) => ({ kind: "person" as const, person }));
				setItems((held) => (after ? [...held, ...rows] : rows));
				setCursor(page.next_cursor);
				setState("ready");
			} catch (failure) {
				if (mine !== generation.current) return;
				setError(failure as CommunityError);
				setState("error");
			}
		},
		[actions, communityId, mode, query],
	);
	useEffect(() => {
		const timer = setTimeout(() => void read(null), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [read]);
	const joined = (id: string) =>
		store.getState().channels[communityId]?.data.some((c) => c.id === id) ??
		false;
	/* Opening a channel never joins it (review round 1, R1-6): the server lets a
	 * member read every public channel without a seat, and a join changes the
	 * channel's member list — browsing must leave no trace. The conversation
	 * offers an explicit Join in place of the composer. */
	const openChannel = (channel: Channel) => {
		if (!channel.member && !joined(channel.id))
			actions.previewChannel(communityId, channel);
		router.push(communityPath(communityId, "c", channel.id) as never);
	};
	return (
		<View className="gap-2 pb-6 pt-2">
			<View className="gap-2 px-4">
				<Input
					label={t("mobile.community.browse.search")}
					value={query}
					onChangeText={setQuery}
					maxLength={100}
					testID={CONTROL.communitySearch}
				/>
				<Segmented<Mode>
					label={t("mobile.community.browse.mode")}
					options={[
						{
							value: "channels",
							label: t("mobile.community.browse.channels"),
							testID: CONTROL.communityBrowseChannels,
						},
						{
							value: "people",
							label: t("mobile.community.browse.people"),
							testID: CONTROL.communityBrowsePeople,
						},
					]}
					value={mode}
					onChange={(value) => {
						setItems([]);
						setMode(value);
					}}
					testID={CONTROL.communityBrowseMode}
				/>
			</View>
			{state === "error" && !items.length ? (
				<LoadFailure error={error} onRetry={() => void read(null)} />
			) : state === "loading" && !items.length ? (
				<View className="px-4 py-2">
					<Skeleton lines={4} />
				</View>
			) : !items.length ? (
				<Text className="px-4 py-2 text-body-sm text-ink-dim">
					{mode === "channels"
						? t("mobile.community.browse.channels_empty")
						: t("mobile.community.browse.people_empty")}
				</Text>
			) : (
				items.map((row) =>
					row.kind === "person" ? (
						<CommunityRow
							key={row.person.public_id}
							label={row.person.display_name}
							detail={
								[roleLabel(row.person.role), row.person.title]
									.filter(Boolean)
									.join(" · ") || null
							}
							leading={
								<MemberAvatar name={row.person.display_name} size="sm" />
							}
							onPress={() => setProfile(row.person)}
							testID={communityPersonId(row.person.public_id)}
						/>
					) : (
						<CommunityRow
							key={row.channel.id}
							label={row.channel.name}
							detail={row.channel.purpose ?? null}
							leading={
								row.channel.visibility === "private" ? (
									<Lock size={18} color={ink} />
								) : (
									<Hash size={18} color={ink} />
								)
							}
							trailing={
								<Text className="text-meta font-semibold text-accent">
									{t("mobile.community.browse.open")}
								</Text>
							}
							onPress={() => openChannel(row.channel)}
							testID={communityChannelRowId(row.channel.id)}
						/>
					),
				)
			)}
			{cursor && items.length ? (
				<View className="self-center pt-2">
					<Button
						label={t("mobile.community.browse.load_more")}
						variant="outline"
						size="sm"
						loading={state === "loading"}
						onPress={() => void read(cursor)}
						testID={CONTROL.communityLoadOlder}
					/>
				</View>
			) : null}
			<ProfileSheet
				communityId={communityId}
				profile={profile}
				onClose={() => setProfile(null)}
			/>
		</View>
	);
}
