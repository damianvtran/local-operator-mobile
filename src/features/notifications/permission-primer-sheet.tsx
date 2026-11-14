import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useStore } from "zustand";

import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import { t } from "@/i18n";
import { readAvailability, requestPermission } from "@/notifications/native";
import {
	acceptPrimer,
	completedTurnObserved,
	devicePrimerRecords,
	dismissPrimer,
	evaluatePrimer,
	HOME_PATH,
	markPrimerMoment,
	primerMomentStore,
	primerSheetVisible,
} from "@/notifications/permission-primer";
import {
	LIVE_PHASES,
	requestSessionPushRegistration,
} from "@/notifications/use-session-push-registration";
import { useTeamBridge } from "@/team-bridge/provider";
import { CONTROL } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Sheet } from "@/ui/components/sheet";

/* The primer is offered, and shown, only on Home (`HOME_PATH`): it is where a
 * usable computer is first reached (after sign-in or a cold-start restore),
 * and keeping it off the session screen means it never stacks on that
 * screen's own sheets (`primerSheetVisible`). */

const PRIMER_DEPS = {
	platform: Platform.OS,
	readAvailability,
	records: devicePrimerRecords,
	now: () => Date.now(),
};

/**
 * The first-run notification primer (operator request, 2026-11-14; ADR 0006 §5
 * as amended): one sheet, in context, that says what notifications bring and
 * asks before the OS does. Every rule about WHEN lives in
 * `notifications/permission-primer.ts`; this component supplies the context
 * (Home, a live route), watches the list for the completed-turn moment the
 * single re-offer waits for, and wires the two answers.
 *
 * Mounted once at the root, beside the other always-on hosts, so it reads the
 * route and list through the existing selectors and never edits the screens or
 * the connection provider. It evaluates at most twice a run — on first reaching
 * Home with a live computer, and again once a turn has completed — because each
 * evaluation reads the keystore and the OS permission.
 */
export const NotificationPermissionPrimer = () => {
	const pathname = usePathname();
	const live = useConnectionState(
		(s) => s.route !== null && LIVE_PHASES.includes(s.phase),
	);
	const { radientSignedIn } = useConnection();
	const { registerPush } = useTeamBridge();
	const sessions = useListState((s) => s.sessions);
	const generation = useListState((s) => s.connectionGeneration);
	const moment = useStore(primerMomentStore, (s) => s.turnCompleted);
	const [visible, setVisible] = useState(false);
	const [requesting, setRequesting] = useState(false);

	/* The completed-turn moment. Compared within one connection generation
	 * only: a reconnect repaints the list wholesale, and a row that was
	 * streaming on the old connection is not a turn the reader saw finish. */
	const previous = useRef<{ generation: number; rows: typeof sessions }>({
		generation,
		rows: sessions,
	});
	useEffect(() => {
		const last = previous.current;
		if (
			last.generation === generation &&
			completedTurnObserved(last.rows, sessions)
		)
			markPrimerMoment();
		previous.current = { generation, rows: sessions };
	}, [generation, sessions]);

	/* Which moments this run has already evaluated (false = first arrival,
	 * true = after a completed turn), so re-renders never re-read storage. */
	const evaluated = useRef(new Set<boolean>());
	useEffect(() => {
		if (Platform.OS !== "ios" && Platform.OS !== "android") return;
		if (!live || pathname !== HOME_PATH || evaluated.current.has(moment))
			return;
		evaluated.current.add(moment);
		let cancelled = false;
		void evaluatePrimer(PRIMER_DEPS)
			.then((offer) => {
				if (offer && !cancelled) setVisible(true);
			})
			.catch(() => {
				/* A keystore that cannot be read or written must not show a sheet
				 * whose dismissal it cannot remember: Settings stays the path. */
			});
		return () => {
			cancelled = true;
		};
	}, [live, pathname, moment]);

	const onNotNow = useCallback(() => {
		setVisible(false);
		void dismissPrimer(PRIMER_DEPS).catch(() => undefined);
	}, []);

	const onEnable = useCallback(async () => {
		setRequesting(true);
		try {
			await acceptPrimer({
				requestPermission,
				registerSession: requestSessionPushRegistration,
				radientSignedIn,
				registerTeamBridge: () => registerPush().catch(() => undefined),
			});
		} finally {
			setRequesting(false);
			// Whatever the OS answered, the question is settled: a grant is
			// registered, a denial is final and Settings carries its remedy.
			setVisible(false);
		}
	}, [radientSignedIn, registerPush]);

	return (
		<Sheet
			visible={primerSheetVisible(visible, pathname)}
			onClose={onNotNow}
			title={t("mobile.notifications.primer.title")}
			titleLines={2}
			testID={CONTROL.notificationPrimer}
			footer={
				<View className="gap-2">
					<Button
						testID={CONTROL.notificationPrimerEnable}
						label={t("mobile.notifications.primer.enable")}
						onPress={() => void onEnable()}
						disabled={requesting}
					/>
					<Button
						testID={CONTROL.notificationPrimerNotNow}
						label={t("mobile.notifications.primer.not_now")}
						onPress={onNotNow}
						disabled={requesting}
						variant="quiet"
					/>
				</View>
			}
		>
			{/* One short line, then the buttons (operator, 2026-11-14): most
			 *  readers never open Settings, so the sheet sells the default and
			 *  explains nothing else. */}
			<View className="py-2">
				<Text className="text-body text-ink">
					{t("mobile.notifications.primer.body")}
				</Text>
			</View>
		</Sheet>
	);
};
