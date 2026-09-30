// biome-ignore-all lint/performance/useTopLevelRegex: the regex literals here are
// assertions about what the RUNTIME said and about a path spelling — evaluated
// once per test, never per item on a hot path.
/**
 * The two network failures a user's OWN tunnel produces most often, driven for
 * real rather than simulated: a certificate the app will not trust, and a name
 * that does not resolve.
 *
 * They arrive through the same catch, and they must not become the same error.
 * "The certificate was rejected" is fixed on the tunnel or by not using that
 * certificate; "that address could not be found" is fixed in the address. A
 * self-hosted tunnel is a supported way to run this app, so both are first-class
 * outcomes with their own sentences rather than one generic `transport`.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createRelayClient } from "../connection";
import { isRelayError, type RelayError } from "../relay";

/** Where the throwaway keypair lives. `mkdtemp` under the OS temp dir, removed in
 *  `afterAll`: a private key is generated per run rather than committed, because a
 *  key in the repository is both a scanner finding and a lie — it is nobody's
 *  certificate. */
const scratch = mkdtempSync(join(tmpdir(), "lop-mobile-tls-"));
afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

/** A self-signed certificate for the address the client will dial.
 *
 * The SAN names the loopback IP on purpose: with the address matching, the failure
 * is the one a self-hosted tunnel actually produces — an untrusted issuer — rather
 * than a hostname mismatch, which is a different user mistake. */
function selfSignedForLoopback(): { key: string; cert: string } {
	const key = join(scratch, "key.pem");
	const cert = join(scratch, "cert.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			key,
			"-out",
			cert,
			"-days",
			"1",
			"-subj",
			"/CN=127.0.0.1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
		],
		{ stdio: "ignore" },
	);
	return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
}

/** The typed failure a request produced. A request that SUCCEEDS is a failure of
 *  the test, and saying so here keeps every case below to one line. */
async function failureOf(request: Promise<unknown>): Promise<RelayError> {
	const caught = await request.then(
		(value) => ({ failed: false as const, value }),
		(cause: unknown) => ({ failed: true as const, cause }),
	);
	if (!caught.failed) throw new Error("expected the request to fail");
	if (!isRelayError(caught.cause)) {
		throw new Error(`expected a RelayError, got ${String(caught.cause)}`);
	}
	return caught.cause;
}

/** Every message and code in a rejection's cause chain. Node's fetch says
 *  `fetch failed` and puts the diagnosis one level down, so an assertion about what
 *  the runtime actually said has to walk for it — the same walk the classifier
 *  does when it decides which failure this is. */
function causeChain(error: unknown): string {
	const parts: string[] = [];
	let current: unknown = error;
	for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
		parts.push(current.message);
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string") parts.push(code);
		current = current.cause;
	}
	return parts.join(" ");
}

describe("a certificate the app will not trust, and a name that does not resolve", () => {
	it("stays two distinct outcomes, with their own sentences and surfaces", async () => {
		const { key, cert } = selfSignedForLoopback();
		const server = createHttpsServer({ key, cert }, (_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end("{}");
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as AddressInfo;

		let rejected: RelayError;
		try {
			const client = createRelayClient({
				route: {
					mode: "custom",
					baseUrl: `https://127.0.0.1:${port}`,
					allowInsecure: true,
				},
			});
			rejected = await failureOf(client.sessions());
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}

		expect(rejected.kind).toBe("certificate-rejected");
		expect(rejected.message).toBe("the relay's certificate was rejected");
		expect(rejected.surface).toBe("connection");
		/* Retrying the same certificate cannot help, and the taxonomy says so. */
		expect(rejected.retry).toBe("never");
		/* The runtime's own diagnosis is kept on the error for a diagnostics view — and
		 * it is what the classifier read to reach that verdict. */
		expect(causeChain(rejected)).toMatch(/certificate|CERT_/i);

		/* `.invalid` is reserved by RFC 2606 to never resolve, so this is the address
		 * failure rather than a network accident. */
		const unresolved = createRelayClient({
			route: {
				mode: "custom",
				baseUrl: "https://tunnel.invalid",
				allowInsecure: true,
			},
		});
		const host = await failureOf(unresolved.sessions());

		expect(host.kind).toBe("host-unresolved");
		expect(host.message).toBe("that address could not be found");
		expect(host.surface).toBe("connection");
		/* A resolver timeout can clear by itself; a name that does not exist cannot,
		 * so the caller is allowed one automatic attempt and then has to act. */
		expect(host.retry).toBe("after-backoff");

		/* The whole point: one catch, two answers a user can tell apart. */
		expect(rejected.kind).not.toBe(host.kind);
		expect(rejected.message).not.toBe(host.message);
		expect(rejected.retry).not.toBe(host.retry);
	});
});
