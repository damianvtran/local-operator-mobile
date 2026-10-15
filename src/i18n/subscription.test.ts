import { describe, expect, it } from "vitest";

import { createConfigStore } from "../state/config-store";
import { localeSource } from "./subscription";

describe("backend configStore is the only locale owner", () => {
	it("observes baseline, live changes, route reset and unsubscribe", () => {
		const store = createConfigStore();
		const source = localeSource(store);
		const seen: string[] = [];
		expect(source.getSnapshot()).toBe("en");
		const stop = source.subscribe(() => seen.push(source.getSnapshot()));
		store.getState().applyFrame({ language: "fr", changed_keys: [] });
		store.getState().applyFrame({ language: "ru", changed_keys: ["language"] });
		store.getState().reset();
		expect(seen).toEqual(["fr", "ru", "en"]);
		expect(source.getSnapshot()).toBe("en");
		stop();
		store.getState().applyFrame({ language: "vi", changed_keys: ["language"] });
		expect(seen).toEqual(["fr", "ru", "en"]);
	});

	it("absence and diagnostic-only frames do not emit a false locale change", () => {
		const store = createConfigStore();
		const source = localeSource(store);
		let calls = 0;
		const stop = source.subscribe(() => calls++);
		store.getState().markAbsent();
		store.getState().markSupported();
		store.getState().applyFrame({ language: "en", changed_keys: [] });
		store.getState().applyFrame({ language: "en", changed_keys: [] });
		expect(calls).toBe(0);
		stop();
	});
});
