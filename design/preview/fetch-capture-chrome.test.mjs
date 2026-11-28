// node:test only (the design-kit job installs no node dependencies). Exercises
// fetch-capture-chrome.sh for real: a fixture archive laid out like Chrome for
// Testing's mac-arm64 zip is served through file://, so the download, checksum,
// unpack and version checks all run — only the network and the browser are stubbed.
// macOS-only: the script unpacks with `ditto`, as the macos-26 job does.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./fetch-capture-chrome.sh", import.meta.url).pathname;
const committedPin = new URL("./capture-chrome.pin", import.meta.url).pathname;
const darwin = { skip: process.platform !== "darwin" && "fetch-capture-chrome.sh unpacks with macOS ditto" };
const VERSION = "158.0.8127.37";

/** Serve a fixture archive whose "browser" prints `reported`, and run the script
 * against a pin made from `pin(sha256OfTheArchive)`. */
const run = ({ reported = `Google Chrome for Testing ${VERSION} `, pin = (sha) => `version=${VERSION}\nsha256=${sha}\n`, serve = true }, check) => {
	const root = mkdtempSync(join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "fetch-capture-chrome-"));
	try {
		const macos = join(root, "fixture", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS");
		mkdirSync(macos, { recursive: true });
		const binary = join(macos, "Google Chrome for Testing");
		writeFileSync(binary, `#!/bin/sh\necho '${reported}'\n`);
		chmodSync(binary, 0o755);
		const served = join(root, "bucket", VERSION, "mac-arm64");
		mkdirSync(served, { recursive: true });
		const zip = join(served, "chrome-mac-arm64.zip");
		const packed = spawnSync("ditto", ["-c", "-k", "--keepParent", join(root, "fixture", "chrome-mac-arm64"), zip]);
		assert.equal(packed.status, 0, String(packed.stderr));
		const sha = createHash("sha256").update(readFileSync(zip)).digest("hex");
		if (!serve) rmSync(zip);
		const pinFile = join(root, "capture-chrome.pin");
		writeFileSync(pinFile, pin(sha));
		const dest = join(root, "frozen");
		const child = spawnSync("bash", [script, pinFile, dest], {
			encoding: "utf8",
			timeout: 60_000,
			env: { ...process.env, CAPTURE_CHROME_DOWNLOAD_BASE: `file://${join(root, "bucket")}` },
		});
		return check({ child, dest, sha, root });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

test("a matching archive unpacks and the script prints the pinned binary's path", darwin, () => run({}, ({ child, dest }) => {
	assert.equal(child.status, 0, child.stderr);
	const printed = child.stdout.trim();
	assert.equal(printed, join(dest, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
	assert.ok(existsSync(printed));
	assert.match(child.stderr, /sha256 verified/);
	assert.ok(!existsSync(`${dest}.zip`), "the archive is removed once unpacked");
}));

// Negative control: the discriminating case for the whole change. A download that
// is not the pinned bytes must stop the job, extract nothing, and never fall back.
test("FAILS closed on a checksum mismatch: no unpack, no fallback to another Chrome", darwin, () => run({
	pin: () => `version=${VERSION}\nsha256=${"0".repeat(64)}\n`,
}, ({ child, dest, sha }) => {
	assert.equal(child.status, 1);
	assert.match(child.stderr, /::error::capture renderer pin: sha256 mismatch/);
	assert.ok(child.stderr.includes(sha), "names the checksum it actually got");
	assert.equal(child.stdout, "", "prints no binary path to use");
	assert.ok(!existsSync(dest), "nothing was unpacked");
	assert.ok(!existsSync(`${dest}.zip`), "the unverified archive is removed");
}));

test("FAILS when the verified archive's binary reports another version than the pin", darwin, () => run({
	reported: "Google Chrome for Testing 157.0.8103.79 ",
}, ({ child }) => {
	assert.equal(child.status, 1);
	assert.match(child.stderr, /reports 'Google Chrome for Testing 157\.0\.8103\.79 ', not the pinned 158\.0\.8127\.37/);
	assert.equal(child.stdout, "");
}));

test("FAILS when the archive cannot be downloaded", darwin, () => run({ serve: false }, ({ child, dest }) => {
	assert.equal(child.status, 1);
	assert.match(child.stderr, /could not download/);
	assert.ok(!existsSync(dest));
}));

test("FAILS on a malformed pin (empty, short, uppercase or duplicated values never compare equal to anything)", darwin, () => {
	const bad = [
		() => `version=${VERSION}\nsha256=\n`,
		() => `version=${VERSION}\nsha256=abc123\n`,
		(sha) => `version=${VERSION}\nsha256=${sha.toUpperCase()}\n`,
		(sha) => `version=${VERSION}\nsha256=${sha}\nsha256=${sha}\n`,
		(sha) => `version=157.0\nsha256=${sha}\n`,
		(sha) => `sha256=${sha}\n`,
	];
	for (const pin of bad) {
		run({ pin }, ({ child, dest }) => {
			assert.equal(child.status, 1, child.stderr);
			assert.match(child.stderr, /::error::capture renderer pin: /);
			assert.ok(!existsSync(dest));
		});
	}
});

// The committed pin is what CI actually reads: pin its shape and the one fact the
// frames depend on (the version they were rendered with), so a bump that forgets
// to regenerate them is a visible diff in this file too.
test("the committed pin is well formed and names the build the committed frames were rendered with", () => {
	const text = readFileSync(committedPin, "utf8");
	assert.match(text, /^version=\d+\.\d+\.\d+\.\d+$/m);
	assert.match(text, /^sha256=[0-9a-f]{64}$/m);
	assert.equal(text.match(/^version=(.*)$/m)[1], "158.0.8127.37");
	assert.equal(text.match(/^sha256=(.*)$/m)[1], "45925b7ea18e09bf0d5acdae4e36b57cb7ed08ada8dfc0e0c6422f86a3384c9d");
});
