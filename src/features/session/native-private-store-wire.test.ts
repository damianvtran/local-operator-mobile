import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, it } from "vitest";
import { configurePrivateDataKeys } from "@/connection/private-data-key";
import type { PrivateDataKey } from "@/connection/storage";
import { RelayEndpoints } from "@/relay/endpoints";
import { RelayHttpClient } from "@/relay/http";
import { RetryEnvelopeStore } from "@/relay/retry-envelope";
import { sendPersistedCommand } from "@/relay/send-command";
import { createNativePrivateStores } from "./native-private-store";

/** REAL loopback HTTP + production persisted sender/native storage adapter.
 * The OS ports are Node filesystem/AES, not Expo or device proof. No operator
 * connection, credentials, clipboard or application process is opened. */
it("keeps real HTTP behind the native commit promise and retries identical bytes", async () => {
	const root = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "composer-wire-"),
	);
	const paths = {
		document: join(root, "document"),
		cache: join(root, "cache"),
	};
	mkdirSync(paths.document);
	mkdirSync(paths.cache);
	let gate: Promise<void> | null = null;
	let moveStarted = () => {};
	let releaseMove = () => {};
	let failMove = false;
	const path = (parts: (string | { uri: string })[]) =>
		join(...parts.map((part) => (typeof part === "string" ? part : part.uri)));
	class File {
		uri: string;
		constructor(...parts: (string | { uri: string })[]) {
			this.uri = path(parts);
		}
		get name() {
			return basename(this.uri);
		}
		info() {
			return { exists: existsSync(this.uri) };
		}
		create(options?: { intermediates?: boolean; overwrite?: boolean }) {
			if (options?.intermediates)
				mkdirSync(join(this.uri, ".."), { recursive: true });
			writeFileSync(this.uri, "", { flag: options?.overwrite ? "w" : "wx" });
		}
		write(value: string) {
			writeFileSync(this.uri, value);
		}
		async text() {
			return readFileSync(this.uri, "utf8");
		}
		delete() {
			rmSync(this.uri);
		}
		async move(target: File) {
			moveStarted();
			await gate;
			if (failMove) throw new Error("synthetic native move failure");
			renameSync(this.uri, target.uri);
			this.uri = target.uri;
		}
	}
	class Directory {
		uri: string;
		constructor(...parts: (string | { uri: string })[]) {
			this.uri = path(parts);
		}
		get name() {
			return basename(this.uri);
		}
		info() {
			return { exists: existsSync(this.uri) };
		}
		create() {
			mkdirSync(this.uri, { recursive: true });
		}
		delete() {
			rmSync(this.uri, { recursive: true });
		}
		list() {
			return readdirSync(this.uri, { withFileTypes: true }).map((entry) =>
				entry.isDirectory()
					? new Directory(this, entry.name)
					: new File(this, entry.name),
			);
		}
	}
	let key: PrivateDataKey | null = null;
	configurePrivateDataKeys({
		read: async () => key,
		write: async (value) => {
			key = value;
		},
		clear: async () => {
			key = null;
		},
	});
	const native = createNativePrivateStores({
		filesystem: async () =>
			({
				File,
				Directory,
				Paths: paths,
			}) as unknown as typeof import("expo-file-system"),
		installId: async () => randomUUID(),
		generateKey: async () => randomBytes(32).toString("hex"),
		hash: async (value) => createHash("sha256").update(value).digest("hex"),
		cipher: async (hex, installation) => ({
			seal: async (plaintext, context) => {
				const iv = randomBytes(12);
				const cipher = createCipheriv(
					"aes-256-gcm",
					Buffer.from(hex, "hex"),
					iv,
				);
				cipher.setAAD(Buffer.from(JSON.stringify([installation, context])));
				return Buffer.concat([
					iv,
					cipher.update(plaintext, "utf8"),
					cipher.final(),
					cipher.getAuthTag(),
				]).toString("base64");
			},
			open: async (value, context) => {
				const bytes = Buffer.from(value, "base64");
				const cipher = createDecipheriv(
					"aes-256-gcm",
					Buffer.from(hex, "hex"),
					bytes.subarray(0, 12),
				);
				cipher.setAAD(Buffer.from(JSON.stringify([installation, context])));
				cipher.setAuthTag(bytes.subarray(-16));
				return Buffer.concat([
					cipher.update(bytes.subarray(12, -16)),
					cipher.final(),
				]).toString("utf8");
			},
		}),
	});
	const requests: string[] = [];
	const routes: string[] = [];
	let httpAttempts = 0;
	const admissions = new Set<string>();
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += String(chunk);
		requests.push(raw);
		routes.push(`${request.method} ${request.url}`);
		const body = JSON.parse(raw) as { command_id: string };
		admissions.add(body.command_id);
		if (requests.length === 1) {
			request.socket.destroy();
			return;
		} // admitted, ACK lost
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ ok: true, detail: "already admitted" }));
	});
	const operations: Promise<unknown>[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("missing loopback address");
		const client = new RelayEndpoints(
			new RelayHttpClient({
				fetchImpl: (...args) => {
					httpAttempts++;
					return globalThis.fetch(...args);
				},
				baseUrl: `http://127.0.0.1:${address.port}`,
				auth: () => ({ cookie: null, origin: null, credentials: "omit" }),
			}),
		);
		const store = native.nativePrivateStore("device");
		const envelopes = new RetryEnvelopeStore({ store, randomUuid: randomUUID });
		const image = {
			mime_type: "image/png",
			data_b64: Buffer.alloc(341 * 1024).toString("base64"),
		};
		const input = {
			client,
			envelopes,
			sessionId: "synthetic-wire",
			op: "steer" as const,
			text: "synthetic long-image instruction",
			images: [image],
		};
		gate = new Promise<void>((resolve) => {
			releaseMove = resolve;
		});
		const started = new Promise<void>((resolve) => {
			moveStarted = resolve;
		});
		const first = sendPersistedCommand(input).catch((error: unknown) => error);
		operations.push(first);
		await started;
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(requests).toHaveLength(0);
		expect(httpAttempts).toBe(0);
		console.log("REAL HTTP before encrypted commit: requests=0");
		releaseMove();
		expect(await first).toBeInstanceOf(Error);
		expect(requests).toHaveLength(1);
		const held = await envelopes.peek(input.sessionId);
		expect(held).not.toBeNull();
		console.log(
			"REAL HTTP after commit: requests=1 admissions=1 ACK=socket-closed; encrypted envelope retained",
		);
		const result = await sendPersistedCommand(input);
		expect(result.detail).toBe("already admitted");
		expect(requests).toHaveLength(2);
		expect(requests[1]).toBe(requests[0]);
		expect(routes).toEqual([
			"POST /api/sessions/synthetic-wire/command",
			"POST /api/sessions/synthetic-wire/command",
		]);
		expect(admissions.size).toBe(1);
		expect(result.commandId).toBe(held?.command_id);
		expect(await envelopes.peek(input.sessionId)).toBeNull();
		console.log(
			"REAL HTTP retry: status=200 detail=already admitted; same UUID/body; requests=2 admissions=1",
		);
		gate = null;
		failMove = true;
		const failedDraft = {
			...input,
			sessionId: "synthetic-move-failure",
			text: "preserve failed draft",
		};
		await expect(sendPersistedCommand(failedDraft)).rejects.toMatchObject({
			stage: "pre-dispatch",
			category: "local-storage",
		});
		expect(requests).toHaveLength(2);
		expect(failedDraft.text).toBe("preserve failed draft");
		expect(failedDraft.images).toEqual([image]);
		const disk = readdirSync(paths.document, { recursive: true })
			.filter(
				(name) =>
					String(name).endsWith(".json") || String(name).endsWith(".pending"),
			)
			.map((name) => readFileSync(join(paths.document, String(name)), "utf8"))
			.join("\n");
		expect(disk).not.toContain("preserve failed draft");
		expect(disk).not.toContain("synthetic long-image instruction");
		console.log(
			"REAL HTTP async move failure: additional requests=0; caller text/images unchanged; disk contains ciphertext only",
		);
	} finally {
		releaseMove();
		await Promise.allSettled(operations);
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		expect(server.listening).toBe(false);
		rmSync(root, { recursive: true });
	}
});
