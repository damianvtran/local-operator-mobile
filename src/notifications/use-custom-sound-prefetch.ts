/** Foreground-only prefetch, not a notification handler or second setting.
 * A backgrounded phone intentionally keeps the cloud's always-playable fallback
 * until it next opens. We reuse the live paired relay and its config stream;
 * no credentials, user labels or tunnel URLs ever enter a push payload or log.
 */
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import {
	configStore,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { CustomSoundCache } from "./custom-sound-cache";
import { openSoundDisk } from "./custom-sound-native";
import { onPushRegistration, readInstallRecord } from "./install-id";

// One transaction queue across route changes: different computers share the
// device's sound namespace and must not race on eviction or the staging file.
let transaction = Promise.resolve();
export const useCustomSoundPrefetch = (): void => {
	const { relay } = useConnection();
	const route = useConnectionState((s) => s.route);
	const phase = useConnectionState((s) => s.phase);
	useEffect(() => {
		if (Platform.OS !== "ios" && Platform.OS !== "android") return;
		if (!route || !["live", "degraded", "re-minting"].includes(phase)) return;
		let stopped = false;
		let pending = false;
		let again = false;
		let withdraw: (() => Promise<void>) | undefined;
		const trigger = (): void => {
			if (stopped) return;
			if (pending) {
				again = true;
				return;
			}
			pending = true;
			transaction = transaction
				.then(async () => {
					if (stopped) return;
					const client = relay();
					const record = await readInstallRecord();
					// No registration here: `use-session-push-registration` owns it. Without THIS computer's
					// valid key the daemon refuses readiness; failure leaves fallback.
					const deviceKey = record?.device_key;
					if (!client || !record || !deviceKey) return;
					const disk = await openSoundDisk();
					if (!disk || stopped) return;
					const crypto = await import("expo-crypto");
					const identity =
						route.mode === "radient"
							? `radient:${route.tunnelId}`
							: `custom:${route.baseUrl}`;
					const scope = await crypto.digestStringAsync(
						crypto.CryptoDigestAlgorithm.SHA256,
						identity,
					);
					withdraw = async () => {
						await client.noteNotificationSoundCache(
							record.install_id,
							deviceKey,
							[],
						);
						await disk.claim(scope, []);
					};
					await new CustomSoundCache({
						scope,
						disk,
						now: Date.now,
						digest: async (bytes) => {
							const hash = await crypto.digest(
								crypto.CryptoDigestAlgorithm.SHA256,
								new Uint8Array(bytes).buffer,
							);
							return Array.from(new Uint8Array(hash), (b) =>
								b.toString(16).padStart(2, "0"),
							).join("");
						},
						relay: {
							listing: () => client.notificationSounds(),
							audio: (id, sha) => client.notificationSoundAudio(id, sha),
							report: (stems) =>
								client.noteNotificationSoundCache(
									record.install_id,
									deviceKey,
									stems,
								),
						},
					}).sync();
				})
				.catch(() => {
					// Missing old-daemon routes, revoked keys, offline/unsupported
					// devices and failed native writes all retain soft-pulse. Do not
					// log arbitrary transport/native errors: they can contain secrets.
				})
				.finally(() => {
					pending = false;
					if (again && !stopped) {
						again = false;
						trigger();
					}
				});
		};
		trigger();
		const foreground = AppState.addEventListener("change", (state) => {
			if (state === "active") trigger();
		});
		const config = configStore.subscribe((next, prev) => {
			if (
				next.frameCount !== prev.frameCount &&
				next.changedKeys.some((key) => key.startsWith("notifications.sound."))
			)
				trigger();
		});
		const registration = onPushRegistration(trigger);
		return () => {
			stopped = true;
			foreground.remove();
			config();
			registration();
			// Best-effort withdrawal on route retirement; NEVER delete local
			// bytes here. Offline or revoked old grants leave conservative claims
			// pinned until that computer can acknowledge a withdrawal.
			transaction = transaction
				.then(async () => {
					await withdraw?.();
				})
				.catch(() => {});
		};
	}, [relay, route, phase]);
};
