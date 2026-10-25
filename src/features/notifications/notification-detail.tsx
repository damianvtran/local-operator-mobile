import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { NotificationDetailResponse, PendingAsk } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	OPEN_LABEL,
	RETRY_LABEL,
	relativeTime,
	VANISHED_BODY,
	VANISHED_TITLE,
	waitingSummary,
} from "@/features/notifications/notifications-model";
import { refusalSentence } from "@/features/notifications/use-notifications";
import { isRelayMissing } from "@/relay";
import { CONTROL, ROLE, SCREEN, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Skeleton } from "@/ui/components/skeleton";

const READ_TIMEOUT_MS = 8_000;

type DetailState =
	| { kind: "loading" }
	| { kind: "ready"; detail: NotificationDetailResponse }
	| { kind: "vanished" }
	| { kind: "refused"; sentence: string }
	| { kind: "unreachable" };

/**
 * One notification's detail (design §10; contract §5.2/§5.4).
 *
 * WHY THE READ IS EXPLICIT. Opening this screen is the operator saying "I am
 * looking at this item", so the read is sent once the CONTENT has loaded — never
 * on the route mount. A mount that 404s, or that lands while the relay is
 * unreachable, has shown the reader nothing and must not clear anything (D8:
 * "route mount or push tap alone before content renders is not" a read).
 *
 * WHAT IT SHOWS. The anchor's excerpt (an item has no separate body), the source
 * conversation, the related projects, the item's revision history, and that
 * conversation's asks INCLUDING settled ones — the one place a settled ask
 * appears, since the reel shows open ones only.
 *
 * ANSWERING HAPPENS IN THE CONVERSATION. An ask's answer needs the question set,
 * the recommendation index and the secret handling that the session screen's own
 * card owns; a second form here would be a second way to answer, and the two
 * would disagree the first time either changed.
 */
export default function NotificationDetail({ itemId }: { itemId: string }) {
	const router = useRouter();
	const { relay } = useConnection();
	const client = relay();
	const [state, setState] = useState<DetailState>({ kind: "loading" });
	/** The newest load's ticket: a late answer to a superseded one is dropped. */
	const ticketRef = useRef(0);

	const back = useCallback(() => {
		/* Back goes to the inbox, not to whatever screen was open before a deep link
		 * landed here: the item is a place in the inbox, and a reader who arrived
		 * from a link still has an inbox to return to (design §10). */
		if (router.canGoBack()) router.back();
		else router.replace("/notifications");
	}, [router]);

	const load = useCallback(
		async (ticket: number) => {
			const live = client;
			if (live === null) {
				setState({ kind: "unreachable" });
				return;
			}
			setState({ kind: "loading" });
			void (async () => {
				try {
					const detail = await live.notification(
						itemId,
						AbortSignal.timeout(READ_TIMEOUT_MS),
					);
					if (ticket !== ticketRef.current) return;
					setState({ kind: "ready", detail });
					/* The explicit read, sent only now that content rendered. A failure
					 * leaves the item unread — the safe direction — and the next open
					 * retries it. */
					if (!detail.item.read) {
						void live
							.patchNotifications({
								op: "read",
								ids: [{ id: detail.item.id, revision: detail.item.revision }],
							})
							.catch(() => undefined);
					}
				} catch (error) {
					/* A late answer to a superseded load (a retry the reader pressed while
					 * the first was still in flight) must not overwrite the newer one. */
					if (ticket !== ticketRef.current) return;
					if (isRelayMissing(error)) {
						setState({ kind: "vanished" });
						return;
					}
					const sentence = refusalSentence(error);
					setState(
						sentence === null
							? { kind: "unreachable" }
							: { kind: "refused", sentence },
					);
				}
			})();
		},
		[client, itemId],
	);

	/** One load, with a fresh ticket. The retry control calls it directly rather
	 *  than bumping a counter: a counter would be a dependency the effect has to
	 *  declare and does not read, which is the shape a stale-closure bug hides in. */
	const reload = useCallback(() => {
		const ticket = ++ticketRef.current;
		void load(ticket);
	}, [load]);

	useEffect(() => {
		reload();
	}, [reload]);

	const openConversation = useCallback(
		(sessionId: string) => {
			router.push(`/session/${encodeURIComponent(sessionId)}`);
		},
		[router],
	);

	const body = (() => {
		if (state.kind === "loading") {
			return (
				<View className="gap-3 px-4 pt-4" testID={SURFACE.inboxDetailLoading}>
					<Skeleton lines={3} />
					<Skeleton lines={2} />
				</View>
			);
		}
		if (state.kind === "vanished") {
			return (
				<View testID={SURFACE.inboxDetailVanished}>
					<EmptyState headline={VANISHED_TITLE} next={VANISHED_BODY} compact />
				</View>
			);
		}
		if (state.kind === "refused") {
			return (
				<View className="gap-3 px-4 pt-4">
					<Alert severity="error">{state.sentence}</Alert>
					<Button
						label={RETRY_LABEL}
						onPress={reload}
						variant="outline"
						testID={CONTROL.inboxDetailRetry}
					/>
				</View>
			);
		}
		if (state.kind === "unreachable") {
			return (
				<View className="gap-3 px-4 pt-4">
					<Alert severity="error">Couldn't reach your computer.</Alert>
					<Button
						label={RETRY_LABEL}
						onPress={reload}
						variant="outline"
						testID={CONTROL.inboxDetailRetry}
					/>
				</View>
			);
		}
		return (
			<DetailBody
				detail={state.detail}
				onOpen={() => openConversation(state.detail.session.id)}
			/>
		);
	})();

	return (
		<Screen
			title="Notification"
			testID={SCREEN.notificationDetail}
			scroll={false}
			headerLeading={
				<IconButton
					accessibilityLabel="Back"
					onPress={back}
					icon={({ color, size }) => <ChevronLeft color={color} size={size} />}
					testID={CONTROL.inboxDetailBack}
				/>
			}
		>
			<ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
				{body}
			</ScrollView>
		</Screen>
	);
}

function DetailBody({
	detail,
	onOpen,
}: {
	detail: NotificationDetailResponse;
	onOpen: () => void;
}) {
	const { item, session, anchor, projects, asks, history } = detail;
	return (
		<View className="gap-4 px-4 pt-4">
			<View className="gap-1">
				<Text className="text-title text-ink" accessibilityRole={ROLE.header}>
					{item.title}
				</Text>
				<Text className="text-meta text-ink-dim">
					{`${session.title} · ${session.live_state} · ${relativeTime(item.updated_at * 1000, Date.now())}`}
				</Text>
			</View>
			{anchor !== null && anchor.excerpt.length > 0 ? (
				<View className="rounded-md border-hairline bg-elevated p-3">
					<Text className="text-body text-ink">{anchor.excerpt}</Text>
				</View>
			) : (
				/* Honest absence: the relay could not resolve the transcript entry, so
				 * there is no quote to show and none is invented. */
				<Text className="text-meta text-ink-dim">
					This item's message is no longer in the conversation.
				</Text>
			)}
			{item.ask !== null ? (
				<View className="flex-row items-center gap-2">
					<Badge
						label={waitingSummary(1)}
						tone="warning"
						accessibilityLabel="Waiting on you"
					/>
					<Text className="text-meta text-ink-dim">
						{`${item.ask.question_count} question${item.ask.question_count === 1 ? "" : "s"}`}
					</Text>
				</View>
			) : null}
			<Button
				label={OPEN_LABEL}
				onPress={onOpen}
				variant="primary"
				testID={CONTROL.inboxDetailOpen}
			/>
			{projects.length > 0 ? (
				<View className="gap-2">
					<SectionHeader label="Projects" />
					{projects.map((project) => (
						<Text key={project.key} className="text-body text-ink">
							{`${project.name} · ${project.status}`}
						</Text>
					))}
				</View>
			) : null}
			{history.length > 1 ? (
				<View className="gap-2">
					<SectionHeader label="Earlier revisions" />
					{history
						.slice(0, -1)
						.reverse()
						.map((entry) => (
							<View key={entry.revision} className="gap-1">
								<Text className="text-body text-ink">{entry.title}</Text>
								<Text className="text-meta text-ink-dim">{entry.excerpt}</Text>
							</View>
						))}
				</View>
			) : null}
			<View className="gap-2" testID={CONTROL.inboxDetailAsks}>
				<SectionHeader label="This conversation's asks" />
				{asks.length === 0 ? (
					<Text className="text-meta text-ink-dim">
						No asks in this conversation.
					</Text>
				) : (
					asks.map((ask) => <AskLine key={ask.ask_id} ask={ask} />)
				)}
			</View>
		</View>
	);
}

/** One ask, read-only. The verb lives in the conversation (see the header), so
 *  this line states the question and its status rather than offering a second
 *  answer form. */
function AskLine({ ask }: { ask: PendingAsk }) {
	const settled = ask.status !== "open";
	const first = ask.questions[0]?.question ?? "Question unavailable";
	return (
		<View className="gap-1 rounded-md border-hairline bg-elevated p-3">
			<Text className="text-body text-ink" numberOfLines={3}>
				{first}
			</Text>
			<Text className="text-meta text-ink-dim">
				{settled ? `Settled · ${ask.status}` : "Waiting for an answer"}
			</Text>
		</View>
	);
}
