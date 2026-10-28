import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { NotificationDetailResponse, RelayAskRow } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	type ConversationScope,
	confirmBodyFor,
	confirmTitleFor,
	DISMISS_CONFIRM_LABEL,
	dismissAllLabel,
	dismissAllPendingLabel,
} from "@/features/notifications/conversation-dismiss";
import { DismissReceipt } from "@/features/notifications/dismiss-receipt";
import { noteInboxWrite } from "@/features/notifications/inbox-writes";
import {
	conversationName,
	OPEN_LABEL,
	RETRY_LABEL,
	readLoadedDetail,
	relativeTime,
	VANISHED_BODY,
	VANISHED_TITLE,
} from "@/features/notifications/notifications-model";
import {
	type ConversationDismiss,
	useConversationDismiss,
} from "@/features/notifications/use-conversation-dismiss";
import { refusalSentence } from "@/features/notifications/use-notifications";
import { AsksSheet } from "@/features/session/components/asks-sheet";
import { Markdown } from "@/features/session/components/markdown";
import { useSessionRuntime } from "@/features/session/use-session";
import { t } from "@/i18n";
import { isRelayError, isRelayMissing } from "@/relay";
import {
	CONTROL,
	notificationLinkId,
	notificationProjectId,
	ROLE,
	SCREEN,
	SURFACE,
} from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Skeleton } from "@/ui/components/skeleton";

const READ_TIMEOUT_MS = 8_000;

/** The awaited explicit read's own budget — shorter than a page read because the
 *  reader is sitting on this screen waiting for it before the From card can offer
 *  its count (review round 4, m4). A timeout is treated as a failed read: the item
 *  stays unread and the walk still starts. */
const READ_CONFIRM_TIMEOUT_MS = 3_500;

type DetailState =
	| { kind: "loading" }
	| { kind: "ready"; detail: NotificationDetailResponse }
	| { kind: "vanished" }
	| { kind: "refused"; sentence: string }
	| { kind: "unreachable" }
	| { kind: "malformed"; sentence: string };

/**
 * One notification's detail (design §10; contract §5.2/§5.4).
 *
 * WHY THE READ IS EXPLICIT. Opening this screen is the operator saying "I am
 * looking at this item", so the read is sent once the CONTENT has loaded — never
 * on the route mount. A mount that 404s, or that lands while the relay is
 * unreachable, has shown the reader nothing and must not clear anything (D8:
 * "route mount or push tap alone before content renders is not" a read).
 *
 * WHAT IT SHOWS. The notify body's markdown and links, the anchor's excerpt,
 * the source conversation, related projects, the item's history, and that
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
	/* The From card's count: the conversation's FULL scope, walked once the
	 *  detail (and its own read) has settled. `null` while counting or after a
	 *  failed count — the label then says "Dismiss all" with no number rather
	 *  than a number this screen cannot stand behind. */
	const [scope, setScope] = useState<ConversationScope | null>(null);
	const scopeTicketRef = useRef(0);
	/* Re-walk after every write, so the card's number is the relay's state and
	 *  never this screen's arithmetic on a receipt. */
	const rewalkRef = useRef<() => void>(() => undefined);
	/* Every settled dismiss (and its Undo) is announced to the inbox list under
	 *  this route, which re-reads on it: the list is still mounted and would
	 *  otherwise keep the dismissed rows (QA round 7 O2, `inbox-writes.ts`). */
	const dismissAll = useConversationDismiss(client, () => {
		noteInboxWrite();
		rewalkRef.current();
	});
	const { observe, reportCountFailed } = dismissAll;
	const runtime = useSessionRuntime(
		state.kind === "ready" ? state.detail.session.id : "",
	);
	const [asksOpen, setAsksOpen] = useState(false);

	const recount = useCallback(
		async (sessionId: string, title: string) => {
			const ticket = ++scopeTicketRef.current;
			setScope(null);
			const walked = await observe(sessionId, title);
			if (ticket !== scopeTicketRef.current) return;
			setScope(walked);
			/* A failed walk used to leave the card permanently disabled with no
			 * sentence — while the list's door for the same action said why (code
			 * review M4). */
			if (walked === null) reportCountFailed();
		},
		[observe, reportCountFailed],
	);

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
					/* OPENING A LOADED DETAIL IS THE EXPLICIT READ (D11, contract §6.4).
					 * Not a mount: the write happens only after this item's own content
					 * rendered, and only for the revision the answer carried — so an item
					 * that moved while the reader was opening it is not cleared unseen. A
					 * failure is silent here: the row stays unread (the safe direction) and
					 * the next open retries it. */
					/* ASKS ARE ANSWERED, NOT READ: an ask's own mark would be a claim that
					 *  the reader finished with a question they have not answered, and the
					 *  "Waiting on you" group does not use read state anyway. Only an
					 *  update detail writes a read (QA round 2 Q4's second half). */
					/* AWAITED, AND THEN THE ROW IS RE-READ (QA round 3, Q8): a walk that
					 * starts before the read settles freezes a boundary BELOW the item on
					 * screen, so the reader's own "Dismiss all" skips the very row they
					 * opened as `stale_revision`. `readLoadedDetail` is that sequence. */
					/* ITS OWN SHORT DEADLINE (review round 4, m4). This write is not a page
					 * read: the reader is on the screen waiting for it before the From
					 * card can offer its count, and the relay's other interactive reads are
					 * bounded well below a page's budget. A read that has not landed in
					 * this window is treated as failed — the item stays UNREAD (the safe
					 * direction) and the walk below still runs, so Dismiss-all opens with a
					 * FRESH boundary instead of a disabled card. */
					const shown = await readLoadedDetail(
						detail,
						{
							read: (id, revision, signal) =>
								live.patchNotifications(
									{ op: "read", ids: [{ id, revision }] },
									signal,
								),
							reload: (id, signal) => live.notification(id, signal),
						},
						{ timeoutMs: READ_CONFIRM_TIMEOUT_MS },
					);
					/* The list under this route still shows the row as unread; tell it
					 *  the read settled, even when this load was superseded — the write
					 *  happened either way (the audit scout's "read via detail"). */
					if (!detail.item.read && detail.item.source === "notify") {
						noteInboxWrite();
					}
					if (ticket !== ticketRef.current) return;
					if (shown !== detail) setState({ kind: "ready", detail: shown });
					/* Count AFTER the read settles: the read re-stamps this item's seq,
					 * and a boundary frozen before it would make the write refuse the
					 * very item the reader is looking at as "changed since counted".
					 * The walk reads `shown`, so the count and the row on screen agree. */
					rewalkRef.current = () =>
						void recount(
							shown.session.id,
							conversationName(shown.session.title),
						);
					rewalkRef.current();
				} catch (error) {
					/* A late answer to a superseded load (a retry the reader pressed while
					 * the first was still in flight) must not overwrite the newer one. */
					if (ticket !== ticketRef.current) return;
					if (isRelayMissing(error)) {
						setState({ kind: "vanished" });
						return;
					}
					if (isRelayError(error) && error.kind === "malformed-frame") {
						setState({
							kind: "malformed",
							sentence:
								"The relay returned an unreadable notification detail. Please try again.",
						});
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
		[client, itemId, recount],
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
		if (state.kind === "malformed") {
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
				onOpenProject={(key) =>
					router.push(`/projects/${encodeURIComponent(key)}`)
				}
				onAnswer={() => setAsksOpen(true)}
				scope={scope}
				dismissAll={dismissAll}
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
			<AsksSheet
				visible={asksOpen}
				onClose={() => setAsksOpen(false)}
				client={runtime.source.endpoints}
				currentSessionId={
					state.kind === "ready" ? state.detail.session.id : undefined
				}
				initialOpenAsk={
					state.kind === "ready" && state.detail.item.source === "ask"
						? state.detail.item.id
						: null
				}
				onOpenConversation={(target) => {
					setAsksOpen(false);
					openConversation(target);
				}}
			/>
			<Dialog
				visible={dismissAll.phase.kind === "confirming"}
				testID={CONTROL.inboxDismissAllDialog}
				title={confirmTitleFor(dismissAll.phase)}
				body={confirmBodyFor(dismissAll.phase)}
				confirmLabel={DISMISS_CONFIRM_LABEL}
				destructive
				onConfirm={() => void dismissAll.confirm()}
				onCancel={dismissAll.cancel}
			/>
		</Screen>
	);
}

function DetailBody({
	detail,
	onOpen,
	onOpenProject,
	onAnswer,
	scope,
	dismissAll,
}: {
	detail: NotificationDetailResponse;
	onOpen: () => void;
	onOpenProject: (key: string) => void;
	onAnswer: () => void;
	scope: ConversationScope | null;
	dismissAll: ConversationDismiss;
}) {
	const { item, session, anchor, projects, asks, history } = detail;
	return (
		<View className="gap-4 px-4 pt-4">
			<View className="gap-1">
				<Text className="text-title text-ink" accessibilityRole={ROLE.header}>
					{item.title}
				</Text>
				<Text className="text-meta text-ink-dim">
					{[
						conversationName(session.title),
						session.live || session.live_state === "live" ? "Live" : "",
						relativeTime(item.updated_at, Date.now()),
					]
						.filter((part) => part !== "")
						.join(" · ")}
				</Text>
			</View>
			{item.source === "notify" && (item.body_md ?? "") !== "" ? (
				<View className="gap-2">
					<SectionHeader label="Notification" />
					<Markdown text={item.body_md ?? ""} />
				</View>
			) : null}
			{(item.links ?? []).length > 0 ? (
				<View className="gap-2">
					<SectionHeader label="Links" />
					{(item.links ?? []).map((link) => (
						<Button
							key={`${link.label}:${link.url}`}
							label={link.label}
							variant="outline"
							onPress={() => {
								void import("react-native").then(({ Linking }) =>
									Linking.openURL(link.url),
								);
							}}
							testID={notificationLinkId(link.url)}
						/>
					))}
				</View>
			) : null}
			{anchor !== null && anchor.excerpt.length > 0 ? (
				<View className="gap-2">
					<SectionHeader label="Message" />
					<View className="rounded-md border-hairline bg-elevated p-3">
						<Text className="text-body text-ink">{anchor.excerpt}</Text>
					</View>
				</View>
			) : item.anchor_id ? (
				<Text className="text-meta text-ink-dim">
					This item's message is no longer in the conversation.
				</Text>
			) : null}
			{item.ask !== null ? (
				<View className="flex-row items-center gap-2">
					<Text className="text-meta text-ink-dim">
						{`${item.ask.question_count} question${item.ask.question_count === 1 ? "" : "s"}`}
					</Text>
				</View>
			) : null}
			{item.source === "ask" ? (
				<Button
					label={t("mobile.notifications.detail.answer_in_conversation")}
					onPress={onAnswer}
					variant="primary"
					testID={CONTROL.inboxDetailOpen}
				/>
			) : (
				<Button
					label={OPEN_LABEL}
					onPress={onOpen}
					variant="primary"
					testID={CONTROL.inboxDetailOpen}
				/>
			)}
			<FromCard
				title={conversationName(session.title)}
				liveState={
					session.live === true || session.live_state === "live"
						? "Live"
						: "Not live"
				}
				scope={scope}
				dismissAll={dismissAll}
			/>
			{projects.length > 0 ? (
				<View className="gap-2">
					<SectionHeader label={t("mobile.notifications.detail.projects")} />
					{projects.map((project) => (
						<Button
							key={project.key}
							label={`${project.name} · ${project.status}`}
							onPress={() => onOpenProject(project.key)}
							variant="outline"
							testID={notificationProjectId(project.key)}
						/>
					))}
				</View>
			) : null}
			{history.length > 0 ? (
				<View className="gap-2">
					<SectionHeader
						label={t("mobile.notifications.detail.earlier_updates")}
					/>
					{history.map((entry) => (
						<View key={entry.revision} className="gap-1">
							<Text className="text-body text-ink">{entry.title}</Text>
							<Text className="text-meta text-ink-dim">{entry.excerpt}</Text>
						</View>
					))}
				</View>
			) : null}
			<View className="gap-2" testID={CONTROL.inboxDetailAsks}>
				<SectionHeader
					label={t("mobile.notifications.detail.conversation_asks")}
				/>
				{asks.length === 0 ? (
					<Text className="text-meta text-ink-dim">
						{t("mobile.notifications.detail.no_asks")}
					</Text>
				) : (
					asks.map((ask) => <AskLine key={ask.ask_id} ask={ask} />)
				)}
			</View>
		</View>
	);
}

/**
 * The From card (design §2 / §10): the source conversation and its one bulk
 * verb, "Dismiss all n".
 *
 * The number is the conversation's FULL scope (every page under one frozen
 * boundary), never the rows the inbox happened to load, and the confirmation
 * shows that same number because it owns that same scope. The receipt is
 * INLINE rather than a toast: it carries an action (Undo) and, when partial, a
 * sentence the reader must be able to read in full — components.md §10 rules
 * both out of a toast that disappears.
 */
function FromCard({
	title,
	liveState,
	scope,
	dismissAll,
}: {
	title: string;
	liveState: string;
	scope: ConversationScope | null;
	dismissAll: ConversationDismiss;
}) {
	const { phase } = dismissAll;
	const busy = phase.kind === "applying" || phase.kind === "undoing";
	const empty = scope !== null && scope.tokens.length === 0;
	return (
		<View className="gap-2" testID={SURFACE.inboxDetailFrom}>
			<SectionHeader label={t("mobile.notifications.detail.from")} />
			<View className="gap-3 rounded-md border-hairline bg-elevated p-3">
				<Text className="text-body text-ink">{`${title} · ${liveState}`}</Text>
				{empty ? (
					<Text className="text-meta text-ink-dim">
						{t("mobile.notifications.detail.nothing_to_dismiss")}
					</Text>
				) : (
					<Button
						label={
							scope === null
								? dismissAllPendingLabel(title)
								: dismissAllLabel(scope.tokens.length, title)
						}
						onPress={() => {
							if (scope !== null) dismissAll.ask(scope);
						}}
						variant="danger"
						size="sm"
						/* No count yet means no promise yet: the control waits for the
						 *  walk rather than confirming a number it has not got. */
						disabled={scope === null || busy}
						loading={busy}
						testID={CONTROL.inboxDismissAll}
					/>
				)}
				<DismissReceipt dismissAll={dismissAll} />
			</View>
		</View>
	);
}

/** One ask, read-only. The verb lives in the conversation (see the header), so
 *  this line states the question and its status rather than offering a second
 *  answer form. */
function AskLine({ ask }: { ask: RelayAskRow }) {
	const settled = ask.status !== "open";
	const first = ask.questions?.[0]?.question ?? "Question unavailable";
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
