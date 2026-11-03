/** Source-testable authorization model, not a replay dispatcher. Fresh server
 * metadata is required even when identical archive bytes exist locally. Runner
 * source is intentionally distinct from the retained ORIGINAL app source. */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { gunzipSync } from "node:zlib";
import { immutableBundleDigest } from "./auth-retirement-ios-proof.ts";
export const RETAINED = {
	artifactID: 13225164386,
	runID: 41620694610,
	sourceSHA: "78ff786a7ef173560b7fb67e29a9e20eb9ca6f8b",
	bundleSHA256:
		"9c667250a1e0a8d5dc129495a8f1bd734e201ec5bfbae8bd7b863e4f951574e7",
	tarSHA256: "2e6ce4369dea84a514ba31d8802e9ec36f25dd4f0ace9c36353cba6edc9d1d92",
} as const;
export const SYSTEM_TITLE = "Open in “Local Operator”?";
const fail = () => {
	throw new Error("Retained replay refused");
};
export interface Authority {
	scope: string;
	deviceUDID: string;
	leaseUDID: string;
	proofPID: number;
	observedPID: number;
	sourceSHA: string;
	bundleSHA256: string;
	tarSHA256: string;
	flavor: string;
	bundleID: string;
	artifactID: number;
	artifactPresent: boolean;
	artifactExpired: boolean;
	expiresAt: number;
	checkedAt: number;
	openURLAt: number;
	expectedTitle: string;
	titleAttested: boolean;
}
export function authorizeSystemAlert(
	a: Authority,
	actualUDID: string,
	now: number,
	observedAlert: { title: string; buttons: string[]; count: number },
): boolean {
	if (
		a.scope !== "owned-retirement-proof-system-open-alert-v1" ||
		!actualUDID ||
		a.deviceUDID !== actualUDID ||
		a.leaseUDID !== actualUDID ||
		!Number.isSafeInteger(a.proofPID) ||
		a.proofPID <= 0 ||
		a.observedPID !== a.proofPID ||
		a.sourceSHA !== RETAINED.sourceSHA ||
		a.bundleSHA256 !== RETAINED.bundleSHA256 ||
		a.tarSHA256 !== RETAINED.tarSHA256 ||
		a.flavor !== "auth-retirement-proof" ||
		a.bundleID !== "com.localoperator.mobile.retirementproof" ||
		a.artifactID !== RETAINED.artifactID ||
		a.artifactPresent !== true ||
		a.artifactExpired !== false ||
		!Number.isFinite(now) ||
		!Number.isFinite(a.expiresAt) ||
		a.expiresAt <= now ||
		![a.checkedAt, a.openURLAt].every(
			(t) => Number.isFinite(t) && t <= now && now - t <= 60,
		) ||
		a.titleAttested !== true ||
		a.expectedTitle !== SYSTEM_TITLE
	)
		return false;
	return (
		observedAlert.count === 1 &&
		observedAlert.title === SYSTEM_TITLE &&
		observedAlert.buttons.length === 2 &&
		[...observedAlert.buttons].sort().join("\0") === "Cancel\0Open"
	);
}
export interface ArtifactMetadata {
	id: number;
	expired: boolean;
	expires_at: string;
	workflow_run: { id: number; head_sha: string };
}
/** Must be called on a fresh API response, never a cached-file fallback. No
 * auth expansion: a missing/expired/unauthorized server response is a stop. */
export async function freshArtifactMetadata(
	token: string,
	fetcher: typeof fetch = fetch,
): Promise<ArtifactMetadata> {
	if (!token) fail();
	const response = await fetcher(
		`https://api.github.com/repos/damianvtran/local-operator-mobile/actions/artifacts/${RETAINED.artifactID}`,
		{
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/vnd.github+json",
			},
			signal: AbortSignal.timeout(10000),
			cache: "no-store",
		},
	);
	if (!response.ok) fail();
	const data = (await response.json()) as ArtifactMetadata;
	verifyArtifactMetadata(data, Date.now());
	return data;
}
export async function verifyHostedReuse(
	compressed: Buffer,
	token: string,
	fetcher: typeof fetch = fetch,
) {
	const metadata = await freshArtifactMetadata(token, fetcher);
	return inspectRetainedTar(compressed, metadata, Date.now());
}
export function verifyArtifactMetadata(data: ArtifactMetadata, nowMs: number) {
	if (!Number.isFinite(nowMs)) fail();
	if (
		data.id !== RETAINED.artifactID ||
		data.expired !== false ||
		data.workflow_run?.id !== RETAINED.runID ||
		data.workflow_run?.head_sha !== RETAINED.sourceSHA ||
		!Number.isFinite(Date.parse(data.expires_at)) ||
		Date.parse(data.expires_at) <= nowMs
	)
		fail();
}
export interface TarMember {
	mode?: number;
	name: string;
	type: "file" | "directory" | "symlink";
	link?: string;
	size: number;
}
function safeName(name: string) {
	if (
		!name ||
		name.includes("\0") ||
		name.includes("\\") ||
		posix.isAbsolute(name) ||
		name.split("/").includes("..")
	)
		fail();
	const normalized = posix.normalize(name).replace(/\/$/, "");
	if (normalized === "." || normalized.startsWith("../")) fail();
	return normalized;
}
export function validateMembers(members: TarMember[]) {
	if (members.length > 50000) fail();
	const names = new Set<string>(),
		links = new Set<string>();
	let size = 0;
	for (const member of members) {
		const name = safeName(member.name);
		if (names.has(name)) fail();
		names.add(name);
		if (!Number.isSafeInteger(member.size) || member.size < 0) fail();
		if (
			member.mode !== undefined &&
			(!Number.isInteger(member.mode) || member.mode < 0 || member.mode > 0o777)
		)
			fail();
		size += member.size;
		if (size > 1024 ** 3) fail();
		if (member.type !== "file" && member.size !== 0) fail();
		if (member.type === "symlink") {
			links.add(name);
			const target = member.link ?? "";
			// The parent directory ITSELF is outside the extraction root too;
			// checking only its descendants ("../...") misses this boundary.
			const destination = posix.normalize(
				posix.join(posix.dirname(name), target),
			);
			if (
				!target ||
				posix.isAbsolute(target) ||
				target.includes("\\") ||
				destination === ".." ||
				destination.startsWith("../")
			)
				fail();
		} else if (member.type !== "file" && member.type !== "directory") fail();
	}
	for (const name of names)
		for (const link of links) if (name.startsWith(link + "/")) fail();
	return members;
}
/** Parse BEFORE extraction, including PAX path/linkpath overrides. Reject GNU
 * longname/global metadata rather than delegate unknown naming to tar. */
export function inspectRetainedTar(
	compressed: Buffer,
	metadata: ArtifactMetadata,
	nowMs: number,
) {
	verifyArtifactMetadata(metadata, nowMs);
	if (
		compressed.length > 512 * 1024 ** 2 ||
		createHash("sha256").update(compressed).digest("hex") !== RETAINED.tarSHA256
	)
		fail();
	return inspectTarBytes(
		gunzipSync(compressed, { maxOutputLength: 1024 ** 3 + 32 * 1024 ** 2 }),
	);
}
export function inspectTarBytes(bytes: Buffer): TarMember[] {
	const members: TarMember[] = [];
	let at = 0,
		pax: Record<string, string> = {};
	const text = (buf: Buffer) =>
		new TextDecoder("utf-8", { fatal: true }).decode(buf).split("\0")[0] ?? "";
	while (at + 512 <= bytes.length) {
		const header = bytes.subarray(at, at + 512);
		if (header.every((v) => v === 0)) {
			if (Object.keys(pax).length || bytes.subarray(at).some((v) => v !== 0))
				fail();
			return validateMembers(members);
		}
		const oct = (b: Buffer) => {
			const value = text(b).trim();
			if (!/^[0-7]+$/.test(value)) fail();
			return parseInt(value, 8);
		};
		const expected = oct(header.subarray(148, 156));
		let sum = 0;
		for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
		if (sum !== expected) fail();
		if (text(header.subarray(257, 263)) !== "ustar") fail();
		const size = oct(header.subarray(124, 136));
		if (size > 1024 ** 3 || at + 512 + size > bytes.length) fail();
		const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]!);
		const prefix = text(header.subarray(345, 500));
		let name = prefix
			? prefix + "/" + text(header.subarray(0, 100))
			: text(header.subarray(0, 100));
		const body = bytes.subarray(at + 512, at + 512 + size);
		at += 512 + Math.ceil(size / 512) * 512;
		if (type === "x") {
			if (size > 65536 || Object.keys(pax).length) fail();
			let cursor = 0;
			while (cursor < body.length) {
				const space = body.indexOf(32, cursor);
				if (space < 0) fail();
				const length = Number(body.toString("ascii", cursor, space));
				if (
					!Number.isSafeInteger(length) ||
					length <= space - cursor + 1 ||
					cursor + length > body.length ||
					body[cursor + length - 1] !== 10
				)
					fail();
				const raw = body.subarray(space + 1, cursor + length - 1);
				if (raw.includes(0)) fail();
				const record = text(raw),
					equal = record.indexOf("=");
				if (equal < 1) fail();
				const key = record.slice(0, equal);
				if (
					!["path", "linkpath", "mtime", "atime", "ctime"].includes(key) ||
					Object.hasOwn(pax, key)
				)
					fail();
				pax[key] = record.slice(equal + 1);
				cursor += length;
			}
			continue;
		}
		name = pax.path ?? name;
		const link = pax.linkpath ?? text(header.subarray(157, 257));
		pax = {};
		if (!["0", "5", "2"].includes(type)) fail();
		members.push({
			mode: oct(header.subarray(100, 108)),
			name,
			type: type === "0" ? "file" : type === "5" ? "directory" : "symlink",
			size,
			...(type === "2" ? { link } : {}),
		});
	}
	return fail();
}

/** Only after inspectRetainedTar passes and a private extraction is complete.
 * Original nonce/port/source are read, never rewritten to the runner commit. */
export function verifyExtractedRetained(root: string) {
	const apps = readdirSync(root).filter((name) => name.endsWith(".app"));
	if (apps.length !== 1) fail();
	const app = join(root, apps[0]!);
	if (!lstatSync(app).isDirectory() || lstatSync(app).isSymbolicLink()) fail();
	const frozen = JSON.parse(
		readFileSync(join(root, "frozen-artifact.json"), "utf8"),
	) as Record<string, unknown>;
	const build = JSON.parse(
		readFileSync(join(root, "build-identity.json"), "utf8"),
	) as Record<string, unknown>;
	if (
		frozen.sourceSha !== RETAINED.sourceSHA ||
		frozen.bundleSha256 !== RETAINED.bundleSHA256 ||
		frozen.flavor !== "auth-retirement-proof" ||
		frozen.bundleId !== "com.localoperator.mobile.retirementproof" ||
		frozen.schemeRegistered !== true ||
		typeof frozen.nonce !== "string" ||
		!/^[a-f0-9]{32}$/.test(frozen.nonce) ||
		!Number.isInteger(frozen.receiverPort) ||
		Number(frozen.receiverPort) < 20000 ||
		Number(frozen.receiverPort) > 39999
	)
		fail();
	for (const key of [
		"nonce",
		"receiverPort",
		"sourceSha",
		"flavor",
		"bundleId",
	])
		if (frozen[key] !== build[key]) fail();
	if (immutableBundleDigest(app) !== RETAINED.bundleSHA256) fail();
	return {
		app,
		originalSource: RETAINED.sourceSHA,
		originalReceiverPort: frozen.receiverPort,
		originalNonce: frozen.nonce,
	};
}
