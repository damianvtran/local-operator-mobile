import { describe, expect, it } from "vitest";

import {
	inboxWriteRevision,
	noteInboxWrite,
	onInboxWrite,
} from "./inbox-writes";

describe("the settled-write signal the inbox list re-reads on", () => {
	it("tells a subscriber once per settled write, and stops on unsubscribe", () => {
		const before = inboxWriteRevision();
		let heard = 0;
		const stop = onInboxWrite(() => {
			heard += 1;
		});
		noteInboxWrite();
		noteInboxWrite();
		expect(heard).toBe(2);
		expect(inboxWriteRevision()).toBe(before + 2);
		stop();
		noteInboxWrite();
		expect(heard).toBe(2);
	});
});
