/** The config stream's resume wake (`config-stream.ts` `wake`), on a fake
 *  client: it reopens a silent or backed-off stream at once, leaves a recently
 *  live one alone, and never revives a terminal one. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RelayEndpoints, RelayError } from "@/relay";
import { createConfigStore } from "@/state/config-store";
import { startConfigStream } from "./config-stream";

type Handlers = Parameters<RelayEndpoints["configStream"]>[0];

function fakeClient() {
	const opened: Handlers[] = [];
	const stops: number[] = [];
	const client = {
		configStream: (handlers: Handlers) => {
			opened.push(handlers);
			const index = opened.length - 1;
			return {
				connection: { start: () => undefined },
				stop: () => stops.push(index),
			};
		},
	} as unknown as RelayEndpoints;
	return { client, opened, stops };
}
const transient = { surface: "retry" } as unknown as RelayError;

describe("config stream wake", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("leaves a stream seen within 20 s alone, reopens one silent for longer", () => {
		const { client, opened, stops } = fakeClient();
		const handle = startConfigStream(client, createConfigStore());
		opened[0]?.onState?.({ state: "open", attempt: 1 });
		expect(handle.wake(Date.now() + 5_000)).toBe(false);
		expect(opened).toHaveLength(1);
		expect(handle.wake(Date.now() + 25_000)).toBe(true);
		expect(opened).toHaveLength(2);
		expect(stops).toEqual([0]);
		handle.stop();
	});

	it("cuts a pending restart short and does not double-open when it would have fired", () => {
		const { client, opened } = fakeClient();
		const handle = startConfigStream(client, createConfigStore(), {
			restartMs: 2_000,
		});
		opened[0]?.onState?.({ state: "open", attempt: 1 });
		opened[0]?.onError?.(transient);
		expect(handle.wake()).toBe(true);
		expect(opened).toHaveLength(2);
		vi.advanceTimersByTime(5_000);
		expect(opened).toHaveLength(2);
		handle.stop();
	});

	it("never revives a terminal stream (an older relay's 404)", () => {
		const { client, opened } = fakeClient();
		const handle = startConfigStream(client, createConfigStore());
		opened[0]?.onError?.(
			new RelayError("rejected", "Not Found", { status: 404 }),
		);
		expect(handle.wake(Date.now() + 60_000)).toBe(false);
		expect(opened).toHaveLength(1);
	});
});
