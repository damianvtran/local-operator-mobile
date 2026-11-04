"use strict";
// Session-owned gate: no native command begins until its wrapper PID has been
// registered with the outer watchdog and any creation journal is durable.
// stdout/stderr are owned by the parent; nothing is logged by this wrapper.
const { spawn } = require("node:child_process");
// `--merge-stderr` (runner failure tail only): the command's stderr is sent
// to THIS wrapper's stdout pipe (fd 1) instead of inheriting fd 2. Node leaves
// its own stderr pipe O_NONBLOCK, and a child inheriting that description got
// EAGAIN on heavy writes and silently LOST bytes (measured: 196608 of 200000
// stderr bytes arrived under load). fd 1 stays blocking, and one pipe also
// keeps the true write order, so the ring's final bytes are the final lines.
const argv = process.argv.slice(2);
const merge = argv[0] === "--merge-stderr";
const [exe, ...args] = merge ? argv.slice(1) : argv;
let started = false;
process.stdin.once("data", (bytes) => {
	if (started || bytes.toString() !== "G" || !exe) process.exit(125);
	started = true;
	const child = spawn(exe, args, {
		stdio: merge ? ["inherit", "inherit", 1] : "inherit",
		detached: false,
	});
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
