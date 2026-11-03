"use strict";
// Session-owned gate: no native command begins until its wrapper PID has been
// registered with the outer watchdog and any creation journal is durable.
// stdout/stderr are owned by the parent; nothing is logged by this wrapper.
const { spawn } = require("node:child_process");
const [exe, ...args] = process.argv.slice(2);
let started = false;
process.stdin.once("data", (bytes) => {
	if (started || bytes.toString() !== "G" || !exe) process.exit(125);
	started = true;
	const child = spawn(exe, args, { stdio: "inherit", detached: false });
	child.once("error", () => process.exit(126));
	child.once("exit", (code, signal) =>
		process.exit(
			code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 137),
		),
	);
});
process.stdin.once("end", () => {
	if (!started) process.exit(125);
});
