/** Safe artifact admission before ANY extraction. GitHub artifact ZIP is a
 * transport wrapper, not the pinned original tar. No cached metadata fallback. */
import { createHash } from "node:crypto";
import {
	lstatSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, posix } from "node:path";
import { inflateRawSync } from "node:zlib";
import { type Deadline, ReplayRefused } from "./retirement-replay-core.ts";
import {
	type ArtifactMetadata,
	inspectRetainedTar,
	inspectTarBytes,
	RETAINED,
	verifyArtifactMetadata,
} from "./retirement-ui-guards.ts";

const bad = () => {
	throw new ReplayRefused("archive");
};
const crc32 = (bytes: Buffer) => {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
};
export function unpackZip(
	zip: Buffer,
	expected: string[],
): Record<string, Buffer> {
	if (zip.length > 600 * 1024 ** 2) bad();
	let end = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
		if (zip.readUInt32LE(i) === 0x06054b50) {
			end = i;
			break;
		}
	if (
		end < 0 ||
		zip.readUInt16LE(end + 4) !== 0 ||
		zip.readUInt16LE(end + 6) !== 0 ||
		zip.readUInt16LE(end + 8) !== zip.readUInt16LE(end + 10) ||
		end + 22 + zip.readUInt16LE(end + 20) !== zip.length
	)
		bad();
	const count = zip.readUInt16LE(end + 10),
		size = zip.readUInt32LE(end + 12),
		offset = zip.readUInt32LE(end + 16);
	if (count !== expected.length || count > 8 || offset + size !== end) bad();
	const result: Record<string, Buffer> = {},
		ranges: Array<[number, number]> = [];
	let at = offset,
		total = 0;
	for (let n = 0; n < count; n++) {
		if (at + 46 > end || zip.readUInt32LE(at) !== 0x02014b50) bad();
		const flags = zip.readUInt16LE(at + 8),
			method = zip.readUInt16LE(at + 10),
			crc = zip.readUInt32LE(at + 16),
			compressed = zip.readUInt32LE(at + 20),
			uncompressed = zip.readUInt32LE(at + 24),
			nameBytes = zip.readUInt16LE(at + 28),
			extra = zip.readUInt16LE(at + 30),
			comment = zip.readUInt16LE(at + 32),
			mode = zip.readUInt32LE(at + 38) >>> 16,
			local = zip.readUInt32LE(at + 42);
		if (
			flags & ~0x808 ||
			mode & 0o7000 ||
			![0, 8].includes(method) ||
			(mode & 0o170000) === 0o120000 ||
			((mode & 0o170000) !== 0 && (mode & 0o170000) !== 0o100000) ||
			at + 46 + nameBytes + extra + comment > end
		)
			bad();
		const name = new TextDecoder("utf-8", { fatal: true }).decode(
			zip.subarray(at + 46, at + 46 + nameBytes),
		);
		if (
			!expected.includes(name) ||
			Object.hasOwn(result, name) ||
			name.includes("/") ||
			name.includes("\\") ||
			name.includes("\0") ||
			name === ".."
		)
			bad();
		if (
			local + 30 > offset ||
			zip.readUInt32LE(local) !== 0x04034b50 ||
			zip.readUInt16LE(local + 6) !== flags ||
			zip.readUInt16LE(local + 8) !== method
		)
			bad();
		const ln = zip.readUInt16LE(local + 26),
			le = zip.readUInt16LE(local + 28),
			start = local + 30 + ln + le;
		total += uncompressed;
		if (
			!zip.subarray(local + 30, local + 30 + ln).equals(Buffer.from(name)) ||
			start + compressed > offset ||
			uncompressed > 512 * 1024 ** 2 ||
			total > 520 * 1024 ** 2
		)
			bad();
		const stop = start + compressed + (flags & 8 ? 16 : 0);
		if (stop > offset || ranges.some(([a, b]) => local < b && stop > a)) bad();
		ranges.push([local, stop]);
		if (flags & 8) {
			if (
				zip.readUInt32LE(start + compressed) !== 0x08074b50 ||
				zip.readUInt32LE(start + compressed + 4) !== crc ||
				zip.readUInt32LE(start + compressed + 8) !== compressed ||
				zip.readUInt32LE(start + compressed + 12) !== uncompressed
			)
				bad();
		} else if (
			zip.readUInt32LE(local + 14) !== crc ||
			zip.readUInt32LE(local + 18) !== compressed ||
			zip.readUInt32LE(local + 22) !== uncompressed
		)
			bad();
		const content =
			method === 0
				? zip.subarray(start, start + compressed)
				: inflateRawSync(zip.subarray(start, start + compressed), {
						maxOutputLength: uncompressed + 1,
					});
		if (content.length !== uncompressed || crc32(content) !== crc) bad();
		result[name] = Buffer.from(content);
		at += 46 + nameBytes + extra + comment;
	}
	if (at !== end) bad();
	return result;
}
export function productManifest(root: string) {
	const entries: Array<Record<string, unknown>> = [];
	function walk(dir: string, prefix: string) {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name),
				relative = prefix + name,
				stat = lstatSync(path);
			if (stat.isSymbolicLink())
				entries.push({
					path: relative,
					type: "link",
					mode: stat.mode & 0o777,
					target: readlinkSync(path),
				});
			else if (stat.isDirectory()) {
				entries.push({
					path: relative,
					type: "directory",
					mode: stat.mode & 0o777,
				});
				walk(path, relative + "/");
			} else if (stat.isFile())
				entries.push({
					path: relative,
					type: "file",
					mode: stat.mode & 0o777,
					size: stat.size,
					sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
				});
			else bad();
		}
	}
	walk(root, "");
	return entries;
}
export function verifyModes(root: string, tar: Buffer) {
	const members = inspectTarBytes(tar);
	for (const member of members) {
		const path = join(root, member.name);
		const stat = lstatSync(path);
		if (member.mode === undefined || (stat.mode & 0o777) !== member.mode) bad();
		if (member.type === "symlink") {
			if (!stat.isSymbolicLink() || readlinkSync(path) !== member.link) bad();
		} else if (
			member.type === "directory" ? !stat.isDirectory() : !stat.isFile()
		)
			bad();
	}
	return members;
}
export async function metadata(
	id: number,
	run: number,
	source: string,
	token: string,
	deadline: Deadline,
	fetcher: typeof fetch = fetch,
) {
	const response = await fetcher(
		`https://api.github.com/repos/damianvtran/local-operator-mobile/actions/artifacts/${id}`,
		{
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/vnd.github+json",
			},
			signal: AbortSignal.timeout(deadline.cap(10000)),
			cache: "no-store",
			redirect: "error",
		},
	);
	if (!response.ok) throw new ReplayRefused("artifact-api");
	const m = (await response.json()) as ArtifactMetadata;
	if (
		m.id !== id ||
		m.expired !== false ||
		m.workflow_run?.id !== run ||
		m.workflow_run?.head_sha !== source ||
		Date.parse(m.expires_at) <= Date.now() ||
		!Number.isFinite(Date.parse(m.expires_at))
	)
		throw new ReplayRefused("artifact-expired");
	return m;
}
export async function download(
	id: number,
	token: string,
	deadline: Deadline,
	fetcher: typeof fetch = fetch,
) {
	// GitHub's API returns a short-lived HTTPS object URL. Authorize ONLY the API
	// request; never forward the bearer to the object host. No HTTP retry/cache.
	const redirect = await fetcher(
		`https://api.github.com/repos/damianvtran/local-operator-mobile/actions/artifacts/${id}/zip`,
		{
			headers: { authorization: `Bearer ${token}` },
			redirect: "manual",
			signal: AbortSignal.timeout(deadline.cap(10000)),
		},
	);
	if (redirect.status !== 302) throw new ReplayRefused("artifact-download");
	const url = new URL(redirect.headers.get("location") ?? "");
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		!/(^|\.)(blob\.core\.windows\.net|githubusercontent\.com)$/.test(
			url.hostname,
		)
	)
		throw new ReplayRefused("artifact-origin");
	const abort = AbortSignal.timeout(deadline.cap(60000));
	const response = await fetcher(url, {
		redirect: "error",
		signal: abort,
		cache: "no-store",
	});
	if (!response.ok || !response.body)
		throw new ReplayRefused("artifact-download");
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of response.body) {
		deadline.cap(1);
		size += chunk.length;
		if (size > 600 * 1024 ** 2) throw new ReplayRefused("artifact-size");
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}
export async function originalArchive(token: string, deadline: Deadline) {
	const m = await metadata(
		RETAINED.artifactID,
		RETAINED.runID,
		RETAINED.sourceSHA,
		token,
		deadline,
	);
	verifyArtifactMetadata(m, Date.now());
	const zip = unpackZip(await download(RETAINED.artifactID, token, deadline), [
		"synthetic-proof-app.tar.gz",
	]);
	const tar = zip["synthetic-proof-app.tar.gz"]!;
	inspectRetainedTar(tar, m, Date.now());
	return { tar, metadata: m };
}
