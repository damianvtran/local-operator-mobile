import { useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";

import type { PushDeviceRow } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import { deviceStateDescription, deviceTitle } from "@/notifications/devices";
import { readAvailability, requestPermission } from "@/notifications/native";
import {
	availabilityFromHook,
	canRequestPermission,
	PUSH_COPY,
	PUSH_ENABLE_LABEL,
	type PushAvailability,
} from "@/notifications/permission";
import { isRelayError } from "@/relay";
import { CONTROL, REGION } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { SectionHeader } from "@/ui/components/section-header";

/**
 * Notifications, in Settings, where the toggle is (ADR 0006 §2.4/§5).
 *
 * Three facts, each rendered only when it is known:
 *
 *  1. **The permission state**, in the app's own vocabulary
 *     (`notifications/permission.ts`), with the enable control present ONLY
 *     while the OS has not been asked. The prompt fires from the press, never
 *     from a mount — "requested in context, with the §2.4 copy already on
 *     screen" — and a build without the module says so instead of offering a
 *     toggle that cannot work.
 *  2. **This computer's registered devices**, read from `GET /api/push/devices`
 *     (read-only: opening Settings bumps nothing). A relay that predates the
 *     route answers a refusal, and that is rendered as its own sentence rather
 *     than as an empty list — "no devices" and "cannot read the list" are
 *     different facts, and the second must not borrow the first's words.
 *  3. **Nothing promised.** There is no registration call in this build (the
 *     cloud forward is S7, unbuilt; manager decision 2026-10-03), so no state
 *     here claims a delivery that cannot happen — the `granted` copy names the
 *     missing half instead ("Background alerts are not switched on for this
 *     computer yet").
 *
 * On the web target the permission read is the platform's `unsupported`, or —
 * for the harness only — the `lo-notifications` query value, the same
 * convention as `lo-relay`/`lo-conversation`: a URL can steer the page and
 * never the installed app (`permission.ts`'s hook note explains why the design
 * round needs it).
 */

const hookAvailability = (): PushAvailability | null => {
	if (Platform.OS !== "web" || typeof location === "undefined") return null;
	return availabilityFromHook(
		new URLSearchParams(location.search).get("lo-notifications"),
	);
};

type DeviceListState =
	| { kind: "loading" }
	| { kind: "ready"; devices: PushDeviceRow[] }
	/** The relay answered a refusal that says the route is not there. */
	| { kind: "unsupported" }
	/** The read failed for another reason — do not claim the route is absent. */
	| { kind: "error" };

export const NotificationsSection = () => {
	const { relay } = useConnection();
	const [availability, setAvailability] = useState<PushAvailability | null>(
		null,
	);
	const [requesting, setRequesting] = useState(false);
	const [deviceList, setDeviceList] = useState<DeviceListState>({
		kind: "loading",
	});

	useEffect(() => {
		const hooked = hookAvailability();
		if (hooked !== null) {
			setAvailability(hooked);
			return;
		}
		let cancelled = false;
		void readAvailability().then((next) => {
			if (!cancelled) setAvailability(next);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const loadDevices = useCallback(async () => {
		const client = relay();
		if (client === null) {
			setDeviceList({ kind: "error" });
			return;
		}
		try {
			const payload = await client.pushDevices();
			setDeviceList({ kind: "ready", devices: payload.devices });
		} catch (error) {
			/* A 404 is a relay older than the route (S4a); anything else is a
			 * read that failed on a relay that may well have it. The two
			 * sentences differ because the facts do. */
			setDeviceList({
				kind:
					isRelayError(error) && error.status === 404 ? "unsupported" : "error",
			});
		}
	}, [relay]);

	useEffect(() => {
		void loadDevices();
	}, [loadDevices]);

	const onEnable = useCallback(async () => {
		setRequesting(true);
		try {
			setAvailability(await requestPermission());
		} finally {
			setRequesting(false);
		}
	}, []);

	return (
		<View className="gap-2" testID={REGION.settingsNotifications}>
			<SectionHeader label="Notifications" />
			{/* The state sentence. `null` is the read in flight — one line, no
			 *  spinner: Settings is a static screen and a spinner here would be
			 *  furniture. */}
			<Text className="text-body-sm text-ink-muted">
				{availability === null
					? "Checking this phone's notification settings."
					: PUSH_COPY[availability]}
			</Text>
			{availability !== null && canRequestPermission(availability) ? (
				<Button
					testID={CONTROL.settingsNotificationsEnable}
					label={PUSH_ENABLE_LABEL}
					onPress={() => void onEnable()}
					disabled={requesting}
					variant="outline"
					size="sm"
				/>
			) : null}
			{/* The registered-device lines. The list is read-only here; removing a
			 *  device is a destructive act with its own confirm flow and is not
			 *  wired in this build. */}
			{deviceList.kind === "loading" ? (
				<Text className="text-body-sm text-ink-dim">
					Checking this computer's registered devices.
				</Text>
			) : deviceList.kind === "unsupported" ? (
				<Text className="text-body-sm text-ink-dim">
					This computer's relay does not support notifications yet.
				</Text>
			) : deviceList.kind === "error" ? (
				<Text className="text-body-sm text-ink-dim">
					Could not read this computer's registered devices.
				</Text>
			) : deviceList.devices.length === 0 ? (
				<Text className="text-body-sm text-ink-dim">
					No devices are registered with this computer yet.
				</Text>
			) : (
				deviceList.devices.map((device) => (
					<View key={device.device_id} className="gap-1">
						<Text className="text-body-sm text-ink">{deviceTitle(device)}</Text>
						<Text className="text-body-sm text-ink-dim">
							{deviceStateDescription(device.state)}
						</Text>
					</View>
				))
			)}
		</View>
	);
};
