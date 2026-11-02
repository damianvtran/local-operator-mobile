import { describe, expect, it, vi } from "vitest";
import { createPushLifecycle } from "@/team-bridge/push-lifecycle";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("push registration retirement ordering", () => {
	it("drains an authenticated PUT before DELETE, so it cannot resurrect a signed-out row", async () => {
		const accepted = deferred();
		const calls: string[] = [];
		let exists = false;
		const lifecycle = createPushLifecycle({
			register: async () => {
				calls.push("PUT started");
				await accepted.promise;
				exists = true;
				calls.push("PUT committed");
			},
			unregister: async () => {
				exists = false;
				calls.push("DELETE");
			},
		});
		lifecycle.activate();
		const put = lifecycle.register();
		await Promise.resolve();
		const retirement = lifecycle.retire();
		await lifecycle.register(); // a foreground callback after sign-out is inert
		expect(calls).toEqual(["PUT started"]);
		accepted.resolve();
		await Promise.all([put, retirement]);
		expect(calls).toEqual(["PUT started", "PUT committed", "DELETE"]);
		expect(exists).toBe(false);
	});

	it("new-account registration queues after old-account cleanup", async () => {
		const deletion = deferred();
		const calls: string[] = [];
		const lifecycle = createPushLifecycle({
			register: async () => {
				calls.push("PUT");
			},
			unregister: async () => {
				calls.push("DELETE start");
				await deletion.promise;
				calls.push("DELETE end");
			},
		});
		lifecycle.activate();
		await lifecycle.register();
		const retirement = lifecycle.retire();
		lifecycle.activate();
		const next = lifecycle.register();
		await Promise.resolve();
		expect(calls).toEqual(["PUT", "DELETE start"]);
		deletion.resolve();
		await Promise.all([retirement, next]);
		expect(calls).toEqual(["PUT", "DELETE start", "DELETE end", "PUT"]);
	});

	it("coalesces foreground/token callbacks, rejects admission when suspended", async () => {
		const accepted = deferred();
		const register = vi.fn(async () => accepted.promise);
		const lifecycle = createPushLifecycle({
			register,
			unregister: async () => {},
		});
		await lifecycle.register();
		expect(register).not.toHaveBeenCalled();
		lifecycle.activate();
		const a = lifecycle.register();
		const b = lifecycle.register();
		accepted.resolve();
		await Promise.all([a, b]);
		expect(register).toHaveBeenCalledTimes(1);
		lifecycle.suspend();
		await lifecycle.register();
		expect(register).toHaveBeenCalledTimes(1);
	});

	it("a failed PUT cannot poison the serialized DELETE", async () => {
		const unregister = vi.fn(async () => {});
		const lifecycle = createPushLifecycle({
			register: async () => {
				throw new Error("network");
			},
			unregister,
		});
		lifecycle.activate();
		await expect(lifecycle.register()).rejects.toThrow("network");
		await lifecycle.retire();
		expect(unregister).toHaveBeenCalledTimes(1);
	});
});
