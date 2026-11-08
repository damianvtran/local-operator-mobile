import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	activeLocale,
	catalogueLocaleFor,
	resetLocaleSource,
	setLocaleSource,
} from "../../src/i18n/locale.ts";
import { RelayEndpoints } from "../../src/relay/endpoints.ts";
import { RelayHttpClient } from "../../src/relay/http.ts";
import { createConfigStore } from "../../src/state/config-store.ts";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import {
	assertFrameInventory,
	collectProofFrames,
	PROJECT_CREATE_FRAMES,
} from "./projects-create-proof-contract.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	resetLocaleSource();
	for (const stop of cleanup.splice(0)) await stop();
});

// Keep the tooling contract at the actual wire client boundary: importing the
// app's startConfigStream lifecycle pulls @ aliases into the intentionally
// alias-free tools compilation. Mounted-provider consumption is exercised by
// the separate registered retirement control, not modeled as native proof here.
// Use the source catalogs of the EXACT already-built product, not #152's older
// source tree and not invented UI literals. This is not native render evidence.
const productHead = "91a3cbca1a2770e78dc5f216c2335b4b8126fe4d";
const catalog = (locale: string) =>
	JSON.parse(
		execFileSync(
			"git",
			[
				"show",
				`${productHead}:src/i18n/catalogues/${locale}/mobile.projects.json`,
			],
			{ encoding: "utf8" },
		),
	);
it.each(["ur", "ur-PK"])(
	"registered fixture negotiates %s and actual client validates list/create",
	async (language) => {
		const relay = createRelay({
			scenario: "projects-populated",
			language,
			password: "synthetic-only",
			quiet: true,
		});
		const listener = await relay.listen();
		cleanup.push(() => relay.shutdown());
		const origin = `http://127.0.0.1:${listener.port}`;
		const login = await fetch(`${origin}/login`, {
			method: "POST",
			redirect: "manual",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ password: "synthetic-only" }),
		});
		expect(login.status).toBe(303);
		const cookie = login.headers.get("set-cookie")?.split(";")[0];
		expect(cookie).toBeTruthy();
		const client = new RelayEndpoints(
			new RelayHttpClient({
				baseUrl: origin,
				auth: () => ({
					cookie: cookie ?? null,
					origin: null,
					credentials: "omit",
				}),
			}),
		);
		const store = createConfigStore();
		setLocaleSource(() => store.getState().language);
		const stream = client.configStream({
			onFrame(frame) {
				if (frame.kind === "config") store.getState().applyFrame(frame.data);
			},
		});
		cleanup.push(async () => stream.stop());
		stream.connection.start();
		await expect
			.poll(() => store.getState().frameCount, { timeout: 3000 })
			.toBeGreaterThan(0);
		expect(catalogueLocaleFor(store.getState().language)).toBe("ur");
		expect(activeLocale()).toBe("ur");
		const en = catalog("en"),
			ur = catalog("ur");
		for (const suffix of ["title", "name", "status", "submit"]) {
			const key = `mobile.projects.create.${suffix}`;
			expect(typeof en[key]).toBe("string");
			expect(typeof ur[key]).toBe("string");
			expect(ur[key]).not.toBe(en[key]);
		}
		const list = await client.projects();
		expect(list.projects.length).toBeGreaterThan(0);
		const created = await client.createProject({
			name: `synthetic-${language.toLowerCase()}`,
			status: "planning",
		});
		expect(created).toBeTruthy();
		const after = await client.projects();
		expect(
			after.projects.some(
				(p) => p.name === `synthetic-${language.toLowerCase()}`,
			),
		).toBe(true);
		console.log(
			"PROJECT_CREATE_CONTRACT",
			JSON.stringify({
				requested: language,
				negotiated: store.getState().language,
				locale: activeLocale(),
				projects: list.projects.length,
				created: true,
			}),
		);
	},
);
/** CI has no Local Operator scratch variable. Match the other Node tooling
 * tests' tmpdir/mkdtemp pattern without deleting or writing into a shared root:
 * only the unique directory returned by mkdtemp is ever recursively removed.
 * The finally also preserves this boundary when an inventory assertion throws. */
// Nullish coalescing alone treats empty/whitespace overrides as relative paths.
// Normalize once for BOTH allocations so CI's blank environment cannot write
// frame directories beneath the repository's working directory.
function frameScratchRoot(scratch: string | undefined): string {
	return scratch?.trim() || tmpdir();
}

function withFrameDirectory(
	scratch: string | undefined,
	run: (root: string) => void,
) {
	const root = mkdtempSync(join(frameScratchRoot(scratch), "frame-contract-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function checkFrameDiscovery(root: string) {
	for (const [label, names] of Object.entries(PROJECT_CREATE_FRAMES)) {
		const output = join(root, label, "maestro"),
			shots = join(output, "takeScreenshot");
		mkdirSync(shots, { recursive: true });
		for (const name of names)
			writeFileSync(
				join(shots, `${name}.png`),
				"synthetic-contract-not-a-frame",
			);
		const dest = join(root, label, "frames");
		expect(collectProofFrames(output, dest, label)).toHaveLength(names.length);
		for (const missing of names)
			expect(() =>
				assertFrameInventory(
					label,
					names.filter((n) => n !== missing).map((n) => `${n}.png`),
				),
			).toThrow("missing");
		for (const name of names)
			expect(existsSync(join(dest, `${name}.png`))).toBe(true);
	}
}

it.each(["present", "absent", "empty", "whitespace"])(
	"discovers uploaded Maestro screenshots with scratch override %s and rejects missing frames",
	(mode) => {
		const cwdFrameNames = () =>
			readdirSync(process.cwd())
				.filter(
					(name) =>
						name.startsWith("frame-parent-") ||
						name.startsWith("frame-contract-"),
				)
				.sort();
		const cwdBefore = cwdFrameNames();
		const blankOverride = mode === "empty" ? "" : " \t ";
		const parentOverride =
			mode === "empty" || mode === "whitespace"
				? blankOverride
				: process.env.LOCAL_OPERATOR_SCRATCHPAD;
		const parent = mkdtempSync(
			join(frameScratchRoot(parentOverride), "frame-parent-"),
		);
		const sentinel = join(parent, "keep.txt");
		writeFileSync(sentinel, "owned parent must survive child cleanup");
		let allocated = "";
		try {
			const override =
				mode === "present"
					? parent
					: mode === "absent"
						? undefined
						: blankOverride;
			withFrameDirectory(override, (root) => {
				allocated = root;
				expect(dirname(root)).toBe(mode === "present" ? parent : tmpdir());
				// Check while the allocation exists, not only after cleanup could hide it.
				expect(dirname(root)).not.toBe(process.cwd());
				expect(dirname(parent)).not.toBe(process.cwd());
				expect(cwdFrameNames()).toEqual(cwdBefore);
				checkFrameDiscovery(root);
			});
			expect(allocated).not.toBe("");
			expect(existsSync(allocated)).toBe(false);
			expect(existsSync(sentinel)).toBe(true);
			// An assertion failure must clean only its own unique child as well.
			expect(() =>
				withFrameDirectory(parent, (root) => {
					allocated = root;
					throw new Error("synthetic frame assertion failure");
				}),
			).toThrow("synthetic frame assertion failure");
			expect(existsSync(allocated)).toBe(false);
			expect(existsSync(sentinel)).toBe(true);
			expect(cwdFrameNames()).toEqual(cwdBefore);
		} finally {
			// This parent was also exclusively created by this test, never borrowed.
			rmSync(parent, { recursive: true, force: true });
		}
	},
);
