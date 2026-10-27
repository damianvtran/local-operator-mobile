/**
 * The session header's status dot, its explanation sheet, the header's overflow
 * menu, and the resume path an ended session offers from both.
 *
 * Native port of the relay web client's `components/session-health.tsx`
 * (local-operator #3008). WHY A DOT AND NOT A BANNER: the ended session used to
 * disable the composer with a permanent sentence, spending the thumb zone on a
 * fact that changes rarely and needs no action until the reader wants one. The
 * fact now lives beside the title as one quiet dot, with the detail and the one
 * action (Resume) a tap away in the shared Sheet — and a send to an ended
 * session REOPENS it rather than being refused.
 *
 * THE STATE COMES FROM RUNTIME SIGNALS THE RELAY SENDS, never from the last
 * message: see `features/session/health.ts` for the exact fields and the rule.
 */
import { MoreVertical } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useConnection } from "@/features/auth/connection-provider";
import {
	HEALTH_DOT_TONE,
	type HealthInput,
	healthDetailKey,
	healthLabel,
	type SessionHealth,
} from "@/features/session/health";
import { HEALTH_COPY } from "@/features/session/health-copy";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { Sheet } from "@/ui/components/sheet";
import { TOUCH_FLOOR } from "@/ui/layout";

/** The acceptance line's two spellings. The first is what a cold child start
    honestly looks like; the second is the same fact once "a few seconds" has
    stopped describing it. 20s is generous for the ordinary respawn and short
    enough that a stuck one is not dressed up as a normal start. */
const REOPENING = "Reopening — this can take a few seconds.";
const STILL_REOPENING = "Still reopening — it has not come up yet.";
const REOPEN_REPORT_MS = 20_000;

/**
 * The documented resume affordance for an ENDED session, shared by the sheet
 * and the overflow menu so there is ONE implementation. A tap calls the
 * relay's own `POST /api/sessions/resume` route (the same one Past sessions
 * uses): the daemon spawns a child that resumes the transcript in the home
 * folder, and the next live frame flips the dot green.
 *
 * Held by the SCREEN, not the sheet: the sheet unmounts when it closes, and
 * the acceptance line has to survive the reader closing it to watch the dot.
 * `ended` going false is the signal that the session came back, so it clears
 * the state.
 */
export function useResume(sessionId: string, ended: boolean) {
	const { relay } = useConnection();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	useEffect(() => {
		if (ended) return;
		setBusy(false);
		setError(null);
		setNotice(null);
	}, [ended]);

	const resume = useCallback(async () => {
		if (busy) return;
		const client = relay();
		if (!client) {
			setError("Connect to a computer to resume this session.");
			return;
		}
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await client.resumeSession(sessionId);
			/* Reset busy on success too: the route echoes the id it was given, so
			   this screen usually stays mounted, and a POST that succeeded against
			   a session slow to come back must not leave Resume disabled forever.
			   Retrying is safe — `spawn_session` coalesces concurrent resumes. */
			setBusy(false);
			setNotice(REOPENING);
		} catch {
			/* The refusal voice the past-sessions screen already uses, never the raw
			   daemon string. */
			setError("This session could not be reopened just now. Try again.");
			setBusy(false);
		}
	}, [busy, relay, sessionId]);

	useEffect(() => {
		if (notice !== REOPENING) return;
		const t = setTimeout(() => setNotice(STILL_REOPENING), REOPEN_REPORT_MS);
		return () => clearTimeout(t);
	}, [notice]);

	return { busy, error, notice, resume };
}

/** The dot: a small filled circle in the state's tone, decorative only — the
    control's accessible name carries the state word. */
function HealthDot({ health }: { health: SessionHealth }) {
	const color = useTokenColor(HEALTH_DOT_TONE[health]);
	return (
		<View
			aria-hidden
			style={{ backgroundColor: color }}
			className="size-2 shrink-0 rounded-full"
		/>
	);
}

export type SessionHealthControlProps = {
	health: SessionHealth;
	/** The projection, so the sheet can tell the two yellow causes apart
	    (`degraded` reads "dropped", a stale heartbeat reads "quiet"). */
	projection: HealthInput | null;
	/** The conversation name, rendered inside the tappable block. */
	children: React.ReactNode;
	/** The sheet's visibility is held by the screen so the overflow menu can
	 *  open it too. */
	sheetOpen: boolean;
	onSheetOpenChange: (open: boolean) => void;
	resume: ReturnType<typeof useResume>;
	/** The overflow menu's visibility and control. */
	menuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
	/** The find lever, rendered beside the overflow control. */
	findAction?: React.ReactNode;
};

/**
 * The header's title block as ONE control (the conversation name plus the dot),
 * a tap on which opens the explanation sheet; plus the overflow menu that also
 * carries Resume. The whole block is the button so the 44 pt target is the
 * block's own height inside the existing header row, not a padded 8 pt dot.
 */
export function SessionHealthControl({
	health,
	projection,
	children,
	sheetOpen,
	onSheetOpenChange,
	resume,
	menuOpen,
	onMenuOpenChange,
	findAction,
}: SessionHealthControlProps) {
	const label = healthLabel(health);
	const ended = health === "ended";
	return (
		<>
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={label}
				accessibilityHint="Shows what this state means and what a send does now"
				accessibilityState={{ expanded: sheetOpen }}
				testID={CONTROL.sessionHealth}
				onPress={() => onSheetOpenChange(true)}
				className="min-w-0 flex-1 flex-row items-center gap-2"
				style={{ minHeight: TOUCH_FLOOR }}
			>
				<HealthDot health={health} />
				<View className="min-w-0 flex-1">{children}</View>
			</Pressable>

			{/* THE TRANSITION ANNOUNCEMENT. The retired ended sentence was a live
			    region inserted on the change, so a screen-reader user heard it
			    happen; the dot alone would say it to sighted readers only. One
			    polite region that holds the state's word while not live and is
			    empty while live — a region only speaks on a CHANGE. Visually
			    collapsed (1px, clipped) but still accessible. */}
			<Text
				accessibilityLiveRegion="polite"
				style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
				pointerEvents="none"
			>
				{health === "live" ? "" : label}
			</Text>

			{/* The overflow control and the find lever, the header's action cluster. */}
			<View className="flex-row items-center gap-2">
				{findAction}
				<IconButton
					accessibilityLabel="Session actions"
					accessibilityHint="Opens the session menu"
					size={22}
					testID={CONTROL.sessionMenu}
					onPress={() => onMenuOpenChange(true)}
					icon={({ color, size }) => <MoreVertical color={color} size={size} />}
				/>
			</View>

			{/* The explanation sheet. ONE paragraph that adds what the title does not
			    say, and Resume when grey. */}
			<Sheet
				visible={sheetOpen}
				onClose={() => onSheetOpenChange(false)}
				title={label}
				testID={CONTROL.sessionHealthSheet}
			>
				<View className="gap-3 px-4 pb-4">
					<Text className="text-body-sm text-ink-muted">
						{HEALTH_COPY[healthDetailKey(health, projection)].source}
					</Text>
					{ended ? (
						<>
							<Button
								testID={CONTROL.sessionHealthResume}
								label={resume.busy ? "Resuming…" : "Resume"}
								disabled={resume.busy}
								onPress={() => void resume.resume()}
							/>
							{resume.notice ? (
								<Text
									accessibilityLiveRegion="polite"
									className="text-meta text-ink-dim"
								>
									{resume.notice}
								</Text>
							) : null}
							{resume.error ? (
								<Alert severity="warning" title="Could not resume">
									{resume.error}
								</Alert>
							) : null}
						</>
					) : null}
				</View>
			</Sheet>

			{/* The overflow menu. Resume sits here too because the header's status
			    line carries no visual tap cue, and the menu is where a reader looks
			    for actions. It closes first, then opens the health sheet, so the
			    outcome lands in one place — never two stacked dialogs. */}
			<Sheet
				visible={menuOpen}
				onClose={() => onMenuOpenChange(false)}
				title="Session"
				testID={CONTROL.sessionHeaderMenuSheet}
			>
				<View className="gap-2 px-4 pb-4">
					{ended ? (
						<Button
							testID={CONTROL.sessionMenuResume}
							label={resume.busy ? "Resuming…" : "Resume"}
							disabled={resume.busy}
							onPress={() => {
								onMenuOpenChange(false);
								onSheetOpenChange(true);
								void resume.resume();
							}}
						/>
					) : null}
				</View>
			</Sheet>
		</>
	);
}
