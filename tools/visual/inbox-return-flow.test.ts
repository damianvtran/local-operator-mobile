import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createNotificationsStore } from "../mock-relay/notifications.ts";
import { inboxRowProbe, matchesInboxRow } from "./inbox-return-flow.ts";

/** Every file this suite reads, resolved from the suite's own directory. */
const path = (relative: string) => new URL(relative, import.meta.url);

const flow = readFileSync(path("inbox-return-flow.ts"), "utf8");
const capture = readFileSync(path("capture.ts"), "utf8");
const relayDriver = readFileSync(path("../lib/relay.ts"), "utf8");
const mockRelay = readFileSync(path("../mock-relay/relay.ts"), "utf8");
const nativeFlow = readFileSync(
	new URL(
		"../../e2e/maestro/flows/11-notification-return.yaml",
		import.meta.url,
	),
	"utf8",
);
const workflow = readFileSync(
	new URL("../../.github/workflows/e2e.yml", import.meta.url),
	"utf8",
);
const whitespace = /\s+/g;
const historyWarp = /history\.(back|go|pushState|replaceState)\s*\(/;
const locationWarp = /location\.(href|pathname)\s*=/;

describe("the bounded hosted inbox return proof", () => {
	it("distinguishes a stale unread row, a read row, and an absent row", () => {
		expect(matchesInboxRow({ present: true, unread: true }, "read")).toBe(
			false,
		);
		expect(matchesInboxRow({ present: true, unread: false }, "read")).toBe(
			true,
		);
		expect(matchesInboxRow({ present: false, unread: false }, "read")).toBe(
			false,
		);
		expect(matchesInboxRow({ present: true, unread: false }, "gone")).toBe(
			false,
		);
		expect(matchesInboxRow({ present: false, unread: false }, "gone")).toBe(
			true,
		);
		expect(inboxRowProbe).toContain("getComputedStyle");
	});
	it("uses controls on a reused browser, with before/after artifacts outside the matrix", () => {
		expect(flow).toContain('for (const theme of ["light", "dark"])');
		expect(flow).toContain("for (const undo of [false, true])");
		expect(flow).toContain("press(CONTROL.inboxDetailBack)");
		expect(flow).toContain("press(CONTROL.inboxDismissAllUndo)");
		expect(flow).toContain("press(CONTROL.dialogConfirm)");
		expect(historyWarp.test(flow)).toBe(false);
		expect(locationWarp.test(flow)).toBe(false);
		expect(capture.replace(whitespace, " ")).toContain(
			'join( options.out, "inbox-return",',
		);
		expect(capture).toContain("180_000");
		expect(workflow).toContain("--inbox-return-proof");
		expect(workflow).toContain("baseline=(--inbox-baseline-dir");
		expect(workflow).toContain("name: audit-frames");
	});
	it("proves the failure, ledger and selection returns, not only the happy path", () => {
		/* Each of these is a cell QA round 1 recorded as BLOCKED. A driver that only
		 * re-reads on a healthy return would still pass a green run, so the cells are
		 * asserted HERE as a contract on the driver rather than left to the run. */
		expect(flow).toContain("/__mock/inbox-return");
		expect(flow).toContain("SURFACE.inboxError");
		expect(flow).toContain("SURFACE.inboxLoading");
		expect(flow).toContain("All caught up");
		expect(flow).toContain("inboxRetry");
		expect(flow).toContain("inboxSelectionBar");
		expect(flow).toContain("readRelayRecord");
		/* The failure door and the ledger exist on the RELAY, not in the flow's own
		 * head: a driver calling a control the mock does not serve fails at runtime. */
		expect(mockRelay).toContain('"/__mock/inbox-return"');
		expect(mockRelay).toContain("failNextNotificationList");
		expect(relayDriver).toContain("readRelayRecord");
		/* Native half: a real Back press on a device, and no history call standing in
		 * for it — the same rule the hosted flow is held to. */
		expect(nativeFlow).toContain('id: "notification-back"');
		expect(nativeFlow).toContain('id: "notification-row-n_audit"');
		expect(nativeFlow).toContain('id: "notification-dismiss-all"');
		expect(nativeFlow).toContain('id: "dialog-confirm"');
		expect(nativeFlow).toContain('id: "notifications-empty"');
		expect(historyWarp.test(nativeFlow)).toBe(false);
		expect(locationWarp.test(nativeFlow)).toBe(false);
	});
	it("derives 5 → 4 → 2 → 4 from the existing fixture, including the other conversation", () => {
		const seed = JSON.parse(
			readFileSync(
				new URL(
					"../../fixtures/relay/synthetic/notifications-populated.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		const store = createNotificationsStore({ seed, details: {} });
		const page = () =>
			store.page("all", 100) as unknown as {
				items: Array<{ id: string; revision: number; session: { id: string } }>;
				unread_count: number;
				waiting_unread_count: number;
			};
		const count = () => page().unread_count + page().waiting_unread_count;
		expect(count()).toBe(5);
		const opened = page().items.find((i) => i.id === "n_audit");
		expect(opened).toBeDefined();
		expect(
			store.patch({
				op: "read",
				ids: [{ id: opened?.id, revision: opened?.revision }],
			}).ok,
		).toBe(true);
		expect(count()).toBe(4);
		const targets = page()
			.items.filter((i) => i.session.id === opened?.session.id)
			.map(({ id, revision }) => ({ id, revision }));
		expect(targets).toHaveLength(4);
		expect(store.patch({ op: "dismiss", ids: targets }).ok).toBe(true);
		expect(page().items.map((i) => i.id)).toEqual(["n_fraud"]);
		expect(count()).toBe(2);
		expect(store.patch({ op: "undismiss", ids: targets }).ok).toBe(true);
		expect(page().items).toHaveLength(5);
		expect(count()).toBe(4);
	});
});
