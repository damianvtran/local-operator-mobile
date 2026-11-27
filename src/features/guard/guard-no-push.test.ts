import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NOTIFICATION_CATEGORY_IDS } from "@/notifications/categories";

/**
 * "Radient Guard sends no push notification" (RFC v0.9 §5.2.3, slice M1).
 *
 * A negative about code that must not exist, so the proof is a scan of the
 * Guard feature's own source plus the registries a notification would have to
 * be added to. Three independent ways to break the rule are pinned:
 *
 *  1. the feature imports a notification API (local scheduling, presenting a
 *     notification, requesting permission) or the app's `@/notifications` layer;
 *  2. the feature registers a notification category or channel of its own;
 *  3. the request is made a notification-STORE item (the store the relay's push
 *     pipeline reads) — the inbox row is drawn from the Guard status instead.
 *
 * What this cannot prove: that the HOST sends no push for Guard. That is the
 * host's side of the contract (`docs/guard.md`) and is asserted there.
 */
const HERE = __dirname;
const guardSources = [
	...readdirSync(HERE)
		.filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
		.map((name) => join(HERE, name)),
	join(HERE, "..", "settings", "guard-section.tsx"),
	join(HERE, "..", "notifications", "guard-inbox.tsx"),
];
const code = (file: string) =>
	readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("Guard never notifies", () => {
	it("the scan covers the feature (a moved file must not empty the check)", () => {
		const names = guardSources.map((file) => file.split("/").pop());
		for (const expected of [
			"guard-controller.ts",
			"guard-model.ts",
			"guard-views.tsx",
			"use-guard.ts",
			"guard-section.tsx",
			"guard-inbox.tsx",
		])
			expect(names).toContain(expected);
	});

	it.each(guardSources)("%s imports no notification API", (file) => {
		const source = code(file);
		expect(source).not.toMatch(/expo-notifications/);
		expect(source).not.toMatch(/from\s+["']@\/notifications/);
		expect(source).not.toMatch(
			/schedulePushNotification|scheduleNotificationAsync|presentNotification|setNotificationHandler|requestPermission/,
		);
	});

	it.each(guardSources)(
		"%s never touches the notification store's writes",
		(file) => {
			const source = code(file);
			expect(source).not.toMatch(
				/\.notifications?\(|patchNotifications|markNotification|notifyInbox/,
			);
		},
	);

	it("no notification category or channel is named for Guard", () => {
		for (const id of NOTIFICATION_CATEGORY_IDS)
			expect(String(id)).not.toMatch(/guard/i);
	});

	it("the pinned row is not a notification-store item", () => {
		const source = code(join(HERE, "..", "notifications", "guard-inbox.tsx"));
		expect(source).not.toMatch(
			/NotificationItem|inboxSections|useNotifications\b/,
		);
		expect(source).toMatch(/guardStatus|useGuardController/);
	});
});
