import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import type { SchedulesResponse } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	familyState,
	LINE_CAP,
	type MonitorEntryView,
	type MonitorLineView,
	monitorEntryViews,
	monitorSectionSummary,
	NO_MONITORS_LINE,
	NO_WAKES_LINE,
	NOTHING_ARMED_BODY,
	NOTHING_ARMED_TITLE,
	READ_UNREACHABLE,
	readErrorClause,
	scheduleRefusalSentence,
	schedulesEmpty,
	showLessMonitorLabel,
	showLessWakeLabel,
	showMoreMonitorLabel,
	showMoreWakeLabel,
	supervisorLead,
	truncatedClause,
	type WakeEntryView,
	type WakeLineView,
	wakeEntryViews,
	wakeSectionSummary,
} from "@/features/schedules/schedules-copy";
import { SchedulesStateMarkers } from "@/features/schedules/schedules-markers";
import {
	CONTROL,
	EMPTY,
	SCREEN,
	SURFACE,
	scheduleMonitorRowId,
	scheduleMoreId,
	scheduleWakeRowId,
} from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/empty-state";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Skeleton } from "@/ui/components/skeleton";

/**
 * Schedules (S17): what is ARMED on this machine — every conversation carrying
 * wakes and monitors, read from the derived indexes (`GET /api/schedules`).
 *
 * WHAT THIS SCREEN IS. The phone's view of the armed index: a wake fires a
 * prompt into a conversation at a time, a monitor re-runs a tool and reports
 * what changed. The two families share one screen because they share every
 * surface they are drawn on (the TUI paints both into its single wake band),
 * and one fetch feeds both sections.
 *
 * THE THREE ANSWER STATES ARE THE POINT. "Nothing is armed", "this process
 * could not read the store" and "the list is bounded" are three different
 * claims about the same question, and this screen must never express one as
 * another: `read_error` renders its own strip and NEVER an empty list;
 * `truncated` renders "Showing N of M"; the empty state exists only when BOTH
 * families read OK and are empty (`schedulesEmpty`). The supervisor strip is
 * the fourth honesty: the index cannot say whether anything would actually
 * fire a cold wake, so when nothing would, the screen says so once, above the
 * rows it applies to.
 *
 * A READ, AND ONLY A READ. Arm, edit and cancel stay on the terminal and the
 * desktop plane until the phone's write half ships with its own review; the
 * rows here are statements, not controls. The one control a row carries is the
 * per-conversation disclosure that puts a capped conversation's hidden rows
 * back (`LINE_CAP`), because a 16-schedule conversation must not be a wall.
 *
 * THE MINUTE CLOCK. Due labels are RELATIVE (`in 4m`, `2h overdue` — the CLI's
 * own `_format_due` vocabulary), so the screen ticks once a minute the way the
 * conversations pane does. Without the tick a frame left open would age
 * silently; with it, "in 4m" is true of the minute it is read in.
 *
 * Freshness follows the projects screen: a focus refresh (silent — the rows on
 * screen are still the relay's last answer, and a spinner over them would be
 * motion without news) plus the initial read behind a skeleton.
 */

const READ_TIMEOUT_MS = 8000;
const TICK_MS = 60_000;

export default function Schedules() {
	const router = useRouter();
	const { relay, refusal } = useConnection();

	const [payload, setPayload] = useState<SchedulesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	/** The daemon's own sentence for a failed read, when it sent one. */
	const [refused, setRefused] = useState<string | null>(null);
	/** A read that failed without a sentence: a transport drop, which the
	 *  connection's own surface owns rather than this screen re-wording it. */
	const [unreachable, setUnreachable] = useState(false);
	/** The relative labels' clock: bumped once a minute (see the header). */
	const [nowMs, setNowMs] = useState(() => Date.now());
	/** Which conversations have their hidden rows disclosed, by session id. */
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	const load = useCallback(
		async (options?: { silent?: boolean }) => {
			const client = relay();
			if (!client) return;
			if (options?.silent !== true) {
				setLoading(true);
				setRefused(null);
				setUnreachable(false);
			}
			try {
				/* The read's own bound, the asks sheet's rule: a hung read is itself
				 * a failure the screen must show rather than a blank list. */
				const answer = await client.schedules(
					AbortSignal.timeout(READ_TIMEOUT_MS),
				);
				setPayload(answer);
				setRefused(null);
				setUnreachable(false);
				setNowMs(Date.now());
			} catch (error) {
				if (options?.silent === true) return;
				const sentence = scheduleRefusalSentence(error);
				if (sentence !== null) setRefused(sentence);
				else setUnreachable(true);
			} finally {
				if (options?.silent !== true) setLoading(false);
			}
		},
		[relay],
	);

	useFocusEffect(
		useCallback(() => {
			void load({ silent: true });
			setNowMs(Date.now());
		}, [load]),
	);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		const tick = setInterval(() => setNowMs(Date.now()), TICK_MS);
		return () => clearInterval(tick);
	}, []);

	const wakes = payload?.wakes ?? null;
	const monitors = payload?.monitors ?? null;
	const empty = payload !== null && schedulesEmpty(payload);
	/* The family's own verdict, for the header count's gate: a count under an
	 *  unreadable store would assert a number no process read. */
	const wakeState = wakes === null ? null : familyState(wakes);
	const monitorState = monitors === null ? null : familyState(monitors);

	return (
		<Screen
			title="Schedules"
			testID={SCREEN.schedules}
			headerLeading={
				<Button
					testID={CONTROL.schedulesBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<SchedulesStateMarkers empty={empty} />

			{refusal !== null ? (
				<RefusalSurface
					kind={refusal.kind}
					subject={refusal.subject}
					detail={refusal.detail}
					remedy={refusal.remedy}
					retryAfterMs={refusal.retryAfterMs}
					onRetry={() => void load()}
					onUseAnotherAddress={() => router.push("/custom")}
				/>
			) : loading && payload === null ? (
				<Skeleton lines={6} testID={SURFACE.schedulesLoading} />
			) : unreachable || refused !== null ? (
				<View className="gap-3">
					<Alert severity="error">{refused ?? READ_UNREACHABLE}</Alert>
					<Button
						testID={CONTROL.schedulesRetry}
						label="Try again"
						onPress={() => void load()}
						variant="outline"
						size="sm"
					/>
				</View>
			) : empty ? (
				<EmptyState
					testID={EMPTY.schedules}
					headline={NOTHING_ARMED_TITLE}
					next={NOTHING_ARMED_BODY}
				/>
			) : payload !== null ? (
				<View>
					{wakes !== null ? (
						<View>
							<SectionHeader
								label={
									wakeState === "unreadable"
										? "Wakes"
										: `Wakes · ${wakeSectionSummary(allWakeRows(wakes, nowMs))}`
								}
							/>
							{supervisorLead(wakes.supervisor) !== "" ? (
								<Alert severity="warning" testID={SURFACE.schedulesSupervisor}>
									{supervisorLead(wakes.supervisor)}
								</Alert>
							) : null}
							{familyState(wakes) === "unreadable" ? (
								<Alert
									severity="warning"
									testID={SURFACE.schedulesWakesUnreadable}
								>
									{readErrorClause("wakes")}
								</Alert>
							) : (
								<>
									{wakes.truncated ? (
										<Text
											testID={SURFACE.schedulesWakesTruncated}
											className="border-hairline border-b py-2 text-meta text-ink-dim"
										>
											{truncatedClause(
												"wakes",
												wakes.entries.length,
												wakes.total,
											)}
										</Text>
									) : null}
									{wakes.entries.length === 0 ? (
										<Text className="py-2 text-body-sm text-ink-dim">
											{NO_WAKES_LINE}
										</Text>
									) : (
										wakeEntryViews(wakes, nowMs).map((entry) => (
											<WakeEntry
												key={entry.sessionId}
												entry={entry}
												expanded={expanded[entry.sessionId] === true}
												onToggle={() =>
													setExpanded((current) => ({
														...current,
														[entry.sessionId]:
															current[entry.sessionId] !== true,
													}))
												}
											/>
										))
									)}
								</>
							)}
						</View>
					) : null}

					{monitors !== null ? (
						<View>
							<SectionHeader
								label={
									monitorState === "unreadable"
										? "Monitors"
										: `Monitors · ${monitorSectionSummary(allMonitorRows(monitors, nowMs))}`
								}
							/>
							{familyState(monitors) === "unreadable" ? (
								<Alert
									severity="warning"
									testID={SURFACE.schedulesMonitorsUnreadable}
								>
									{readErrorClause("monitors")}
								</Alert>
							) : (
								<>
									{monitors.truncated ? (
										<Text
											testID={SURFACE.schedulesMonitorsTruncated}
											className="border-hairline border-b py-2 text-meta text-ink-dim"
										>
											{truncatedClause(
												"monitors",
												monitors.entries.length,
												monitors.total,
											)}
										</Text>
									) : null}
									{monitors.entries.length === 0 ? (
										<Text className="py-2 text-body-sm text-ink-dim">
											{NO_MONITORS_LINE}
										</Text>
									) : (
										monitorEntryViews(monitors, nowMs).map((entry) => (
											<MonitorEntry
												key={entry.sessionId}
												entry={entry}
												expanded={expanded[entry.sessionId] === true}
												onToggle={() =>
													setExpanded((current) => ({
														...current,
														[entry.sessionId]:
															current[entry.sessionId] !== true,
													}))
												}
											/>
										))
									)}
								</>
							)}
						</View>
					) : null}
				</View>
			) : null}
		</Screen>
	);
}

/* ------------------------------------------------------------ the sections */

const allWakeRows = (
	wakes: NonNullable<SchedulesResponse["wakes"]>,
	nowMs: number,
): WakeLineView[] =>
	wakeEntryViews(wakes, nowMs).flatMap((entry) => entry.rows);

const allMonitorRows = (
	monitors: NonNullable<SchedulesResponse["monitors"]>,
	nowMs: number,
): MonitorLineView[] =>
	monitorEntryViews(monitors, nowMs).flatMap((entry) => entry.rows);

/** One wake-carrying conversation: its name and head clause, then its wake
 *  lines, capped per the desktop's rule with the disclosure putting the rest
 *  back. Non-interactive except the disclosure — this surface is a read. */
const WakeEntry = ({
	entry,
	expanded,
	onToggle,
}: {
	entry: WakeEntryView;
	expanded: boolean;
	onToggle: () => void;
}) => {
	const rows = expanded ? entry.rows : entry.rows.slice(0, LINE_CAP);
	return (
		<View
			testID={scheduleWakeRowId(entry.sessionId)}
			className="border-hairline border-b py-3"
		>
			<Text
				className="text-body-sm font-medium text-ink"
				numberOfLines={1}
				ellipsizeMode="tail"
			>
				{entry.name}
			</Text>
			<Text className="text-meta text-ink-dim" numberOfLines={2}>
				{entry.clause}
			</Text>
			<View className="gap-2 pl-3 pt-2">
				{rows.map((row) => (
					<WakeLine key={row.id} row={row} />
				))}
			</View>
			{entry.hidden > 0 ? (
				<View className="pt-2">
					<Button
						testID={scheduleMoreId(entry.sessionId)}
						label={
							expanded ? showLessWakeLabel : showMoreWakeLabel(entry.hidden)
						}
						onPress={onToggle}
						variant="quiet"
						size="sm"
					/>
				</View>
			) : null}
		</View>
	);
};

/** One wake line: the message (what it will say), then the facts — the due
 *  slot (or `stale`, which replaces the clock because nothing will fire it)
 *  and the cadence. */
const WakeLine = ({ row }: { row: WakeLineView }) => (
	<View className="gap-0.5">
		{row.message !== "" ? (
			<Text
				className="text-body-sm text-ink"
				numberOfLines={2}
				ellipsizeMode="tail"
			>
				{row.message}
			</Text>
		) : null}
		<View className="flex-row flex-wrap gap-x-2">
			{row.due !== "" ? (
				<Text
					className={`text-meta ${row.stale ? "text-warning" : "text-ink-dim"}`}
				>
					{row.due}
				</Text>
			) : null}
			<Text className="text-meta text-ink-dim">{row.cadence}</Text>
		</View>
	</View>
);

/** One monitor-carrying conversation, the wake entry's twin: name, head
 *  clause, then one line per watch. */
const MonitorEntry = ({
	entry,
	expanded,
	onToggle,
}: {
	entry: MonitorEntryView;
	expanded: boolean;
	onToggle: () => void;
}) => {
	const rows = expanded ? entry.rows : entry.rows.slice(0, LINE_CAP);
	return (
		<View
			testID={scheduleMonitorRowId(entry.sessionId)}
			className="border-hairline border-b py-3"
		>
			<Text
				className="text-body-sm font-medium text-ink"
				numberOfLines={1}
				ellipsizeMode="tail"
			>
				{entry.name}
			</Text>
			<Text className="text-meta text-ink-dim" numberOfLines={2}>
				{entry.clause}
			</Text>
			<View className="gap-2 pl-3 pt-2">
				{rows.map((row) => (
					<MonitorLine key={row.id} row={row} />
				))}
			</View>
			{entry.hidden > 0 ? (
				<View className="pt-2">
					<Button
						testID={scheduleMoreId(entry.sessionId)}
						label={
							expanded
								? showLessMonitorLabel
								: showMoreMonitorLabel(entry.hidden)
						}
						onPress={onToggle}
						variant="quiet"
						size="sm"
					/>
				</View>
			) : null}
		</View>
	);
};

/** One watch: what it is watching (name, description), then the facts — the
 *  due-or-state slot, the cadence, and the store's health sentence when there
 *  is one. */
const MonitorLine = ({ row }: { row: MonitorLineView }) => (
	<View className="gap-0.5">
		<Text
			className="text-body-sm text-ink"
			numberOfLines={1}
			ellipsizeMode="tail"
		>
			{row.name}
		</Text>
		{row.description !== "" ? (
			<Text
				className="text-meta text-ink-dim"
				numberOfLines={1}
				ellipsizeMode="tail"
			>
				{row.description}
			</Text>
		) : null}
		<View className="flex-row flex-wrap gap-x-2">
			{row.slot !== "" ? (
				<Text
					className={`text-meta ${row.alerting ? "text-warning" : "text-ink-dim"}`}
				>
					{row.slot}
				</Text>
			) : null}
			<Text className="text-meta text-ink-dim">{row.cadence}</Text>
			{row.tail !== null ? (
				<Text
					className={`text-meta ${row.alerting ? "text-warning" : "text-ink-dim"}`}
				>
					{row.tail}
				</Text>
			) : null}
		</View>
	</View>
);
