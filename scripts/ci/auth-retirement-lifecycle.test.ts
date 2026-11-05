/** True OS subprocess evidence, separate from mocked scheduling-boundary tests.
 * Every descendant stays in this command's detached group, has its own watchdog,
 * and is reaped by that exact group in the test finally as well as by command(). */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	activeProofDiagnostics,
	withProofDiagnostics,
} from "./auth-retirement-diagnostics.ts";
import { command } from "./auth-retirement-ios-proof.ts";

const fresh = () =>
	mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "lifecycle-proof-"),
	);
async function reapOwned(pids: number[]) {
	const [leader] = pids;
	if (
		typeof leader !== "number" ||
		!Number.isSafeInteger(leader) ||
		leader <= 1 ||
		leader === process.pid
	)
		throw new Error("Owned test process group identity missing");
	try {
		process.kill(-leader, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
	let gone = false;
	for (let i = 0; i < 100; i++) {
		try {
			process.kill(-leader, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			gone = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(gone).toBe(true);
}
async function observe(mode: "pipe" | "running" | "quick") {
	const root = fresh(),
		pidFile = join(root, "owned-pids.json");
	const script =
		mode === "pipe"
			? `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{stdio:['ignore',1,2]});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,c.pid]));c.unref();process.exit(0);`
			: `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid]));${mode === "running" ? "setTimeout(()=>{},3000);" : "process.stdout.write('ok');"}`;
	let accepted = false;
	try {
		await withProofDiagnostics(root, async () => {
			activeProofDiagnostics?.checkpoint("install");
			await command(process.execPath, ["-e", script], 1000);
			accepted = true;
			// Publish observations for the successful control without claiming failure
			// of that command: the enclosing synthetic checkpoint deliberately fails.
			throw new Error("SYNTHETIC_SECRET_NO_RAW_EXCEPTION");
		}).catch(() => {});
		const receipt = JSON.parse(
			readFileSync(join(root, "failure.json"), "utf8"),
		);
		expect(JSON.stringify(receipt)).not.toContain(pidFile);
		expect(JSON.stringify(receipt)).not.toContain("SYNTHETIC_SECRET");
		return { accepted, receipt };
	} finally {
		if (existsSync(pidFile)) {
			await reapOwned(JSON.parse(readFileSync(pidFile, "utf8")));
		}
	}
}
it("observes OS exit0 before deadline while an owned descendant holds inherited pipes", async () => {
	const { accepted, receipt } = await observe("pipe");
	expect(accepted).toBe(false);
	expect(receipt.command).toMatchObject({
		outcome: "timeout",
		exitCode: 0,
		signal: null,
	});
	const l = receipt.command.lifecycle;
	expect(l).toBeDefined();
	expect(l.exitAfterMs).toBeLessThan(l.timerAfterMs);
	expect(l.exitCode).toBe(0);
	expect(l.closeAfterMs).toBeGreaterThanOrEqual(l.timerAfterMs);
	expect(l.killResult).toBe("sent");
});
it("distinguishes a producer still running when its owned group is killed", async () => {
	const { accepted, receipt } = await observe("running");
	expect(accepted).toBe(false);
	expect(receipt.command.outcome).toBe("timeout");
	const l = receipt.command.lifecycle;
	expect(l).toBeDefined();
	expect(l.exitAfterMs).toBeGreaterThanOrEqual(l.timerAfterMs);
	expect(l.exitSignal).toBe("SIGKILL");
});
it("accepts ordinary OS zero exit below deadline with no fired timeout", async () => {
	const { accepted, receipt } = await observe("quick");
	expect(accepted).toBe(true);
	expect(receipt.command.outcome).toBe("success");
	const l = receipt.command.lifecycle;
	expect(l).toBeDefined();
	expect(l.timerAfterMs).toBeNull();
	expect(l.exitCode).toBe(0);
	expect(l.closeAfterMs).toBeLessThan(l.budgetMs);
});
