/** Trusted CI coordinator, not a general producer-authentication protocol.
 * Ephemeral loopback bearer protects this session. Only live host measurements
 * authorize query/tap; runner assertions can supply observations, never identity.
 * A public tap cannot atomically lock process lifetime through OS event delivery.
 */
import { createHash, randomBytes } from "node:crypto";
export class ReplayRefused extends Error {
	constructor(readonly code: string) {
		super("Retained seed replay refused");
	}
}
export class Deadline {
	readonly end: number;
	constructor(
		ms: number,
		readonly clock: () => number = () => performance.now(),
	) {
		this.end = clock() + ms;
	}
	remaining() {
		return Math.max(0, this.end - this.clock());
	}
	cap(ms: number) {
		const left = Math.floor(Math.min(ms, this.remaining()));
		if (left <= 0) throw new ReplayRefused("deadline");
		return left;
	}
	require(ms: number) {
		if (this.remaining() < ms) throw new ReplayRefused("insufficient-window");
	}
}
export type ReplayMode = "observe-only" | "seed-replay";
export function replayMode(value: unknown): ReplayMode {
	if (value !== "observe-only" && value !== "seed-replay")
		throw new ReplayRefused("mode");
	return value;
}
export type Observation = {
	scope: "system-open-alert-v1";
	count: number;
	titles: number[][];
	buttons: number[][];
};
export const scalarValues = (value: string) =>
	Array.from(value, (character) => character.codePointAt(0)!);
export const TITLE_SCALARS = scalarValues("Open in “Local Operator”?");
export function validateObservation(input: unknown): Observation {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new ReplayRefused("observation-schema");
	const v = input as Record<string, unknown>;
	const matrix = (a: unknown) =>
		Array.isArray(a) &&
		a.length <= 8 &&
		a.every(
			(row) =>
				Array.isArray(row) &&
				row.length <= 256 &&
				row.every(
					(n) =>
						Number.isInteger(n) &&
						n >= 0 &&
						n <= 0x10ffff &&
						!(n >= 0xd800 && n <= 0xdfff),
				),
		);
	if (
		Object.keys(v).sort().join(",") !== "buttons,count,scope,titles" ||
		v.scope !== "system-open-alert-v1" ||
		!Number.isInteger(v.count) ||
		Number(v.count) < 0 ||
		Number(v.count) > 8 ||
		!matrix(v.titles) ||
		!matrix(v.buttons)
	)
		throw new ReplayRefused("observation-schema");
	// Copy untrusted arrays: later caller mutation must not rewrite attestation.
	return {
		scope: "system-open-alert-v1",
		count: Number(v.count),
		titles: (v.titles as number[][]).map((row) => [...row]),
		buttons: (v.buttons as number[][]).map((row) => [...row]),
	};
}
export function fingerprint(o: Observation) {
	return createHash("sha256")
		.update(
			`system-open-alert-v1|${o.count}|${o.titles.length}|${o.titles.map((row) => row.join(",")).join(";")}|${o.buttons.length}|${o.buttons.map((row) => row.join(",")).join(";")}`,
		)
		.digest("hex");
}
export function exactPrompt(o: Observation) {
	return (
		o.count === 1 &&
		o.titles.length === 1 &&
		JSON.stringify(o.titles[0]) === JSON.stringify(TITLE_SCALARS) &&
		o.buttons.length === 2 &&
		o.buttons
			.map((row) => row.join(","))
			.sort()
			.join(";") ===
			[scalarValues("Cancel").join(","), scalarValues("Open").join(",")]
				.sort()
				.join(";")
	);
}
export interface LiveIdentity {
	udid: string;
	pid: number;
	label: string;
	source: string;
	bundle: string;
	hostSource: string;
}
export interface Permit {
	version: 1;
	kind: string;
	session: string;
	challenge: string;
	issuedAt: number;
	expiresAt: number;
	phase: "seed";
	openAt: number | null;
	identity: LiveIdentity | null;
	fingerprint: string | null;
}
/** Grant expiry is checked at ACTUAL use, with a monotonic local lifetime too.
 * Repeating identity fields in a request never substitutes for sampler output. */
export function validatePermit(
	value: Permit,
	expected: {
		kind: string;
		session: string;
		challenge: string;
		identity: LiveIdentity;
		fingerprint?: string;
	},
	now: number,
	elapsedMs: number,
) {
	if (
		value.version !== 1 ||
		value.kind !== expected.kind ||
		value.session !== expected.session ||
		value.challenge !== expected.challenge ||
		value.phase !== "seed" ||
		!Number.isFinite(now) ||
		!Number.isFinite(elapsedMs) ||
		elapsedMs < 0 ||
		elapsedMs > 2000 ||
		!Number.isFinite(value.issuedAt) ||
		!Number.isFinite(value.expiresAt) ||
		now < value.issuedAt ||
		now >= value.expiresAt ||
		now - value.issuedAt > 2000 ||
		JSON.stringify(value.identity) !== JSON.stringify(expected.identity) ||
		(expected.fingerprint !== undefined &&
			value.fingerprint !== expected.fingerprint)
	)
		throw new ReplayRefused("permit");
}
export class GrantSession {
	readonly id = randomBytes(24).toString("hex");
	readonly bearer = randomBytes(32).toString("hex");
	readonly mode: ReplayMode;
	stage:
		| "bootstrap"
		| "url"
		| "query-reserved"
		| "queried"
		| "observed"
		| "tap-reserved"
		| "granted"
		| "terminal" = "bootstrap";
	readonly challenges = new Set<string>();
	observed?: Observation;
	queryIdentity?: LiveIdentity;
	tapIdentity?: LiveIdentity;
	runnerReady = false;
	tapIssued = false;
	openAt: number | null = null;
	receiptEnd: number | null = null;
	queryPermitExpires: number | null = null;
	constructor(
		mode: ReplayMode,
		readonly deadline: Deadline,
		readonly sample: () => Promise<LiveIdentity>,
		readonly artifactExpiry: () => number,
		readonly now: () => number = Date.now,
		readonly monotonic: () => number = () => performance.now(),
	) {
		this.mode = replayMode(mode);
	}
	opened() {
		if (this.stage !== "bootstrap" || !this.runnerReady)
			throw new ReplayRefused("stage");
		this.deadline.require(70000);
		this.openAt = this.now();
		this.receiptEnd = this.openAt + 60000;
		this.stage = "url";
	}
	private active() {
		const expiry = this.artifactExpiry();
		if (
			this.deadline.remaining() <= 0 ||
			!Number.isFinite(expiry) ||
			this.now() >= expiry ||
			this.receiptEnd === null ||
			this.now() >= this.receiptEnd ||
			this.openAt === null ||
			this.now() < this.openAt
		)
			throw new ReplayRefused("expired-window");
	}
	private async measured() {
		const started = this.monotonic();
		const value = await this.sample();
		this.active();
		if (this.monotonic() - started > 5000)
			throw new ReplayRefused("stale-sample");
		if (
			!Number.isSafeInteger(value.pid) ||
			value.pid <= 0 ||
			!value.udid ||
			!value.label
		)
			throw new ReplayRefused("sample");
		return { ...value };
	}
	async request(
		kind: string,
		challenge: string,
		observation?: unknown,
	): Promise<Permit> {
		if (!/^[a-f0-9]{64}$/.test(challenge) || this.challenges.has(challenge))
			throw new ReplayRefused("challenge");
		this.challenges.add(challenge);
		if (kind === "runner-ready") {
			if (
				this.runnerReady ||
				this.stage !== "bootstrap" ||
				observation !== undefined
			)
				throw new ReplayRefused("stage");
			this.runnerReady = true;
			return this.reply(kind, challenge);
		}
		this.active();
		if (kind === "before-observe") {
			if (this.stage !== "url" || observation !== undefined)
				throw new ReplayRefused("stage");
			// Reserve BEFORE awaiting. A failed sample/lost reply consumes query forever.
			this.stage = "query-reserved";
			try {
				this.queryIdentity = await this.measured();
				if (this.stage !== "query-reserved") throw new ReplayRefused("stage");
				this.stage = "queried";
				const permit = this.reply("query", challenge, this.queryIdentity);
				this.queryPermitExpires = permit.expiresAt;
				return permit;
			} catch (error) {
				this.stage = "terminal";
				throw error;
			}
		}
		if (kind === "observed") {
			if (this.stage !== "queried" || !this.queryIdentity)
				throw new ReplayRefused("stage");
			this.stage = "terminal";
			this.observed = validateObservation(observation);
			if (!exactPrompt(this.observed))
				throw new ReplayRefused("prompt-mismatch");
			if (this.mode === "observe-only")
				return this.reply(
					"observe-complete",
					challenge,
					this.queryIdentity,
					fingerprint(this.observed),
				);
			this.stage = "observed";
			return this.reply(
				"observed",
				challenge,
				this.queryIdentity,
				fingerprint(this.observed),
			);
		}
		if (kind === "authorize-tap") {
			if (
				this.mode !== "seed-replay" ||
				this.stage !== "observed" ||
				this.tapIssued ||
				!this.observed ||
				!this.queryIdentity
			)
				throw new ReplayRefused("stage");
			this.tapIssued = true;
			this.stage = "tap-reserved";
			try {
				const observed = validateObservation(observation);
				if (fingerprint(observed) !== fingerprint(this.observed))
					throw new ReplayRefused("fingerprint");
				this.tapIdentity = await this.measured();
				if (this.stage !== "tap-reserved") throw new ReplayRefused("stage");
				if (
					JSON.stringify(this.tapIdentity) !==
					JSON.stringify(this.queryIdentity)
				)
					throw new ReplayRefused("changed-process");
				this.stage = "granted";
				return this.reply(
					"tap",
					challenge,
					this.tapIdentity,
					fingerprint(observed),
				);
			} catch (error) {
				this.stage = "terminal";
				throw error;
			}
		}
		if (kind === "after-tap") {
			if (this.stage !== "granted" || observation !== undefined)
				throw new ReplayRefused("stage");
			this.stage = "terminal";
			return this.reply("terminal", challenge, this.tapIdentity);
		}
		throw new ReplayRefused("rpc-kind");
	}
	private reply(
		kind: string,
		challenge: string,
		identity?: LiveIdentity,
		observedFingerprint?: string,
	): Permit {
		const issuedAt = this.now();
		return {
			version: 1,
			kind,
			session: this.id,
			challenge,
			issuedAt,
			expiresAt: Math.min(
				issuedAt + 2000,
				this.receiptEnd ?? Infinity,
				this.artifactExpiry(),
			),
			phase: "seed",
			openAt: this.openAt,
			identity: identity ?? null,
			fingerprint: observedFingerprint ?? null,
		};
	}
}
