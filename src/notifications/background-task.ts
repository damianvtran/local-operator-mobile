import { Platform } from "react-native";

import {
	type BackgroundClearDeps,
	BackgroundResult,
	runBackgroundClear,
	waitForBackgroundUnreadScope,
} from "@/notifications/background-clear";
import { loadNotifications } from "@/notifications/native";

/**
 * The background notification task: the native half of `background-clear.ts`.
 *
 * WHY MODULE SCOPE. expo-task-manager runs a task by name the moment the OS
 * hands the app a push, possibly in a process that launched for nothing else.
 * The task must already be DEFINED when the bundle finishes loading, or the
 * event is dropped with "task not defined" (expo-notifications
 * `registerTaskAsync` docs). So `defineTask` runs as a side effect of importing
 * this module, and `app/_layout.tsx` imports it first thing.
 *
 * WHY `require`, NOT A TOP-LEVEL IMPORT. `team-bridge/provider.tsx` imports
 * `registerBackgroundNotificationTask` from here, so this module sits in the
 * provider's import graph, which Node-run tests load. `expo-task-manager`
 * pulls in `expo-modules-core`, which throws `__DEV__ is not defined` at import
 * outside a React Native runtime (review R1-M1: it broke
 * `provider-account-switch.test.ts`). Loading it synchronously INSIDE the
 * non-web guard keeps the definition at module scope (still before the bundle
 * settles) while keeping the native module out of every web/Node graph. The
 * `typeof import(...)` annotation is type-only and erased. Do not hoist it back
 * to a value import: `src/team-bridge/__tests__/background-task-import.test.ts`
 * guards this.
 *
 * Registration (`registerTaskAsync`) is separate and asynchronous: it tells the
 * native side to route remote notifications to the named task, and it persists
 * across launches. The provider calls it on every entry into its signed-in
 * branch (sign-in, account switch, cold start); repeating it is harmless
 * because it is idempotent.
 *
 * iOS: runs for the silent attention push because `UIBackgroundModes` declares
 * `remote-notification` (app.config.ts). Android: a data-only FCM message
 * reaches `onMessageReceived`, which runs every registered task
 * (`FirebaseMessagingDelegate.kt:107-114`), but the clear only happens WARM
 * (backgrounded, not killed): a killed app runs the task headless with no
 * Activity and no React root, so `AccountTeamBridgeProvider` never mounts, no
 * scope registers, and the task waits `SCOPE_WAIT_MS` and returns NoData (the
 * next foreground open corrects the badge as before). Web has neither: nothing
 * is defined.
 */

export const BACKGROUND_NOTIFICATION_TASK = "local-operator.background-push";

const nativeDeps: BackgroundClearDeps = {
	scope: waitForBackgroundUnreadScope,
	async presented() {
		const module = await loadNotifications();
		if (module === null) return [];
		const delivered = await module.getPresentedNotificationsAsync();
		return delivered.map((notification) => ({
			identifier: notification.request.identifier,
			data: notification.request.content.data,
		}));
	},
	async dismiss(identifier) {
		const module = await loadNotifications();
		if (module !== null) await module.dismissNotificationAsync(identifier);
	},
};

if (Platform.OS !== "web") {
	try {
		const TaskManager: typeof import("expo-task-manager") = require("expo-task-manager");
		TaskManager.defineTask(
			BACKGROUND_NOTIFICATION_TASK,
			async ({ data, error }) => {
				// A task error is the OS's, not the push's; there is nothing to clear.
				if (error) return BackgroundResult.NoData;
				// `data` is the NotificationTaskPayload: `{data: {body, dataString,
				// …}, notification, aps?}` on iOS (userInfo minus `aps`) and the
				// serialized RemoteMessage on Android (`RemoteMessageSerializer`).
				return runBackgroundClear(data, nativeDeps);
			},
		);
	} catch {
		// A binary without the task-manager module: the foreground path still
		// corrects the badge on the next open, as it did before this task.
	}
}

/** Route remote notifications to the task. Best effort, never throws. */
export async function registerBackgroundNotificationTask(): Promise<void> {
	if (Platform.OS === "web") return;
	try {
		const module = await loadNotifications();
		if (module === null) return;
		await module.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
	} catch {
		/* Same degradation as above: no background clear, nothing else lost. */
	}
}
