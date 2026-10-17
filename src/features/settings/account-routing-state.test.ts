import { describe, expect, it } from "vitest";
import { type Payload, parsePayload } from "@/contracts";
import { RelayError } from "@/relay";
import backendProjection from "./__fixtures__/account-routing.core.json";
import { createAccountRoutingEditor } from "./account-routing-state";

type Projection = Payload<"accountRouting">;
function payload(value?: string): Projection {
	const result = parsePayload(
		"accountRouting",
		structuredClone(backendProjection),
	);
	if (value !== undefined) {
		result.setting.value = value;
		result.setting.is_default = value === result.setting.default;
	}
	return result;
}
function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("promise not initialized");
	};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("missing expected fixture entry");
	return value;
}
const nextChoice = () => required(payload().setting.choices[1]).value;

describe("ephemeral selected-route account-routing state (Node, not native renderer proof)", () => {
	it("starts unread and uses backend metadata, including a future choice", async () => {
		const read = deferred<Projection>();
		const editor = createAccountRoutingEditor({
			accountRouting: () => read.promise,
			setAccountRouting: async () => payload(),
		});
		const opening = editor.activate();
		expect(editor.getState().read.kind).toBe("loading");
		const result = payload();
		result.setting.label = "Backend policy label";
		result.setting.choices.push({
			value: "future-policy",
			label: "Future backend label",
			description: "Future backend help",
		});
		read.resolve(result);
		await opening;
		expect(editor.getState().read).toEqual({ kind: "ready", payload: result });
		editor.choose("future-policy");
		expect(editor.getState().draft).toBe("future-policy");
		editor.choose("not-advertised");
		expect(editor.getState().draft).toBe("future-policy");
		editor.deactivate();
	});

	it("does not save a draft automatically and admits one pending explicit intent", async () => {
		const write = deferred<Projection>();
		const writes: string[] = [];
		let reads = 0;
		const editor = createAccountRoutingEditor({
			accountRouting: async () => {
				reads++;
				return payload();
			},
			setAccountRouting: (value) => {
				writes.push(value);
				return write.promise;
			},
		});
		await editor.activate();
		editor.choose(nextChoice());
		expect(writes).toEqual([]);
		const first = editor.savePolicy();
		const second = editor.savePolicy();
		expect(editor.getState().save).toBe("pending");
		editor.choose(payload().setting.default);
		await editor.reload();
		expect(reads).toBe(1);
		expect(editor.getState().draft).toBe(nextChoice());
		write.resolve(payload(nextChoice()));
		await Promise.all([first, second]);
		expect(writes).toEqual([nextChoice()]);
		expect(editor.getState().save).toBe("saved");
		editor.deactivate();
	});

	it.each([
		[
			"rejected",
			new RelayError("rejected", "Synthetic backend refusal", {
				status: 422,
				serverError: "Backend refusal text.",
			}),
		],
		["error", new RelayError("transport", "Synthetic transport failure")],
	] as const)(
		"never confirms a %s write and preserves backend TEXT",
		async (expected, error) => {
			const editor = createAccountRoutingEditor({
				accountRouting: async () => payload(),
				setAccountRouting: async () => {
					throw error;
				},
			});
			await editor.activate();
			editor.choose(nextChoice());
			await editor.savePolicy();
			expect(editor.getState().save).toBe(expected);
			expect(editor.getState().saveError).toBe(error.serverError ?? null);
			editor.deactivate();
		},
	);

	it("does not call a mismatched successful response a saved requested policy", async () => {
		const editor = createAccountRoutingEditor({
			accountRouting: async () => payload(),
			setAccountRouting: async () => payload(),
		});
		await editor.activate();
		editor.choose(nextChoice());
		await editor.savePolicy();
		expect(editor.getState().save).toBe("error");
		expect(editor.getState().draft).toBe(nextChoice());
		editor.deactivate();
	});

	it("keeps old-computer read responses out of a new client model", async () => {
		const oldRead = deferred<Projection>();
		const old = createAccountRoutingEditor({
			accountRouting: () => oldRead.promise,
			setAccountRouting: async () => payload(),
		});
		const first = old.activate();
		old.deactivate();
		const current = createAccountRoutingEditor({
			accountRouting: async () => payload(nextChoice()),
			setAccountRouting: async () => payload(),
		});
		await current.activate();
		oldRead.resolve(payload());
		await first;
		expect(old.getState().read.kind).toBe("loading");
		expect(current.getState().draft).toBe(nextChoice());
		current.deactivate();
	});

	it("discards an old write confirmation and reconnects even the same client unread", async () => {
		const write = deferred<Projection>();
		const client = {
			accountRouting: async () => payload(),
			setAccountRouting: () => write.promise,
		};
		const old = createAccountRoutingEditor(client);
		await old.activate();
		old.choose(nextChoice());
		const pending = old.savePolicy();
		old.deactivate();
		const current = createAccountRoutingEditor(client);
		expect(current.getState().read.kind).toBe("loading");
		await current.activate();
		write.resolve(payload(nextChoice()));
		await pending;
		expect(current.getState().save).toBe("idle");
		expect(current.getState().draft).toBe(payload().setting.value);
		current.deactivate();
	});

	it("supports setup/cleanup/setup without accepting the retired read", async () => {
		const reads = [deferred<Projection>(), deferred<Projection>()];
		let calls = 0;
		const editor = createAccountRoutingEditor({
			accountRouting: () => required(reads[calls++]).promise,
			setAccountRouting: async () => payload(),
		});
		const first = editor.activate();
		editor.deactivate();
		const second = editor.activate();
		required(reads[0]).resolve(payload());
		await first;
		expect(editor.getState().read.kind).toBe("loading");
		required(reads[1]).resolve(payload(nextChoice()));
		await second;
		expect(editor.getState().draft).toBe(nextChoice());
		editor.deactivate();
	});

	it.each([
		[
			"unsupported",
			new RelayError("rejected", "Synthetic backend refusal", {
				status: 404,
				serverError: "404: Not Found",
			}),
		],
		[
			"error",
			new RelayError("unknown-tunnel", "Synthetic unknown tunnel", {
				status: 404,
				serverError: "Unknown tunnel",
			}),
		],
	] as const)(
		"distinguishes confirmed old relay from tunnel failure: %s",
		async (expected, error) => {
			const editor = createAccountRoutingEditor({
				accountRouting: async () => {
					throw error;
				},
				setAccountRouting: async () => payload(),
			});
			await editor.activate();
			expect(editor.getState().read.kind).toBe(expected);
			expect(editor.getState().save).toBe("idle");
			editor.deactivate();
		},
	);
});
