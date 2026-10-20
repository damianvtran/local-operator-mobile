/** Full existing mock-relay surface plus the private pinned-core policy facade.
 * Run only in an owned bounded process group; this is a fixture, not a service.
 * No source/runtime/SDK dependency is installed and no browser is launched.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createCanonicalPolicyFixture,
	type PolicyFixtureMode,
} from "./account-routing.ts";
import { createRelay } from "./relay.ts";

const MODES: readonly PolicyFixtureMode[] = [
	"normal",
	"old-relay",
	"malformed",
	"forbid-write",
	"drop-after-write",
];
function isMode(value: string): value is PolicyFixtureMode {
	return MODES.some((mode) => mode === value);
}
function delay(value: string | undefined) {
	const result = Number(value ?? "0");
	if (!Number.isFinite(result) || result < 0 || result > 2000)
		throw new Error("fixture delay must be within0..2000ms");
	return result;
}
async function main() {
	const scratch =
		process.env.LOCAL_OPERATOR_SCRATCHPAD ??
		(process.env.GITHUB_ACTIONS === "true"
			? process.env.RUNNER_TEMP
			: undefined);
	const python = process.env.LOH12_CORE_PYTHON;
	const coreRoot = process.env.LOH12_CORE_ROOT;
	const profile = process.env.LOH12_POLICY_PROFILE ?? "a";
	const mode = process.env.LOH12_POLICY_MODE ?? "normal";
	if (
		!scratch ||
		!python ||
		!coreRoot ||
		(profile !== "a" && profile !== "b") ||
		!isMode(mode)
	)
		throw new Error(
			"missing private fixture prerequisites or unknown profile/mode",
		);
	const privateRoot =
		process.env.LOH12_POLICY_PRIVATE_ROOT ??
		join(scratch, `canonical-policy-server-${randomUUID()}`);
	const fixture = createCanonicalPolicyFixture({
		python,
		coreRoot,
		privateRoot,
		profile,
	});
	fixture.controls.mode = mode;
	fixture.controls.readDelayMs = delay(process.env.LOH12_POLICY_READ_DELAY_MS);
	fixture.controls.writeDelayMs = delay(
		process.env.LOH12_POLICY_WRITE_DELAY_MS,
	);
	const relay = createRelay({ accountRouting: fixture });
	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		await relay.shutdown();
	};
	process.once("SIGTERM", () => {
		void stop();
	});
	process.once("SIGINT", () => {
		void stop();
	});
	try {
		const bound = await relay.listen();
		// Never print the login password, session value or a Cookie header. The
		// unique hostname/name/path/time are the browser containment receipt, not
		// permission to visit it or proof the native/OS resolver supports it.
		const receipt = {
			...fixture.identity,
			advertisedOrigin: bound.url,
			mode,
			readDelayMs: fixture.controls.readDelayMs,
			writeDelayMs: fixture.controls.writeDelayMs,
			note: "DNS/browser/native routing and compiled/rendered proof still require independent preflight; no shared-IP fallback",
		};
		writeFileSync(
			join(scratch, `canonical-policy-server-${profile}-${Date.now()}.json`),
			JSON.stringify(receipt, null, 2),
			{ flag: "wx", mode: 0o600 },
		);
		console.log(JSON.stringify(receipt));
		// The existing relay owns sockets/timers. A supervisor MUST reap this
		// exact process group, including any synchronous Python bridge attempt.
	} catch (error) {
		await stop();
		throw error;
	}
}
if (import.meta.main)
	void main().catch((error: unknown) => {
		console.error(
			error instanceof Error
				? error.message
				: "canonical fixture startup failed",
		);
		process.exitCode = 1;
	});
