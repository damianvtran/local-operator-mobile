import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { SessionSummary, TransferReceipt } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	isRemoteRow,
	remoteDeviceLabel,
	type VisiblePeer,
} from "@/features/sessions/session-projection";
import {
	type MoveAsk,
	type MoveOutcome,
	moveAttempt,
	moveClaim,
	moveWait,
	newTransferRequestId,
	type TransferRefusal,
} from "@/features/sessions/transfer";
import { sessionTitle } from "@/state/list-store";
import { CONTROL, ROLE, SURFACE, sessionMoveDestId, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { Sheet } from "@/ui/components/sheet";

/**
 * The move/offload sheet: one conversation's move, copy, or recall.
 *
 * WHAT IT IS FOR. A row on the sessions list that lives on ANOTHER device gets
 * this sheet on tap (that is its tap-reveal detail), and a local row reaches it
 * from its long-press menu. It is where the mesh's one destructive verb is
 * asked for, so the states it renders are the contract's own (`transfer.ts`
 * owns the semantics; this file owns the words):
 *
 * - **Pick** — where the conversation is now, and the destinations the loaded
 *   list reveals. `local` ("this computer") is offered for a remote row
 *   (a RECALL); a remote row's own device is not offered (it is already there);
 *   and a list with no peers offers no destination rather than a dead one.
 * - **In flight** — the ASK was issued and the answer has not arrived. Never a
 *   bare spinner: the move's shape, destination and two-step behaviour are on
 *   screen, session-close is safe, and the copy says what happens if the answer
 *   never comes (the list is re-read; nothing repeats).
 * - **Moved** — the receipt, which is the ONLY thing that may claim where the
 *   conversation now lives. Its `phases` are rendered as the machine facts they
 *   are.
 * - **Busy** — a refusal with a remedy: the same move can be re-asked with the
 *   wait ceiling under the SAME request id.
 * - **Unconfirmed** — the request was sent and no answer came. The copy says
 *   exactly that (never "it failed"), and its primary action is "Check the
 *   list": the read is the honest resolution, and a same-id retry is the only
 *   other one.
 * - **Refused** — the relay's sentence, verbatim, plus the same pointer at the
 *   read. A refusal CAN read as "nothing changed" while the list shows the move
 *   already happened (a fresh-id 409 after a completion), which is why the read
 *   is named even here.
 */

/** One destination the sheet can name. `to` is a device id or `"local"`. */
export type MoveDestination = { to: string; label: string };

export type SessionMoveSheetProps = {
	visible: boolean;
	/** The row being moved, or `null` while the sheet is closed. */
	session: SessionSummary | null;
	/** The devices the LOADED LIST reveals (`visiblePeers`). A full peer picker
	 *  needs a network listing this plane does not serve yet; until then the
	 *  session rows are the only catalogue, which is why an empty list renders
	 *  the no-devices state below rather than a spinner. */
	peers: readonly VisiblePeer[];
	onClose: () => void;
};

/** The sheet's life: which phase of the move is on screen. */
type SheetState =
	| { kind: "pick" }
	/** The request is in flight: `attempt` is the first ask (`wait_s: 0`); the
	 *  `claim` is the SAME id and the SAME body re-issued with the long
	 *  deadline — the raised wait is the busy remedy (`moveWait`), never the
	 *  claim (`transfer.ts` states why). `keep` is the intent's verb — the words
	 *  must not say "Moving" about a copy. */
	| { kind: "in-flight"; phase: "attempt" | "claim"; keep: boolean }
	| { kind: "moved"; receipt: TransferReceipt }
	| { kind: "busy"; refusal: TransferRefusal }
	| { kind: "unconfirmed"; refusal: TransferRefusal }
	| { kind: "refused"; refusal: TransferRefusal };

/** The words for the phases this build knows; an unknown phase word is rendered
 *  verbatim rather than dropped (a newer backend's phase is still a fact). */
const PHASE_WORDS: Record<string, string> = {
	prepared: "Prepared",
	handing_off: "Handing off",
	committed: "Committed",
	done: "Done",
};

/** How a destination is said in a sentence: the one spelling for every use. */
function destPhrase(destination: MoveDestination): string {
	return destination.to === "local" ? "this computer" : destination.label;
}

/** The non-keep verb's consequence, stated AT the choice (round 1, U69-1).
 *
 *  A plain move RETIRES the source's copy — the module's own semantics ("the
 *  mesh's one destructive verb") and the contract's §4.13 — and before this
 *  line the sheet said so only on the RECEIPT, after the fact. The `keep` copy
 *  never retires anything, so this sentence belongs to the Move/Recall group
 *  and rides the footer with it, never beside the Copy verb alone. */
function retireLine(
	session: SessionSummary,
	destination: MoveDestination,
): string {
	const source = isRemoteRow(session)
		? remoteDeviceLabel(session)
		: "this computer";
	return destination.to === "local"
		? `Recall brings it here and removes it from ${source}.`
		: `Move to ${destPhrase(destination)} removes it from ${source}.`;
}

/** One action the sheet's pinned footer offers. */
type SheetAction = {
	label: string;
	onPress: () => void;
	testID: string;
	variant?: "outline";
};

export const SessionMoveSheet = ({
	visible,
	session,
	peers,
	onClose,
}: SessionMoveSheetProps) => {
	const { relay, refreshList } = useConnection();
	const [sheetState, setSheetState] = useState<SheetState>({ kind: "pick" });
	const [selectedTo, setSelectedTo] = useState<string | null>(null);
	/** The current intent's ask — request id included. Held across the busy and
	 *  unconfirmed states because their remedies RE-ISSUE this exact ask: a new
	 *  id would be a second move for one user intent. */
	const askRef = useRef<MoveAsk | null>(null);
	const aliveRef = useRef(true);
	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
		};
	}, []);

	const destinations = useMemo<MoveDestination[]>(() => {
		if (session === null) return [];
		const out: MoveDestination[] = [];
		if (isRemoteRow(session)) {
			/* A remote row's first offer is the recall — the affordance the
			 * detail exists for. */
			out.push({ to: "local", label: "this computer" });
		}
		for (const peer of peers) {
			if (peer.deviceId === session.owner_device) continue;
			out.push({ to: peer.deviceId, label: peer.label });
		}
		return out;
	}, [session, peers]);

	/* A fresh sheet starts at the pick state with no EXPLICIT destination: the
	 * effective choice follows `destinations[0]` (the recall for a remote row,
	 * the first visible peer for a local one) until the reader taps one, so a
	 * list repaint behind the open sheet cannot silently reset a choice the
	 * reader made. VISIBILITY IS THE WHOLE EDGE: the sheet is a Modal, so the
	 * subject cannot change while it is open, and every edge of `visible`
	 * resets both the state and the held intent — closing drops the intent (a
	 * late answer is not this sheet's any more; the move itself continues on the
	 * computer, exactly as the in-flight copy promises) and opening starts
	 * fresh, including a re-open while the previous move is still running. */
	useEffect(() => {
		if (!visible) {
			/* Closing: the held intent is dropped — a late answer is not this
			 * sheet's any more (the settle still re-reads the list, which is
			 * where the outcome stays visible; the move itself continues on the
			 * computer, as the in-flight copy promises). */
			askRef.current = null;
			return;
		}
		/* Opening: start fresh, including a re-open while a previous move is
		 * still running. */
		setSheetState({ kind: "pick" });
		setSelectedTo(null);
		askRef.current = null;
	}, [visible]);

	/* The effective destination: the reader's tap, else the default, else none.
	 * `selectedTo` holds only TAPS (`null` — and a vanished destination — mean
	 * "follow the default"), which is what keeps the reset above from needing
	 * the destination list in its dependencies. */
	const selected =
		destinations.find((destination) => destination.to === selectedTo) ??
		destinations[0] ??
		null;

	const settle = (ask: MoveAsk, outcome: MoveOutcome) => {
		/* EVERY settled outcome is followed by the read (the desktop lane's
		 * rule): a refusal is still information about the world, and the list
		 * is what makes the surface's claim current. It runs even for an answer
		 * the sheet no longer owns (closed, or superseded), because the list is
		 * the one place the outcome stays visible. */
		void refreshList();
		if (!aliveRef.current || askRef.current !== ask) return;
		switch (outcome.kind) {
			case "moved":
				setSheetState({ kind: "moved", receipt: outcome.receipt });
				break;
			case "busy":
				setSheetState({ kind: "busy", refusal: outcome.refusal });
				break;
			case "unconfirmed":
				setSheetState({ kind: "unconfirmed", refusal: outcome.refusal });
				break;
			case "refused":
				setSheetState({ kind: "refused", refusal: outcome.refusal });
				break;
		}
	};

	const start = (keep: boolean) => {
		const client = relay();
		if (!client || session === null || selected === null) return;
		/* ONE INTENT, ONE ID (round 1, Q69-5): two presses delivered before the
		 *  re-render would otherwise mint two request ids and DIAL twice — the
		 *  measured wire behaviour of two ids is two moves. The held intent is the
		 *  guard: while the sheet carries one, a second press changes nothing until
		 *  the sheet closes (which is when an intent is dropped, by the effect
		 *  above). */
		if (askRef.current !== null) return;
		const ask: MoveAsk = {
			sessionId: session.session_id,
			to: selected.to,
			keep,
			requestId: newTransferRequestId(),
		};
		askRef.current = ask;
		setSheetState({ kind: "in-flight", phase: "attempt", keep });
		void moveAttempt(client, ask).then((outcome) => settle(ask, outcome));
	};

	/** The same request, asked about again — same id, same body, so the relay
	 *  can only replay or wait-then-replay, never dial a second move
	 *  (`transfer.ts` states why the body must not change). */
	const askAgain = () => {
		const client = relay();
		const ask = askRef.current;
		if (!client || ask === null) return;
		setSheetState({ kind: "in-flight", phase: "claim", keep: ask.keep });
		void moveClaim(client, ask).then((outcome) => settle(ask, outcome));
	};

	/** The `busy` remedy: the same id with the wait ceiling — legal because a
	 *  `busy` refusal RELEASES the id, so this is a fresh claim stating its own
	 *  patience (`transfer.ts`). */
	const waitForTurn = () => {
		const client = relay();
		const ask = askRef.current;
		if (!client || ask === null) return;
		setSheetState({ kind: "in-flight", phase: "claim", keep: ask.keep });
		void moveWait(client, ask).then((outcome) => settle(ask, outcome));
	};

	const checkTheList = () => {
		void refreshList();
		onClose();
	};

	const sessionName = session ? sessionTitle(session) : "untitled";

	/* THE ACTING STATES' ACTION REGIONS LIVE IN THE SHEET'S FOOTER (round 1,
	 * D69-1). They used to ride their scrolling bodies, which put them below the
	 * fold — measured at 200 % on a 320 pt phone in every acting state, the 503's
	 * secondary even at 100 % — and the cut-edge cue never drew because
	 * `sheet.tsx` renders it only when a `footer` exists. The kit's rule is the
	 * three-region sheet ("a pinned action region that never scrolls"), and
	 * `UNSCROLLED_CONTROLS` (`tools/visual/matrix.ts`) now names these controls,
	 * so a regression that unpins one fails its capture cell by name. The pick
	 * state's non-keep consequence line rides here beside its verbs (U69-1): it
	 * is about the verb it sits over, and this placement is flagged for the
	 * design re-round rather than settled here. */
	const footerActions: SheetAction[] = (() => {
		switch (sheetState.kind) {
			case "pick":
				if (destinations.length === 0 || selected === null) return [];
				return [
					{
						label:
							selected.to === "local"
								? "Recall to this computer"
								: `Move to ${destPhrase(selected)}`,
						onPress: () => start(false),
						testID: CONTROL.sessionMoveConfirm,
					},
					{
						label:
							selected.to === "local"
								? "Copy to this computer"
								: `Copy to ${destPhrase(selected)}`,
						onPress: () => start(true),
						testID: CONTROL.sessionMoveCopy,
						variant: "outline",
					},
				];
			case "moved":
				return [
					{
						label: "Check the list",
						onPress: checkTheList,
						testID: CONTROL.sessionMoveCheck,
					},
				];
			case "busy":
				return [
					{
						label: "Wait for the turn to finish",
						onPress: waitForTurn,
						testID: CONTROL.sessionMoveWait,
					},
					{
						label: "Check the list",
						onPress: checkTheList,
						testID: CONTROL.sessionMoveCheck,
						variant: "outline",
					},
				];
			case "unconfirmed":
				return [
					{
						label: "Check the list",
						onPress: checkTheList,
						testID: CONTROL.sessionMoveCheck,
					},
					{
						label: "Ask about the same request",
						onPress: askAgain,
						testID: CONTROL.sessionMoveWait,
						variant: "outline",
					},
				];
			case "refused":
				return [
					{
						label: "Check the list",
						onPress: checkTheList,
						testID: CONTROL.sessionMoveCheck,
					},
				];
			case "in-flight":
				/* In flight there is nothing to press: the whole point of the copy is
				 * that the sheet can be closed safely, and it says so. */
				return [];
		}
	})();

	const footer =
		footerActions.length === 0 ? undefined : (
			<View className="gap-2">
				{sheetState.kind === "pick" && session !== null && selected !== null ? (
					<Text className="text-body-sm text-ink-dim">
						{retireLine(session, selected)}
					</Text>
				) : null}
				{footerActions.map((action) => (
					<Button
						key={action.testID}
						label={action.label}
						onPress={action.onPress}
						testID={action.testID}
						variant={action.variant}
					/>
				))}
			</View>
		);

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={sessionName}
			footer={footer}
		>
			{sheetState.kind === "pick" ? (
				<PickBody
					session={session}
					destinations={destinations}
					selected={selected}
					onSelect={setSelectedTo}
				/>
			) : null}
			{sheetState.kind === "in-flight" ? (
				<InFlightBody
					sessionName={sessionName}
					destination={selected}
					phase={sheetState.phase}
					keep={sheetState.keep}
				/>
			) : null}
			{sheetState.kind === "moved" ? (
				<MovedBody
					sessionName={sessionName}
					session={session}
					destination={selected}
					receipt={sheetState.receipt}
				/>
			) : null}
			{sheetState.kind === "busy" ? (
				<RefusalBody
					headline="The session is busy."
					sentence={sheetState.refusal.sentence}
					note="The move has not started. Waiting re-asks the same request for a few minutes — the move cannot start twice."
					marker={SURFACE.sessionMoveBusy}
				/>
			) : null}
			{sheetState.kind === "unconfirmed" ? (
				<RefusalBody
					headline="No answer yet — not a failure."
					sentence={sheetState.refusal.sentence}
					note="The request was sent, so whether the conversation moved is unknown from here. The list shows where it is now. Asking about the same request again can only repeat its answer or wait for a move already running — it can never start a second one."
					marker={SURFACE.sessionMoveUnconfirmed}
				/>
			) : null}
			{sheetState.kind === "refused" ? (
				<RefusalBody
					headline="That move was refused."
					sentence={sheetState.refusal.sentence}
					note="The list shows where the conversation is now — a refusal and a move that already happened can look the same from here, so the read is the answer."
					marker={SURFACE.sessionMoveRefused}
				/>
			) : null}
		</Sheet>
	);
};

/** The pick state: where it is now and the destinations; the two verbs are
 *  pinned in the sheet's footer (round 1, D69-1). */
const PickBody = ({
	session,
	destinations,
	selected,
	onSelect,
}: {
	session: SessionSummary | null;
	destinations: MoveDestination[];
	selected: MoveDestination | null;
	onSelect: (to: string) => void;
}) => {
	const accent = useTokenColor("accent");
	if (session === null) return null;
	const remote = isRemoteRow(session);
	const unreachable = remote && session.reachable === false;
	return (
		<View className="gap-4 pb-2" testID={SURFACE.sessionMoveSheet}>
			<View className="gap-1">
				<Text className="text-meta text-ink-muted">Right now</Text>
				{remote ? (
					<>
						<Text className="text-body text-ink">
							{unreachable
								? `Can't reach ${remoteDeviceLabel(session)}`
								: `On ${remoteDeviceLabel(session)}`}
						</Text>
						{unreachable ? (
							<Text
								className="text-body-sm text-ink-dim"
								testID={SURFACE.sessionRemoteUnreachable}
							>
								{session.unreachable_reason?.trim() ||
									"It did not answer when this computer asked."}
							</Text>
						) : null}
					</>
				) : (
					<Text className="text-body text-ink">On this computer</Text>
				)}
			</View>

			{destinations.length === 0 ? (
				<View className="gap-1">
					<Text className="text-body text-ink">
						No other devices are visible.
					</Text>
					<Text className="text-body-sm text-ink-dim">
						This app can offer the devices your sessions show. A device with no
						visible session cannot be picked yet — open Local Operator on the
						other computer and pull the list to refresh.
					</Text>
				</View>
			) : (
				<View className="gap-2">
					<Text className="text-meta text-ink-muted">Move or copy to</Text>
					<View accessibilityRole={ROLE.radiogroup}>
						{destinations.map((destination) => {
							const active = destination.to === selected?.to;
							return (
								<Pressable
									key={destination.to}
									accessibilityRole={ROLE.radio}
									accessibilityState={state({ selected: active })}
									onPress={() => onSelect(destination.to)}
									testID={sessionMoveDestId(destination.to)}
									className="min-h-11 flex-row items-center justify-between border-hairline border-b py-2"
								>
									<Text className="text-body text-ink">
										{destPhrase(destination)}
									</Text>
									{active ? (
										<Text style={{ color: accent }} className="text-meta">
											selected
										</Text>
									) : null}
								</Pressable>
							);
						})}
					</View>
				</View>
			)}
		</View>
	);
};

/** The in-flight state: the machine facts that ARE knowable while it runs. */
const InFlightBody = ({
	sessionName,
	destination,
	phase,
	keep,
}: {
	sessionName: string;
	destination: MoveDestination | null;
	phase: "attempt" | "claim";
	keep: boolean;
}) => {
	const where = destination ? destPhrase(destination) : "the destination";
	const verb = keep ? "Copying" : "Moving";
	return (
		<View className="gap-3 pb-2" testID={SURFACE.sessionMoveProgress}>
			<Text className="text-body text-ink">
				{verb} “{sessionName}” to {where}…
			</Text>
			{phase === "claim" ? (
				<Text className="text-body-sm text-ink-dim">
					Still waiting — the same request is being asked again, so this cannot
					run the move twice.
				</Text>
			) : (
				<Text className="text-body-sm text-ink-dim">
					{keep ? "The copy" : "The move"} runs on the computer. You can close
					this sheet; if no answer comes, the app reads the list again rather
					than repeating it.
				</Text>
			)}
		</View>
	);
};

/** The receipt: the one thing that may claim where the conversation lives;
 *  its action is pinned in the sheet's footer. */
const MovedBody = ({
	sessionName,
	session,
	destination,
	receipt,
}: {
	sessionName: string;
	session: SessionSummary | null;
	destination: MoveDestination | null;
	receipt: TransferReceipt;
}) => {
	const where = destination ? destPhrase(destination) : "the destination";
	const source =
		session && isRemoteRow(session)
			? remoteDeviceLabel(session)
			: "this computer";
	const headline =
		receipt.mode === "keep"
			? `Copied to ${where}.`
			: destination?.to === "local"
				? "Recalled to this computer."
				: `Moved to ${where}.`;
	return (
		<View className="gap-3 pb-2" testID={SURFACE.sessionMoveReceipt}>
			<Text className="text-body text-ink">{headline}</Text>
			<Text className="text-body-sm text-ink-dim">
				{receipt.mode === "keep"
					? `“${sessionName}” stays on ${source} too — the copy is a new conversation.`
					: `“${sessionName}” is no longer on ${source}.`}
			</Text>
			<View className="gap-2">
				<Text className="text-meta text-ink-muted">Steps</Text>
				{receipt.phases.map((phase) => (
					<View
						key={`${phase.phase}-${String(phase.progress)}`}
						className="flex-row items-center gap-2"
					>
						<Text className="w-24 text-body-sm text-ink">
							{PHASE_WORDS[phase.phase] ?? phase.phase}
						</Text>
						<PhaseBar progress={phase.progress} />
						<Text className="w-12 text-right text-meta text-ink-dim">
							{Math.round(Math.max(0, Math.min(1, phase.progress)) * 100)}%
						</Text>
					</View>
				))}
			</View>
		</View>
	);
};

/** One phase's step on the monotone list, as a small track. */
const PhaseBar = ({ progress }: { progress: number }) => {
	const fill = useTokenColor("accent");
	const clamped = Math.max(0, Math.min(1, progress));
	return (
		<View className="h-1 flex-1 overflow-hidden rounded-full bg-ink-dim/20">
			<View
				className="h-1 rounded-full"
				style={{
					width: `${Math.round(clamped * 100)}%`,
					backgroundColor: fill,
				}}
			/>
		</View>
	);
};

/** The three refusal-shaped states share one body: the relay's own sentence
 *  and this sheet's reading of it. The actions are pinned in the sheet's
 *  footer (round 1, D69-1). */
const RefusalBody = ({
	headline,
	sentence,
	note,
	marker,
}: {
	headline: string;
	sentence: string;
	note: string;
	marker: string;
}) => (
	<View className="gap-3 pb-2" testID={marker}>
		<Text className="text-body text-ink">{headline}</Text>
		<Text className="text-body-sm text-ink">{sentence}</Text>
		<Text className="text-body-sm text-ink-dim">{note}</Text>
	</View>
);
