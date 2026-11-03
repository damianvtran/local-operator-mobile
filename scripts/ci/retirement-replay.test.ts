import { randomBytes, randomInt } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyModes } from "./retirement-replay-artifacts.ts";
import {
	Deadline,
	exactPrompt,
	fingerprint,
	GrantSession,
	type LiveIdentity,
	type Observation,
	scalarValues,
	validateObservation,
	validatePermit,
} from "./retirement-replay-core.ts";
import { exactProcess } from "./retirement-replay-native.ts";
import { deferred, ReplayTransport } from "./retirement-replay-transport.ts";

const identity: LiveIdentity = {
	udid: "owned-fixture-device",
	pid: 123,
	label: "UIKitApplication:com.localoperator.mobile.retirementproof[owned]",
	source: "78ff786a7ef173560b7fb67e29a9e20eb9ca6f8b",
	bundle: "9c667250a1e0a8d5dc129495a8f1bd734e201ec5bfbae8bd7b863e4f951574e7",
	hostSource: "c".repeat(40),
};
const observation = (): Observation => ({
	scope: "system-open-alert-v1",
	count: 1,
	titles: [scalarValues("Open in “Local Operator”?")],
	buttons: [scalarValues("Cancel"), scalarValues("Open")],
});
const challenge = () => randomBytes(32).toString("hex");
const roots: string[] = [];
const rigs: ReplayTransport[] = [];
afterEach(async () => {
	await Promise.all(rigs.splice(0).map((rig) => rig.close()));
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
async function fixture(
	mode: "observe-only" | "seed-replay" = "seed-replay",
	sample: () => Promise<LiveIdentity> = async () => ({ ...identity }),
) {
	const original = {
		nonce: "a".repeat(32),
		receiverPort: randomInt(20000, 40000),
		sourceSha: identity.source,
		flavor: "auth-retirement-proof",
	};
	const session = new GrantSession(
		mode,
		new Deadline(300000),
		sample,
		() => Date.now() + 100000,
	);
	const rig = new ReplayTransport(original, session, session.deadline);
	rigs.push(rig);
	const control = await rig.listen();
	const rpc = (
		kind: string,
		extra: Record<string, unknown> = {},
		bearer = session.bearer,
	) =>
		fetch(control, {
			method: "POST",
			headers: {
				authorization: `Bearer ${bearer}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				session: session.id,
				kind,
				challenge: challenge(),
				...extra,
			}),
			signal: AbortSignal.timeout(5000),
		});
	const seed = (path: string, body: unknown, nonce = original.nonce) =>
		fetch(`http://127.0.0.1:${original.receiverPort}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-proof-nonce": nonce },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(5000),
		});
	const ready = async () => {
		expect((await rpc("runner-ready")).status).toBe(200);
		rig.armReady();
		expect(
			(
				await seed("/ready", {
					kind: "listener-ready",
					flavor: original.flavor,
					sourceSha: original.sourceSha,
				})
			).status,
		).toBe(204);
		rig.open();
	};
	return { original, session, rig, control, rpc, seed, ready };
}
describe("trusted-CI replay live RPC and frozen seed receiver", () => {
	it("real localhost positive chain needs separate query/tap samples and original seed transport", async () => {
		let samples = 0;
		const f = await fixture("seed-replay", async () => {
			samples++;
			return { ...identity };
		});
		await f.ready();
		const q = await (await f.rpc("before-observe")).json();
		expect(q.kind).toBe("query");
		expect(samples).toBe(1);
		expect(
			(await f.rpc("observed", { observation: observation() })).status,
		).toBe(200);
		const tap = await (
			await f.rpc("authorize-tap", { observation: observation() })
		).json();
		expect(tap.kind).toBe("tap");
		expect(samples).toBe(2);
		expect(f.session.tapIdentity).toEqual(identity);
		validatePermit(
			tap,
			{
				kind: "tap",
				session: f.session.id,
				challenge: tap.challenge,
				identity,
				fingerprint: fingerprint(observation()),
			},
			Date.now(),
			0,
		);
		expect(
			(
				await f.seed("/progress", {
					kind: "url-admitted",
					phase: "seed",
					flavor: f.original.flavor,
					sourceSha: f.original.sourceSha,
				})
			).status,
		).toBe(204);
		expect(
			(
				await f.seed("/receipt", {
					phase: "seed",
					ok: true,
					rawOauthPresent: true,
					flavor: f.original.flavor,
					sourceSha: f.original.sourceSha,
				})
			).status,
		).toBe(204);
		expect((await f.rig.receipt.promise).rawOauthPresent).toBe(true);
		expect((await f.rpc("after-tap")).status).toBe(200);
	});
	it("concurrent query requests reserve BEFORE the asynchronous sample, and duplicate tap cannot resample", async () => {
		const hold = deferred<LiveIdentity>();
		let samples = 0;
		const f = await fixture("seed-replay", () => {
			samples++;
			return samples === 1 ? hold.promise : Promise.resolve({ ...identity });
		});
		await f.ready();
		const pending = f.rpc("before-observe");
		while (samples === 0) await new Promise((yes) => setTimeout(yes, 1));
		expect((await f.rpc("before-observe")).status).toBe(400);
		expect(samples).toBe(1);
		hold.resolve({ ...identity });
		expect((await pending).status).toBe(200);
		await f.rpc("observed", { observation: observation() });
		expect(
			(await f.rpc("authorize-tap", { observation: observation() })).status,
		).toBe(200);
		expect(
			(await f.rpc("authorize-tap", { observation: observation() })).status,
		).toBe(400);
		expect(samples).toBe(2);
	});
	it("observe-only has no tap entitlement even with otherwise valid tap-shaped fields", async () => {
		let samples = 0;
		const f = await fixture("observe-only", async () => {
			samples++;
			return { ...identity };
		});
		await f.ready();
		await f.rpc("before-observe");
		const observed = await (
			await f.rpc("observed", { observation: observation() })
		).json();
		expect(observed.kind).toBe("observe-complete");
		expect(
			(await f.rpc("authorize-tap", { observation: observation() })).status,
		).toBe(400);
		expect(samples).toBe(1);
		expect(f.session.tapIssued).toBe(false);
	});
	it("wrong bearer/session or injected process/source facts do not invoke host sampling or seed", async () => {
		let samples = 0;
		const f = await fixture("seed-replay", async () => {
			samples++;
			return identity;
		});
		expect(
			(await f.rpc("before-observe", {}, "fixture-only-wrong")).status,
		).toBe(400);
		expect((await f.rpc("runner-ready", { session: "wrong" })).status).toBe(
			400,
		);
		expect(
			(await f.rpc("runner-ready", { proofPID: 123, source: identity.source }))
				.status,
		).toBe(400);
		expect(samples).toBe(0);
		expect(f.rig.readySeen).toBe(false);
		expect(f.rig.receiptSeen).toBe(false);
		expect(f.session.tapIssued).toBe(false);
	});
	it.each(["nonce", "source", "phase", "unknown", "token", "duplicate"])(
		"frozen seed refuses %s without advancing unauthorized state",
		async (kind) => {
			const f = await fixture();
			await f.ready();
			const body: Record<string, unknown> = {
				phase: "seed",
				ok: true,
				rawOauthPresent: true,
				flavor: f.original.flavor,
				sourceSha: f.original.sourceSha,
			};
			if (kind === "source") body.sourceSha = "b".repeat(40);
			if (kind === "phase") body.phase = "retire";
			if (kind === "unknown") body.privateText = "PRIVATE_TOKEN";
			if (kind === "duplicate")
				expect((await f.seed("/receipt", body)).status).toBe(204);
			const before = f.rig.receiptSeen;
			const result = await f.seed(
				kind === "token" ? "/token" : "/receipt",
				body,
				kind === "nonce" ? "bad" : f.original.nonce,
			);
			expect(result.status).toBe(400);
			expect(await result.text()).toBe("");
			expect(f.rig.receiptSeen).toBe(before);
			expect(f.session.tapIssued).toBe(false);
			expect(JSON.stringify(f.rig.refused)).not.toContain("PRIVATE_TOKEN");
		},
	);
	it("shutdown cancels waiting control request and owned servers refuse new connections", async () => {
		const f = await fixture();
		await f.rpc("runner-ready");
		const waiting = f.rpc("before-observe").catch(() => null);
		await new Promise((yes) => setTimeout(yes, 5));
		await f.rig.close();
		await waiting;
		expect(f.session.stage).toBe("terminal");
		await expect(
			fetch(f.control, { signal: AbortSignal.timeout(1000) }),
		).rejects.toThrow();
	});
});
describe("one-use/time/scalar controls", () => {
	it("permit expiry at actual use and monotonic lifetime both refuse stale query/tap", async () => {
		let now = 100000,
			clock = 0;
		const s = new GrantSession(
			"seed-replay",
			new Deadline(300000, () => clock),
			async () => ({ ...identity }),
			() => now + 100000,
			() => now,
			() => clock,
		);
		await s.request("runner-ready", challenge());
		s.opened();
		const c = challenge(),
			permit = await s.request("before-observe", c);
		expect(() =>
			validatePermit(
				permit,
				{ kind: "query", session: s.id, challenge: c, identity },
				now,
				0,
			),
		).not.toThrow();
		now += 2000;
		expect(() =>
			validatePermit(
				permit,
				{ kind: "query", session: s.id, challenge: c, identity },
				now,
				0,
			),
		).toThrow();
		expect(() =>
			validatePermit(
				permit,
				{ kind: "query", session: s.id, challenge: c, identity },
				permit.issuedAt,
				2001,
			),
		).toThrow();
	});
	it("failed/changed second live sample consumes the tap right and records actual tap measurement", async () => {
		let count = 0;
		const s = new GrantSession(
			"seed-replay",
			new Deadline(300000),
			async () => ({ ...identity, pid: ++count === 1 ? 123 : 124 }),
			() => Date.now() + 100000,
		);
		await s.request("runner-ready", challenge());
		s.opened();
		await s.request("before-observe", challenge());
		await s.request("observed", challenge(), observation());
		await expect(
			s.request("authorize-tap", challenge(), observation()),
		).rejects.toThrow();
		expect(s.tapIdentity?.pid).toBe(124);
		await expect(
			s.request("authorize-tap", challenge(), observation()),
		).rejects.toThrow();
		expect(count).toBe(2);
	});
	it("expired artifact, repeated challenge and exact Unicode/extra labels all refuse", async () => {
		let expiry = Date.now() + 100000;
		const s = new GrantSession(
			"seed-replay",
			new Deadline(300000),
			async () => identity,
			() => expiry,
		);
		const c = challenge();
		await s.request("runner-ready", c);
		await expect(s.request("runner-ready", c)).rejects.toThrow();
		s.opened();
		expiry = 0;
		await expect(s.request("before-observe", challenge())).rejects.toThrow();
		for (const value of [
			'Open in "Local Operator"?',
			"Open\u00a0in “Local Operator”?",
		]) {
			expect(
				exactPrompt({ ...observation(), titles: [scalarValues(value)] }),
			).toBe(false);
		}
		expect(
			exactPrompt({
				...observation(),
				titles: [...observation().titles, scalarValues("extra")],
			}),
		).toBe(false);
		expect(exactPrompt({ ...observation(), count: 2 })).toBe(false);
		expect(() =>
			validateObservation({ ...observation(), proofPID: 123 }),
		).toThrow();
	});
	it("remaining deadline never restarts a full stage cap and requires the original receipt window", () => {
		let t = 0;
		const d = new Deadline(300000, () => t);
		t = 250000;
		expect(d.cap(120000)).toBe(50000);
		expect(() => d.require(70000)).toThrow();
		t = 300000;
		expect(() => d.cap(1)).toThrow();
	});
	it.each([
		"-\t0\tUIKitApplication:com.localoperator.mobile.retirementproof[x]",
		"123 0 UIKitApplication:com.localoperator.mobile.retirementproof[x]",
		"124\t0\tcom.localoperator.mobile.retirementproof",
		"123\t0\tcom.localoperator.mobile.retirementproof\n123\t0\tcom.localoperator.mobile.retirementproof",
	])(
		"exact live process parser refuses stopped/malformed/replaced/duplicate",
		(output) => {
			expect(() => exactProcess(output, 123)).toThrow();
		},
	);

	it("authenticated tar mode comparison refuses nonexecutable extraction", () => {
		const root = mkdtempSync(join(tmpdir(), "replay-mode-"));
		roots.push(root);
		const file = join(root, "runner");
		writeFileSync(file, "");
		chmodSync(file, 0o755);
		const header = Buffer.alloc(512);
		header.write("runner", 0);
		header.write("0000755\0", 100);
		header.write("00000000000\0", 124);
		header.fill(32, 148, 156);
		header.write("0", 156);
		header.write("ustar\0", 257);
		let checksum = 0;
		for (const byte of header) checksum += byte;
		header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
		const tar = Buffer.concat([header, Buffer.alloc(1024)]);
		expect(verifyModes(root, tar)).toHaveLength(1);
		chmodSync(file, 0o644);
		expect(() => verifyModes(root, tar)).toThrow();
	});
	it("running exact label accepts but changed full UIKit identity does not", () => {
		const line =
			"123\t0\tUIKitApplication:com.localoperator.mobile.retirementproof[x]";
		expect(exactProcess(line, 123).pid).toBe(123);
		expect(() =>
			exactProcess(
				line,
				123,
				"UIKitApplication:com.localoperator.mobile.retirementproof[y]",
			),
		).toThrow();
	});
});
