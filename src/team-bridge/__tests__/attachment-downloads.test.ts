import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ATTACHMENT_DOWNLOAD_MAX_BYTES,
	createHubClient,
} from "@/team-bridge/client";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const headers = { "content-type": "image/png" };
function streamBody(response: Response) {
	if (!response.body) throw new Error("test requires a streaming response");
	return response.body;
}
const make = (fetchImpl: typeof fetch, timeoutMs?: number) =>
	createHubClient({
		accessToken: async () => "synthetic-attachment-token",
		fetchImpl,
		timeoutMs,
		baseUrl: "https://hub.example",
	});
const read = (client: ReturnType<typeof make>, signal?: AbortSignal) =>
	client.attachmentBytes(
		"tenant-a",
		"conversation-a",
		"message-a",
		"image-a",
		signal,
	);
afterEach(() => vi.useRealTimers());

describe("bounded authenticated attachment bodies", () => {
	it("rejects an oversized declared body before consuming it", async () => {
		const response = new Response(PNG, {
			headers: {
				...headers,
				"content-length": String(ATTACHMENT_DOWNLOAD_MAX_BYTES + 1),
			},
		});
		const cancel = vi.spyOn(streamBody(response), "cancel");
		const consume = vi.spyOn(response, "arrayBuffer");
		await expect(read(make(async () => response))).rejects.toMatchObject({
			kind: "malformed",
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(consume).not.toHaveBeenCalled();
	});

	it("caps undeclared streams and cancels the reader at the protocol bound", async () => {
		const cancel = vi.fn();
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(ATTACHMENT_DOWNLOAD_MAX_BYTES + 1));
				},
				cancel,
			}),
			{ headers },
		);
		await expect(read(make(async () => response))).rejects.toMatchObject({
			kind: "malformed",
		});
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("settles and cancels a body that stalls after successful headers", async () => {
		vi.useFakeTimers();
		const cancel = vi.fn();
		const response = new Response(new ReadableStream({ start() {}, cancel }), {
			headers,
		});
		const pending = read(make(async () => response, 50));
		const rejected = expect(pending).rejects.toMatchObject({
			kind: "unreachable",
		});
		await vi.advanceTimersByTimeAsync(51);
		await rejected;
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("caller cancellation frees an in-flight stream, not just its UI subscriber", async () => {
		const cancel = vi.fn();
		let admitted!: () => void;
		const started = new Promise<void>((resolve) => {
			admitted = resolve;
		});
		let first = true;
		const response = new Response(
			new ReadableStream({
				pull(controller) {
					if (first) {
						first = false;
						controller.enqueue(PNG);
					} else admitted();
				},
				cancel,
			}),
			{ headers },
		);
		const controller = new AbortController();
		const pending = read(
			make(async () => response),
			controller.signal,
		);
		const rejected = expect(pending).rejects.toThrow();
		await started;
		controller.abort();
		await rejected;
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("retired calls never obtain a bearer or issue a late GET", async () => {
		const fetchImpl = vi.fn();
		const accessToken = vi.fn(async () => "synthetic-token");
		const controller = new AbortController();
		controller.abort();
		await expect(
			read(createHubClient({ accessToken, fetchImpl }), controller.signal),
		).rejects.toThrow();
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(accessToken).not.toHaveBeenCalled();
	});

	it("classifies a refusal without consuming its unbounded JSON/error body", async () => {
		const response = new Response(new ReadableStream({ start() {} }), {
			status: 403,
		});
		const json = vi.spyOn(response, "json");
		const cancel = vi.spyOn(streamBody(response), "cancel");
		await expect(read(make(async () => response))).rejects.toMatchObject({
			kind: "refused",
			status: 403,
		});
		expect(json).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("retains the non-streaming size check without claiming native allocation cancellation", async () => {
		const bytes = new Uint8Array(ATTACHMENT_DOWNLOAD_MAX_BYTES + 1);
		const response = {
			status: 200,
			ok: true,
			headers: new Headers(headers),
			body: null,
			arrayBuffer: async () => bytes.buffer,
		} as Response;
		await expect(read(make(async () => response))).rejects.toMatchObject({
			kind: "malformed",
		});
	});
});
