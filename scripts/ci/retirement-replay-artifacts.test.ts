import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
	download,
	metadata,
	unpackZip,
	verifyModes,
} from "./retirement-replay-artifacts.ts";
import { Deadline } from "./retirement-replay-core.ts";
import { inspectTarBytes } from "./retirement-ui-guards.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function crc(bytes: Buffer) {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit++)
			value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return (value ^ 0xffffffff) >>> 0;
}
function zip(
	items: Array<{
		name: string;
		body?: Buffer;
		method?: number;
		mode?: number;
		declared?: number;
	}>,
) {
	const locals: Buffer[] = [],
		directory: Buffer[] = [];
	let offset = 0;
	for (const item of items) {
		const body = item.body ?? Buffer.from("fixture"),
			method = item.method ?? 0,
			content = method === 8 ? deflateRawSync(body) : body,
			name = Buffer.from(item.name),
			sum = crc(body),
			local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(sum, 14);
		local.writeUInt32LE(content.length, 18);
		local.writeUInt32LE(item.declared ?? body.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, content);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(sum, 16);
		central.writeUInt32LE(content.length, 20);
		central.writeUInt32LE(item.declared ?? body.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(((item.mode ?? 0o100644) * 65536) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		directory.push(central, name);
		offset += local.length + name.length + content.length;
	}
	const central = Buffer.concat(directory),
		end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50);
	end.writeUInt16LE(items.length, 8);
	end.writeUInt16LE(items.length, 10);
	end.writeUInt32LE(central.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, central, end]);
}
function tar(
	name: string,
	type = "0",
	link = "",
	body = Buffer.alloc(0),
	mode = 0o644,
) {
	const header = Buffer.alloc(512);
	header.write(name, 0, 100);
	header.write(mode.toString(8).padStart(7, "0") + "\0", 100);
	header.write("0000000\0", 108);
	header.write("0000000\0", 116);
	header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
	header.fill(32, 148, 156);
	header.write(type, 156);
	header.write(link, 157, 100);
	header.write("ustar\0", 257);
	let sum = 0;
	for (const byte of header) sum += byte;
	header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
	return Buffer.concat([
		header,
		body,
		Buffer.alloc((512 - (body.length % 512)) % 512),
	]);
}
function pax(key: string, value: string) {
	const data = `${key}=${value}\n`;
	let length = Buffer.byteLength(data) + 2;
	while (Buffer.byteLength(`${length} ${data}`) !== length)
		length = Buffer.byteLength(`${length} ${data}`);
	return Buffer.from(`${length} ${data}`);
}
const end = Buffer.alloc(1024);
describe("real ZIP transport and pre-extraction tar guards", () => {
	it.each([0, 8])(
		"accepts exactly the expected stored/deflated transport (%s)",
		(method) => {
			expect(
				unpackZip(zip([{ name: "runner-products.tar.gz", method }]), [
					"runner-products.tar.gz",
				])["runner-products.tar.gz"]?.toString(),
			).toBe("fixture");
		},
	);
	it.each(["../escape", "/absolute", "dir/member", "back\\slash", "unknown"])(
		"rejects outer ZIP name %s before extraction",
		(name) => {
			expect(() =>
				unpackZip(zip([{ name }]), ["runner-products.tar.gz"]),
			).toThrow();
		},
	);
	it("rejects duplicate ZIP members", () => {
		expect(() =>
			unpackZip(zip([{ name: "same" }, { name: "same" }]), ["same", "same"]),
		).toThrow();
	});
	it.each([0o120777, 0o020644, 0o104755])(
		"rejects ZIP symlink/special/suid mode %s",
		(mode) => {
			expect(() => unpackZip(zip([{ name: "ok", mode }]), ["ok"])).toThrow();
		},
	);
	it.each([1, 512 * 1024 * 1024 + 1])(
		"rejects a false/oversize uncompressed declaration %s",
		(declared) => {
			expect(() =>
				unpackZip(zip([{ name: "ok", declared, method: 8 }]), ["ok"]),
			).toThrow();
		},
	);
	it("rejects CRC corruption, truncation and local/central mismatch", () => {
		const original = zip([{ name: "ok" }]);
		for (const kind of ["crc", "truncated", "name"]) {
			const bad = Buffer.from(original);
			if (kind === "crc") bad[32] ^= 1;
			else if (kind === "name") bad[30] = 120;
			expect(() =>
				unpackZip(kind === "truncated" ? bad.subarray(0, -1) : bad, ["ok"]),
			).toThrow();
		}
	});
	it.each(["../escape", "/absolute", "a/../../escape"])(
		"rejects tar traversal %s",
		(name) => {
			expect(() => inspectTarBytes(Buffer.concat([tar(name), end]))).toThrow();
		},
	);
	it.each(["1", "3", "4", "6"])(
		"rejects tar hardlink/special type %s",
		(type) => {
			expect(() =>
				inspectTarBytes(Buffer.concat([tar("member", type, "other"), end])),
			).toThrow();
		},
	);
	it("rejects duplicates and members below a symlink", () => {
		expect(() =>
			inspectTarBytes(Buffer.concat([tar("same"), tar("same"), end])),
		).toThrow();
		expect(() =>
			inspectTarBytes(
				Buffer.concat([tar("link", "2", "target"), tar("link/child"), end]),
			),
		).toThrow();
	});
	it.each(["..", "../..", "/absolute"])(
		"rejects escaping tar link %s",
		(link) => {
			expect(() =>
				inspectTarBytes(Buffer.concat([tar("link", "2", link), end])),
			).toThrow();
		},
	);
	it.each(["../escape", "/absolute"])(
		"PAX path cannot override safe header into %s",
		(name) => {
			expect(() =>
				inspectTarBytes(
					Buffer.concat([
						tar("pax", "x", "", pax("path", name)),
						tar("safe"),
						end,
					]),
				),
			).toThrow();
		},
	);
	it("PAX linkpath cannot override a safe link into an escape", () => {
		expect(() =>
			inspectTarBytes(
				Buffer.concat([
					tar("pax", "x", "", pax("linkpath", "../escape")),
					tar("safe", "2", "target"),
					end,
				]),
			),
		).toThrow();
	});
	it("accepts a safe PAX path and rejects malformed PAX lengths", () => {
		expect(
			inspectTarBytes(
				Buffer.concat([
					tar("pax", "x", "", pax("path", "Products/long-name")),
					tar("safe"),
					end,
				]),
			)[0]?.name,
		).toBe("Products/long-name");
		expect(() =>
			inspectTarBytes(
				Buffer.concat([
					tar("pax", "x", "", Buffer.from("999 path=safe\n")),
					tar("safe"),
					end,
				]),
			),
		).toThrow();
	});
	it("compares actual extracted executable modes, not just file types", () => {
		const root = mkdtempSync(join(tmpdir(), "replay-tar-mode-"));
		roots.push(root);
		writeFileSync(join(root, "runner"), "");
		const archive = Buffer.concat([
			tar("runner", "0", "", Buffer.alloc(0), 0o755),
			end,
		]);
		chmodSync(join(root, "runner"), 0o755);
		expect(verifyModes(root, archive)).toHaveLength(1);
		chmodSync(join(root, "runner"), 0o644);
		expect(() => verifyModes(root, archive)).toThrow();
	});
});
describe("fresh metadata and credential-isolated download boundaries (no API/network)", () => {
	const source = "c".repeat(40);
	const valid = () => ({
		id: 123,
		expired: false,
		expires_at: new Date(Date.now() + 60000).toISOString(),
		workflow_run: { id: 456, head_sha: source },
	});
	it.each(["expired", "timestamp", "source", "run", "id", "unavailable"])(
		"refuses %s metadata without cached fallback",
		async (kind) => {
			const value = valid();
			if (kind === "expired") value.expired = true;
			if (kind === "timestamp") value.expires_at = "not-a-date";
			if (kind === "source") value.workflow_run.head_sha = "d".repeat(40);
			if (kind === "run") value.workflow_run.id = 1;
			if (kind === "id") value.id = 1;
			let calls = 0;
			await expect(
				metadata(
					123,
					456,
					source,
					"fixture-only",
					new Deadline(10000),
					(async () => {
						calls++;
						return Response.json(value, {
							status: kind === "unavailable" ? 403 : 200,
						});
					}) as typeof fetch,
				),
			).rejects.toThrow();
			expect(calls).toBe(1);
		},
	);
	it("valid metadata requires a real fresh response for each call", async () => {
		let calls = 0;
		const fetcher = (async () => {
			calls++;
			return Response.json(valid());
		}) as typeof fetch;
		await metadata(
			123,
			456,
			source,
			"fixture-only",
			new Deadline(10000),
			fetcher,
		);
		await metadata(
			123,
			456,
			source,
			"fixture-only",
			new Deadline(10000),
			fetcher,
		);
		expect(calls).toBe(2);
	});
	it("never forwards API authorization to the object host", async () => {
		const requests: RequestInit[] = [];
		const fetcher = (async (_url: unknown, init: RequestInit) => {
			requests.push(init);
			return requests.length === 1
				? new Response(null, {
						status: 302,
						headers: {
							location: "https://fixture.blob.core.windows.net/artifact",
						},
					})
				: new Response("archive");
		}) as typeof fetch;
		expect(
			(
				await download(123, "fixture-only", new Deadline(10000), fetcher)
			).toString(),
		).toBe("archive");
		expect(new Headers(requests[0]?.headers).has("authorization")).toBe(true);
		expect(new Headers(requests[1]?.headers).has("authorization")).toBe(false);
		expect(requests[1]?.redirect).toBe("error");
	});
	it.each([
		"http://fixture.blob.core.windows.net/a",
		"https://example.invalid/a",
		"https://user:password@fixture.blob.core.windows.net/a",
	])(
		"rejects download redirect %s before second request",
		async (redirectUrl) => {
			let calls = 0;
			await expect(
				download(123, "fixture-only", new Deadline(10000), (async () => {
					calls++;
					return new Response(null, {
						status: 302,
						headers: { location: redirectUrl },
					});
				}) as typeof fetch),
			).rejects.toThrow();
			expect(calls).toBe(1);
		},
	);
});
