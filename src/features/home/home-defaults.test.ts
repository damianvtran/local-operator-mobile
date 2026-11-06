import { describe, expect, it } from "vitest";

import type { ModelEntry } from "@/contracts";
import {
	type ForComputer,
	foldersApplied,
	foldersFailure,
	foldersFrom,
	heldOn,
	homeFolderSelection,
	homeModelReading,
	homeModelRows,
	homeStartSelection,
	isAuthFailure,
	restoredSupersede,
} from "@/features/home/home-defaults";
import {
	StartupCoordinator,
	type StartupRecord,
} from "@/features/new-session/startup-coordinator";
import { composerChipLabels } from "@/features/session/chip-labels";
import type { StartSessionRequest } from "@/relay/endpoints";
import { RelayError } from "@/relay/errors";

/**
 * The two decisions that live behind the home's chips, asserted on the BODY and on
 * the reading — the two places the shipped defects actually were.
 *
 * Neither defect was visible in a screenshot: the start body named a model the
 * reader never chose (so the computer overrode its own configured default) and it
 * named `home` where the computer had a better answer. So the assertions here are
 * about what `POST /api/sessions/start` receives and about which state the chip is
 * told, not about how a screen looks.
 */

const model = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
	selector: "anthropic/claude-opus-5",
	provider: "anthropic",
	model_id: "claude-opus-5",
	name: "Opus 5",
	...overrides,
});

const payload = (overrides: Record<string, unknown> = {}) =>
	({
		home: "/Users/reader",
		recent: ["/Users/reader/src/local-operator", "/Users/reader/notes"],
		tmp: "/tmp",
		default: "/Users/reader/src/local-operator",
		...overrides,
	}) as unknown as Parameters<typeof foldersFrom>[0];

describe("the start body the home builds", () => {
	it("names no model when the reader chose none", () => {
		// THE DEFECT. The app took the catalogue's first entry as "the default
		// model" and put it in every start body; the computer only applies its
		// configured default when the field is ABSENT, so the operator's Opus was
		// silently replaced by whichever entry sorted first.
		const body = homeStartSelection({
			cwd: "/Users/reader/src/local-operator",
			chosenModel: null,
		});
		expect(body).toStrictEqual({ cwd: "/Users/reader/src/local-operator" });
		expect(body).not.toHaveProperty("provider");
		expect(body).not.toHaveProperty("model_id");
	});

	it("carries the model the reader did choose", () => {
		expect(
			homeStartSelection({ cwd: "/tmp", chosenModel: model() }),
		).toStrictEqual({
			cwd: "/tmp",
			provider: "anthropic",
			model_id: "claude-opus-5",
		});
	});

	it("has no body at all until a folder is known", () => {
		// Guessing a directory is how the folder defect started; with nothing named
		// there is nothing to send, and the composer says so rather than starting
		// a session somewhere the reader never picked.
		expect(homeStartSelection({ cwd: null, chosenModel: null })).toBeNull();
		expect(homeStartSelection({ cwd: null, chosenModel: model() })).toBeNull();
	});
});

describe("the folders the computer publishes", () => {
	it("starts in the computer's default rather than in home", () => {
		// The second defect: the app read only `home` and started every first send
		// there, disagreeing with what the computer itself would have chosen.
		expect(foldersFrom(payload())).toStrictEqual({
			home: "/Users/reader",
			default: "/Users/reader/src/local-operator",
			recent: ["/Users/reader/src/local-operator", "/Users/reader/notes"],
		});
	});

	it("falls back to home only when the computer publishes no default", () => {
		// An older computer omits `default`; home is the one path its spawn gate
		// always admits, so it is the fallback rather than a guess.
		expect(foldersFrom(payload({ default: undefined })).default).toBe(
			"/Users/reader",
		);
		expect(foldersFrom(payload({ default: "   " })).default).toBe(
			"/Users/reader",
		);
	});

	it("keeps the failure's KIND instead of discarding it", () => {
		const refusal = new RelayError(
			"relay-unauthorized",
			"authentication required",
		);
		expect(foldersFailure(refusal)).toBe(refusal);
		expect(foldersFailure(refusal)?.kind).toBe("relay-unauthorized");
		// A throw that is not a RelayError keeps no kind — it is never dressed as one.
		expect(foldersFailure(new Error("boom"))).toBeNull();
		expect(foldersFailure("boom")).toBeNull();
	});

	it("counts exactly the credential kinds as auth failures", () => {
		expect(
			isAuthFailure(
				new RelayError("relay-unauthorized", "authentication required"),
			),
		).toBe(true);
		expect(
			isAuthFailure(new RelayError("radiant-login-required", "sign in again")),
		).toBe(true);
		expect(isAuthFailure(new RelayError("transport", "network down"))).toBe(
			false,
		);
		expect(isAuthFailure(null)).toBe(false);
	});
});

describe("what the model chip is told", () => {
	it("prefers the reader's own choice over everything the read says", () => {
		expect(
			homeModelReading({ chosenModel: model(), catalogue: "ready" }),
		).toStrictEqual({ kind: "selector", selector: "anthropic/claude-opus-5" });
		// A read still in flight, or one that failed, cannot un-know a choice.
		expect(
			homeModelReading({ chosenModel: model(), catalogue: "loading" }),
		).toStrictEqual({ kind: "selector", selector: "anthropic/claude-opus-5" });
		expect(
			homeModelReading({ chosenModel: model(), catalogue: "failed" }),
		).toStrictEqual({ kind: "selector", selector: "anthropic/claude-opus-5" });
	});

	it("says the default is in effect when the catalogue is readable and nothing is chosen", () => {
		// Not the catalogue's first row: nothing in the catalogue is "the default",
		// and naming one made an unchosen model read as chosen.
		expect(
			homeModelReading({ chosenModel: null, catalogue: "ready" }),
		).toStrictEqual({ kind: "default" });
	});

	it("still says Default when the catalogue read failed and nothing is chosen", () => {
		// Design D2 / UX U1: a failed read loses the MENU, not the model that runs —
		// the start names no model, so the computer's default applies. The reading
		// is a pressable value chip, so the sheet stays reachable; the banner alone
		// tells the failure.
		expect(
			homeModelReading({ chosenModel: null, catalogue: "failed" }),
		).toStrictEqual({ kind: "default" });
		expect(
			composerChipLabels({
				model: homeModelReading({ chosenModel: null, catalogue: "failed" }),
				effort: null,
				connection: "connected",
			}).model,
		).toMatchObject({ kind: "value", text: "Default" });
	});

	it("waits while the catalogue is still loading", () => {
		expect(
			homeModelReading({ chosenModel: null, catalogue: "loading" }),
		).toStrictEqual({ kind: "loading" });
	});
});

describe("the options sheet's rows", () => {
	const opus = model();
	const haiku = model({
		selector: "anthropic/claude-haiku-5",
		model_id: "claude-haiku-5",
		name: "Haiku 5",
	});
	const shape = (rows: ReturnType<typeof homeModelRows>) =>
		rows.map((row) =>
			row.kind === "default" ? "default" : row.model.selector,
		);

	it("shows the default row as the selected one while nothing is chosen", () => {
		const rows = homeModelRows({ models: [opus, haiku], optionModel: null });
		expect(rows[0]).toStrictEqual({ kind: "default", selected: true });
		expect(rows.filter((row) => row.selected)).toHaveLength(1);
	});

	it("keeps the default row, unselected, once a model is chosen", () => {
		const rows = homeModelRows({ models: [opus, haiku], optionModel: haiku });
		expect(rows[0]).toStrictEqual({ kind: "default", selected: false });
		expect(rows.filter((row) => row.selected)).toStrictEqual([
			{ kind: "model", model: haiku, selected: true },
		]);
	});

	it("never changes the row count or order when the default row is tapped", () => {
		// Design D1: the tap used to unmount the row it landed on, so the first
		// catalogue model slid under the finger. Same rows before and after.
		const chosen = homeModelRows({ models: [opus, haiku], optionModel: opus });
		const tapped = homeModelRows({ models: [opus, haiku], optionModel: null });
		expect(shape(tapped)).toStrictEqual(shape(chosen));
		expect(shape(tapped)).toStrictEqual([
			"default",
			"anthropic/claude-opus-5",
			"anthropic/claude-haiku-5",
		]);
	});

	it("keeps the default row when the catalogue could not be read", () => {
		expect(homeModelRows({ models: [], optionModel: null })).toStrictEqual([
			{ kind: "default", selected: true },
		]);
	});

	it("announces which folder rows hold the sheet's folder", () => {
		const folders = foldersFrom(payload());
		const selection = homeFolderSelection({
			folders,
			optionPath: ` ${folders.default} `,
		});
		expect(selection.default).toBe(true);
		expect(selection.recent).toStrictEqual(
			folders.recent.map((directory) => directory === folders.default),
		);
		const typed = homeFolderSelection({ folders, optionPath: "/elsewhere" });
		expect(typed.default).toBe(false);
		expect(typed.recent.every((selected) => !selected)).toBe(true);
	});
});

describe("what a restored record is allowed to keep", () => {
	const read = foldersFrom(payload());
	/* The shape a build that invented a model wrote: the computer's own `home` as the
	 * folder, and the catalogue's first entry as the model. */
	const invented: StartSessionRequest = {
		cwd: "/Users/reader",
		provider: "anthropic",
		model_id: "claude-haiku-5-5",
	};
	/* A folder a reader applied in the sheet: neither the computer's default nor the
	 * invented `home`, so nothing here may move it. */
	const theirs = "/Users/reader/projects";

	it("drops the invented model when the folder read resolved", () => {
		expect(
			restoredSupersede({
				stored: invented,
				folders: read,
				chosenModel: null,
				readerApplied: false,
			}),
		).toStrictEqual({ cwd: "/Users/reader/src/local-operator" });
	});

	it("drops the invented model when the folder read FAILED (QA round 1, Q2)", () => {
		// The state the operator reported. The replacement used to be gated on a
		// resolved folder, so in exactly this cell the invented override still reached
		// the wire. The model must not wait for a folder read to succeed.
		const next = restoredSupersede({
			stored: invented,
			folders: null,
			chosenModel: null,
			readerApplied: false,
		});
		expect(next).not.toBeNull();
		expect(next).not.toHaveProperty("provider");
		expect(next).not.toHaveProperty("model_id");
	});

	it("keeps the folder the reader chose, whatever the read did (review R3)", () => {
		const chosen: StartSessionRequest = {
			cwd: theirs,
			provider: "anthropic",
			model_id: "claude-haiku-5-5",
		};
		expect(
			restoredSupersede({
				stored: chosen,
				folders: read,
				chosenModel: null,
				readerApplied: false,
			}),
		).toStrictEqual({ cwd: theirs });
		expect(
			restoredSupersede({
				stored: chosen,
				folders: null,
				chosenModel: null,
				readerApplied: false,
			}),
		).toStrictEqual({ cwd: theirs });
	});

	it("leaves alone a record that already says what the reader's choices say", () => {
		// `null` is "no write": the coordinator's configure write and the reader's own
		// choices stay the only authors. Writing the live selection here instead is
		// what discarded a chosen folder on every remount.
		expect(
			restoredSupersede({
				stored: { cwd: theirs },
				folders: read,
				chosenModel: null,
				readerApplied: false,
			}),
		).toBeNull();
		expect(
			restoredSupersede({
				stored: null,
				folders: read,
				chosenModel: null,
				readerApplied: false,
			}),
		).toBeNull();
	});

	it("keeps the model the reader chose this session, over the record's", () => {
		expect(
			restoredSupersede({
				stored: {
					cwd: theirs,
					provider: "anthropic",
					model_id: "claude-haiku-5-5",
				},
				folders: read,
				chosenModel: model(),
				readerApplied: false,
			}),
		).toStrictEqual({
			cwd: theirs,
			provider: "anthropic",
			model_id: "claude-opus-5",
		});
	});
});

describe("the folder the screen holds after a successful read", () => {
	it("fills a slot nobody has filled with the computer's default", () => {
		expect(
			foldersApplied(null, "tunnel-a", foldersFrom(payload())),
		).toStrictEqual({
			computer: "tunnel-a",
			value: "/Users/reader/src/local-operator",
		});
	});

	it("never moves a folder the reader applied (review R2)", () => {
		// The model banner's Retry used to re-run the FOLDERS read and land here with a
		// fresh `default`, which replaced the reader's folder without a word.
		expect(
			foldersApplied(
				{ computer: "tunnel-a", value: "/Users/reader/projects" },
				"tunnel-a",
				foldersFrom(payload()),
			).value,
		).toBe("/Users/reader/projects");
	});

	it("does not count another computer's folder as filled (review round 2, R2-1)", () => {
		expect(
			foldersApplied(
				{ computer: "tunnel-a", value: "/Users/reader/projects" },
				"tunnel-b",
				foldersFrom(payload({ default: "/home/b/work" })),
			),
		).toStrictEqual({ computer: "tunnel-b", value: "/home/b/work" });
		expect(
			heldOn(
				{ computer: "tunnel-a", value: "/Users/reader/projects" },
				"tunnel-b",
			),
		).toBeNull();
	});
});

describe("what a restored record turns into on the wire (QA round 1, Q2)", () => {
	/* Driven through the REAL `StartupCoordinator` over a store, because the body that
	 * matters is the one `deps.start` receives — the coordinator takes that from
	 * `record.selection`, not from anything the screen holds. The home's half is
	 * `restoredSupersede`, wired here exactly as `home.tsx` wires it. */
	const SCOPE = "authorization-a/server-a";
	const read = foldersFrom(payload());
	const invented: StartSessionRequest = {
		cwd: "/Users/reader",
		provider: "anthropic",
		model_id: "claude-haiku-5-5",
	};
	const theirs = "/Users/reader/projects";

	/** The selection `POST /api/sessions/start` received for this restored record. */
	const startBody = async (input: {
		stored: StartSessionRequest;
		folders: Parameters<typeof restoredSupersede>[0]["folders"];
		chosenModel: ModelEntry | null;
		readerApplied?: boolean;
	}): Promise<StartSessionRequest> => {
		let disk: StartupRecord | null = {
			version: 1,
			scope: SCOPE,
			phase: "draft",
			sessionId: null,
			selection: input.stored,
			draft: { text: "", images: [] },
			queue: [],
		};
		const started: StartSessionRequest[] = [];
		let reached!: () => void;
		const arrived = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const coordinator = new StartupCoordinator(SCOPE, {
			store: {
				load: async () => (disk === null ? null : structuredClone(disk)),
				save: async (record) => {
					disk = structuredClone(record);
				},
			},
			start: async (selection) => {
				started.push(selection);
				reached();
				return { session_id: "session-a" };
			},
			send: async () => undefined,
			isCurrent: () => true,
			uuid: () => "00000000-0000-4000-8000-000000000001",
		});
		await coordinator.ready;
		const next = restoredSupersede({
			stored: coordinator.snapshot().selection,
			folders: input.folders,
			chosenModel: input.chosenModel,
			readerApplied: input.readerApplied ?? false,
		});
		if (next !== null) await coordinator.configure(next, true);
		coordinator.edit("hello", []);
		await coordinator.enqueue();
		await arrived;
		return started[0] as StartSessionRequest;
	};

	it("sends the computer's default, and no model, when the read resolved", async () => {
		expect(
			await startBody({ stored: invented, folders: read, chosenModel: null }),
		).toStrictEqual({ cwd: "/Users/reader/src/local-operator" });
	});

	it("keeps the reader's folder, and drops the model, when the read resolved", async () => {
		expect(
			await startBody({
				stored: { ...invented, cwd: theirs },
				folders: read,
				chosenModel: null,
			}),
		).toStrictEqual({ cwd: theirs });
	});

	it("sends NO model when the read FAILED — the cell the defect lived in", async () => {
		const body = await startBody({
			stored: invented,
			folders: null,
			chosenModel: null,
		});
		expect(body).not.toHaveProperty("provider");
		expect(body).not.toHaveProperty("model_id");
	});

	it("sends NO model, and keeps the reader's folder, when the read FAILED", async () => {
		const body = await startBody({
			stored: { ...invented, cwd: theirs },
			folders: null,
			chosenModel: null,
		});
		expect(body).toStrictEqual({ cwd: theirs });
	});

	it("leaves a record the reader made alone across a remount", async () => {
		// Control for all four cells: nothing the reader did is rewritten, so the
		// folder they chose last time is still what a start names.
		expect(
			await startBody({
				stored: { cwd: theirs },
				folders: read,
				chosenModel: null,
			}),
		).toStrictEqual({ cwd: theirs });
	});
});

/**
 * The home's wiring, replayed over the REAL coordinator: the folder state tagged
 * per computer (`heldOn`/`foldersApplied`), the live selection `useStartup`
 * configures without `replace`, the reader's Apply (`replace`), and the supersede
 * effect re-running after every write until it settles — the order `home.tsx`
 * runs them in. What is asserted is what `deps.start` receives.
 */
describe("the home's wiring across a computer switch and an Apply (review round 2)", () => {
	const A = foldersFrom(payload());
	const B = foldersFrom(
		payload({
			home: "/home/b",
			recent: ["/home/b/work"],
			default: "/home/b/work",
		}),
	);
	const aPick = "/Users/reader/projects";

	const computer = (stored: StartSessionRequest | null) => {
		let disk: StartupRecord | null =
			stored === null
				? null
				: {
						version: 1,
						scope: "authorization/server",
						phase: "draft",
						sessionId: null,
						selection: stored,
						draft: { text: "", images: [] },
						queue: [],
					};
		const started: StartSessionRequest[] = [];
		const coordinator = new StartupCoordinator("authorization/server", {
			store: {
				load: async () => (disk === null ? null : structuredClone(disk)),
				save: async (record) => {
					disk = structuredClone(record);
				},
			},
			start: async (selection) => {
				started.push(selection);
				return { session_id: "session" };
			},
			send: async () => undefined,
			isCurrent: () => true,
			uuid: () => "00000000-0000-4000-8000-000000000002",
		});
		return { coordinator, started };
	};

	/** One render's effects: the live selection, then the supersede loop. */
	const render = async (
		coordinator: StartupCoordinator,
		screen: {
			cwd: string | null;
			folders: Parameters<typeof restoredSupersede>[0]["folders"];
			readerApplied: boolean;
		},
	) => {
		const selection = homeStartSelection({
			cwd: screen.cwd,
			chosenModel: null,
		});
		if (selection !== null) await coordinator.configure(selection);
		for (let pass = 0; pass < 5; pass += 1) {
			const next = restoredSupersede({
				stored: coordinator.snapshot().selection,
				folders: screen.folders,
				chosenModel: null,
				readerApplied: screen.readerApplied,
			});
			if (next === null) return;
			// `startup.configure` in the screen is the replacing write.
			await coordinator.configure(next, true);
		}
		throw new Error("the supersede effect never settled");
	};

	const send = async (coordinator: StartupCoordinator) => {
		coordinator.edit("hello", []);
		await coordinator.enqueue();
		await coordinator.settled();
	};

	it("starts computer B in B's default, never in the folder held for A (R2-1)", async () => {
		// The reader applied a folder on A, then switched with the header chip.
		const held: ForComputer<string> = { computer: "tunnel-a", value: aPick };
		const b = computer(null);
		await b.coordinator.ready;
		// The switch's own render: A's folder reads as nothing on B.
		await render(b.coordinator, {
			cwd: heldOn(held, "tunnel-b"),
			folders: null,
			readerApplied: false,
		});
		// B's read resolves.
		const filled = foldersApplied(held, "tunnel-b", B);
		await render(b.coordinator, {
			cwd: heldOn(filled, "tunnel-b"),
			folders: B,
			readerApplied: false,
		});
		await send(b.coordinator);
		expect(b.started).toStrictEqual([{ cwd: "/home/b/work" }]);
	});

	it("sends nothing of A's when B's folder read FAILS (R2-1)", async () => {
		const held: ForComputer<string> = { computer: "tunnel-a", value: aPick };
		const b = computer(null);
		await b.coordinator.ready;
		await render(b.coordinator, {
			cwd: heldOn(held, "tunnel-b"),
			folders: null,
			readerApplied: false,
		});
		await send(b.coordinator);
		// No folder is known on B, so no start goes out at all — the send waits.
		expect(b.started).toStrictEqual([]);
		expect(b.coordinator.snapshot().selection).toBeNull();
		expect(b.coordinator.snapshot().queue).toHaveLength(1);
	});

	it("keeps exactly the home folder when the reader applies it (R2-2)", async () => {
		const a = computer(null);
		await a.coordinator.ready;
		await render(a.coordinator, {
			cwd: A.default,
			folders: A,
			readerApplied: false,
		});
		// The reader taps the recent row that IS their home folder, then Apply.
		await a.coordinator.configure({ cwd: A.home }, true);
		// The re-renders that follow the write must not move it.
		await render(a.coordinator, {
			cwd: A.home,
			folders: A,
			readerApplied: true,
		});
		await render(a.coordinator, {
			cwd: A.home,
			folders: A,
			readerApplied: true,
		});
		await send(a.coordinator);
		expect(a.started).toStrictEqual([{ cwd: "/Users/reader" }]);
	});

	it("still moves an old build's restored home record to the default (R2-2 control)", async () => {
		const a = computer({
			cwd: A.home,
			provider: "anthropic",
			model_id: "claude-haiku-5-5",
		});
		await a.coordinator.ready;
		await render(a.coordinator, {
			cwd: A.default,
			folders: A,
			readerApplied: false,
		});
		await send(a.coordinator);
		expect(a.started).toStrictEqual([
			{ cwd: "/Users/reader/src/local-operator" },
		]);
	});
});
