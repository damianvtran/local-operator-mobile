/** `hydrate()`: a warm-cache frame is shown as not live, never blocks a live
 *  frame, and never overwrites one. */
import { describe, expect, it } from "vitest";

import type { SessionProjection } from "../../contracts";
import { parsePayload } from "../../contracts";
import { loadFixture } from "../../testing/fixtures";
import { createProjectionStore, isSessionViewStale, readEntry } from "../index";

const projection = (version: number, text = "x"): SessionProjection => {
	const base = parsePayload(
		"sessionProjection",
		loadFixture<{ data: unknown }>("sse/sse-projection-live-idle.json").data,
	);
	return { ...base, version, conversation_name: text };
};

describe("projection store hydrate", () => {
	it("paints a cached frame as not connected, awaiting its snapshot", () => {
		const store = createProjectionStore();
		expect(store.getState().hydrate("h1", projection(0, "cached"))).toBe(true);
		const entry = readEntry(store.getState(), "h1");
		expect(entry.projection?.conversation_name).toBe("cached");
		expect(entry.connected).toBe(false);
		expect(entry.awaitingSnapshot).toBe(true);
		expect(entry.hydrated).toBe(true);
		expect(entry.version).toBeNull();
		expect(isSessionViewStale({ entry })).toBe(true);
	});

	it("an opened stream does not make a hydrated entry live; its first frame does, even with a LOWER version", () => {
		const store = createProjectionStore();
		store.getState().hydrate("h2", projection(900, "cached"));
		store.getState().beginStream("h2");
		expect(readEntry(store.getState(), "h2").connected).toBe(false);
		expect(store.getState().applyFrame("h2", projection(3, "live"))).not.toBe(
			"dropped-older",
		);
		const entry = readEntry(store.getState(), "h2");
		expect(entry.projection?.conversation_name).toBe("live");
		expect(entry.connected).toBe(true);
		expect(entry.awaitingSnapshot).toBe(false);
		expect(entry.hydrated).toBeFalsy();
	});

	it("never overwrites a live projection", () => {
		const store = createProjectionStore();
		store.getState().beginStream("h3");
		store.getState().applyFrame("h3", projection(5, "live"));
		expect(store.getState().hydrate("h3", projection(0, "cached"))).toBe(false);
		const entry = readEntry(store.getState(), "h3");
		expect(entry.projection?.conversation_name).toBe("live");
		expect(entry.connected).toBe(true);
		expect(entry.hydrated).toBeFalsy();
	});
});
