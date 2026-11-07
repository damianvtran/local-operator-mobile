/**
 * The decisions behind the home's three pickers — folder, model, effort — as pure
 * functions, so the rules that reach the wire or the chip are asserted in tests
 * rather than read off a screenshot.
 *
 * WHY THREE PICKERS. The operator's words: the one "Conversation options" sheet
 * that held a free-text folder field AND a flat list of every model "looks
 * terrible", free typing a path "is a big no-no in UX", and "there should probably
 * be a separate dialog to handle directory vs model vs effort selection". Each
 * picker now answers one question and commits on its own tap; this module owns
 * what each one offers and what each chip says.
 *
 * THE DAEMON CONTRACT (local-operator v0.101.9,
 * `docs/design/mobile-start-receipts.md`, "Picking a model and effort"):
 * `GET /api/models` publishes `default` (what a start naming nothing runs) and a
 * per-row `efforts` ladder whose ABSENCE means "unknown", and the session list's
 * `capabilities.session_start.effort` is the only licence to send `effort`.
 */
import type { ModelDefault, ModelEntry } from "@/contracts";
import {
	type ChipConnection,
	type ComposerChip,
	composerChipLabels,
	type ModelReading,
} from "@/features/session/chip-labels";
import { t } from "@/i18n";
import {
	type CatalogueRead,
	type HomeFolders,
	homeModelReading,
} from "./home-defaults";

/** The daemon's whole effort vocabulary, lowest first — the levels
 *  `POST /api/sessions/start` accepts. Offered in full only when a model's ladder
 *  is unknown; the session then clamps to the nearest rung it supports. */
export const EFFORT_VOCABULARY = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

/** Above this many rows the model picker grows a search field (design spec §5).
 *  Below it a field is one more control between the reader and a list they can
 *  already see whole. */
export const MODEL_SEARCH_THRESHOLD = 12;

/** The search query's token separator. */
const WHITESPACE = /\s+/;

/** What the catalogue says about the default: the object, `null` (the computer
 *  resolved none), or `undefined` (an older daemon that never says). */
export type CatalogueDefault = ModelDefault | null | undefined;

/** The catalogue row the computer's default names, when the catalogue lists it. */
export const defaultEntry = (
	models: readonly ModelEntry[],
	fallback: CatalogueDefault,
): ModelEntry | null =>
	fallback
		? (models.find((m) => m.selector === fallback.selector) ?? null)
		: null;

/** A model's reader-facing name: the catalogue's friendly label ("Opus 5.5"),
 *  then its name, then the id — never the provider-qualified selector. */
export const modelLabel = (model: ModelEntry): string =>
	model.label ?? (model.name.length > 0 ? model.name : model.model_id);

/** The default's reader-facing name. The `default` object carries no label of its
 *  own, so it borrows its catalogue row's; a default the catalogue does not list
 *  falls back to its bare model id rather than to nothing. */
export const defaultLabel = (
	models: readonly ModelEntry[],
	fallback: ModelDefault,
): string => {
	const row = defaultEntry(models, fallback);
	return row !== null ? modelLabel(row) : fallback.model_id;
};

/** Whether the next start runs the computer's default MODEL: nothing chosen, or
 *  the chosen row IS the default. Decides whether `default.effort` describes the
 *  model that will run. */
const runsDefaultModel = (
	chosen: ModelEntry | null,
	fallback: CatalogueDefault,
): boolean =>
	chosen === null ||
	(fallback !== null &&
		fallback !== undefined &&
		chosen.selector === fallback.selector);

/** What the effort picker may offer.
 *
 * - `unsupported` — the relay does not advertise `session_start.effort`: no
 *   choice can be sent, so the picker explains and offers nothing.
 * - `none` — the model's ladder is `[]`: it has no effort setting.
 * - `ladder` — the rungs to offer. `exact: false` is the unknown-ladder case
 *   (key absent, or no model resolvable): the whole vocabulary, with a line saying
 *   the computer picks the nearest level it supports. */
export type EffortOffer =
	| Readonly<{ kind: "unsupported" }>
	| Readonly<{ kind: "none" }>
	| Readonly<{ kind: "ladder"; rungs: readonly string[]; exact: boolean }>;

export const effortOffer = (input: {
	supported: boolean;
	chosenModel: ModelEntry | null;
	models: readonly ModelEntry[];
	catalogueDefault: CatalogueDefault;
}): EffortOffer => {
	if (!input.supported) return { kind: "unsupported" };
	/* The ladder is the MODEL THAT WILL RUN's: the reader's pick, else the
	 *  default's row. With neither known there is no ladder to read. */
	const model =
		input.chosenModel ?? defaultEntry(input.models, input.catalogueDefault);
	const efforts = model?.efforts;
	if (efforts === undefined)
		return { kind: "ladder", rungs: EFFORT_VOCABULARY, exact: false };
	if (efforts.length === 0) return { kind: "none" };
	return { kind: "ladder", rungs: efforts, exact: true };
};

/** The effort the computer would apply with nothing chosen, when it is KNOWN:
 *  `default.effort` describes the default model only, so another model's default
 *  effort is the computer's to clamp and this returns `null`. */
export const defaultEffortFor = (
	chosenModel: ModelEntry | null,
	catalogueDefault: CatalogueDefault,
): string | null =>
	runsDefaultModel(chosenModel, catalogueDefault)
		? (catalogueDefault?.effort ?? null)
		: null;

/** The reader's effort after they pick another model. Kept only while the new
 *  model's offer still holds it (spec: "resets effort to that model's default
 *  unless the reader picked one that's still on the new ladder"); `null` IS the
 *  reset — the start names no effort and the computer applies its configured
 *  level, clamped to the model. */
export const effortAfterModelChange = (
	chosenEffort: string | null,
	offer: EffortOffer,
): string | null =>
	chosenEffort !== null &&
	offer.kind === "ladder" &&
	offer.rungs.includes(chosenEffort)
		? chosenEffort
		: null;

/** A rung's reader-facing name. The vocabulary is the daemon's, so an unknown
 *  word (a newer daemon's) is shown as sent rather than dropped. */
export const effortLabel = (rung: string): string => {
	switch (rung) {
		case "none":
			return t("mobile.home.effort.none");
		case "minimal":
			return t("mobile.home.effort.minimal");
		case "low":
			return t("mobile.home.effort.low");
		case "medium":
			return t("mobile.home.effort.medium");
		case "high":
			return t("mobile.home.effort.high");
		case "xhigh":
			return t("mobile.home.effort.xhigh");
		case "max":
			return t("mobile.home.effort.max");
		default:
			return rung;
	}
};

/**
 * The home's model chip.
 *
 * Loading, unreachable and a failed read keep #174's readings (`homeModelReading`
 * → `composerChipLabels`): a failed catalogue still says "Default", because the
 * computer's default runs whether or not its menu was read. What is new is that a
 * KNOWN default is named — "Opus 5.5", the operator's configured model — instead of
 * the bare word, and a chosen model shows its friendly label rather than its id.
 * `default: null` (the computer resolved none) says so rather than naming any
 * catalogue row: the app never paints a model the product did not resolve.
 */
export const homeModelChip = (input: {
	reading: ModelReading;
	connection: ChipConnection;
	chosenModel: ModelEntry | null;
	models: readonly ModelEntry[];
	catalogueDefault: CatalogueDefault;
}): ComposerChip => {
	const base = composerChipLabels({
		model: input.reading,
		effort: null,
		connection: input.connection,
	}).model;
	if (input.connection === "unreachable" || base.kind === "loading")
		return base;
	if (input.chosenModel !== null) {
		const model = modelLabel(input.chosenModel);
		return {
			kind: "value",
			text: model,
			accessibilityLabel: t("mobile.home.chip.model_chosen", { model }),
		};
	}
	if (input.reading.kind !== "default") return base;
	if (input.catalogueDefault === null)
		return {
			kind: "value",
			text: t("mobile.home.chip.model_no_default"),
			accessibilityLabel: t("mobile.home.chip.model_no_default_label"),
		};
	if (input.catalogueDefault === undefined) return base;
	const model = defaultLabel(input.models, input.catalogueDefault);
	return {
		kind: "value",
		text: model,
		accessibilityLabel: t("mobile.home.chip.model_default", { model }),
	};
};

/**
 * The home's effort chip.
 *
 * Shown on the home since this change (it was `null`: the home had no effort to
 * offer). A model whose ladder is `[]` gets the kit's rungless `n/a` chip, disabled
 * with its reason. Otherwise the chip names the reader's level, else the default's
 * known level, else the word "Default" — the computer's configured level applies,
 * and the app does not guess which rung that clamps to for another model.
 */
export const homeEffortChip = (input: {
	connection: ChipConnection;
	catalogueLoading: boolean;
	offer: EffortOffer;
	chosenEffort: string | null;
	defaultEffort: string | null;
}): ComposerChip => {
	const connection: ChipConnection =
		input.connection === "connected" && input.catalogueLoading
			? "loading"
			: input.connection;
	if (connection !== "connected" || input.offer.kind === "none")
		return composerChipLabels({
			model: { kind: "default" },
			effort: input.offer.kind === "none" ? "" : null,
			connection,
		}).effort;
	if (input.chosenEffort !== null) {
		const effort = effortLabel(input.chosenEffort);
		return {
			kind: "value",
			text: effort,
			accessibilityLabel: t("mobile.home.chip.effort_chosen", { effort }),
		};
	}
	if (input.defaultEffort !== null) {
		const effort = effortLabel(input.defaultEffort);
		return {
			kind: "value",
			text: effort,
			accessibilityLabel: t("mobile.home.chip.effort_default", { effort }),
		};
	}
	return {
		kind: "value",
		text: t("mobile.session.chip.model_default"),
		accessibilityLabel: t("mobile.home.chip.effort_default_unnamed"),
	};
};

/** Both strip chips for the home, from the facts the screen holds. One call, so
 *  the screen's memo has one body and every input is visible in its dependency
 *  list. A catalogue still loading skeletons both chips; no connection makes both
 *  the kit's not-connected `n/a`. */
export const homeChips = (input: {
	connected: boolean;
	modelsRead: CatalogueRead;
	chosenModel: ModelEntry | null;
	chosenEffort: string | null;
	models: readonly ModelEntry[];
	catalogueDefault: CatalogueDefault;
	offer: EffortOffer;
	defaultEffort: string | null;
}): Readonly<{ model: ComposerChip; effort: ComposerChip }> => {
	const connection: ChipConnection = !input.connected
		? "unreachable"
		: input.modelsRead === "loading"
			? "loading"
			: "connected";
	return {
		model: homeModelChip({
			reading: homeModelReading({
				chosenModel: input.chosenModel,
				catalogue: input.modelsRead,
			}),
			connection,
			chosenModel: input.chosenModel,
			models: input.models,
			catalogueDefault: input.catalogueDefault,
		}),
		effort: homeEffortChip({
			connection: input.connected ? "connected" : "unreachable",
			catalogueLoading: input.modelsRead === "loading",
			offer: input.offer,
			chosenEffort: input.chosenEffort,
			defaultEffort: input.defaultEffort,
		}),
	};
};

/** Models whose name, label, id or provider contain EVERY whitespace-separated
 *  token of `query`, in the catalogue's order. The relay SPA's predicate
 *  (`local_operator/mobile/web/src/lib/model-filter.ts`): tokens rather than one
 *  substring, so "anthropic opus" finds rows a single `includes` over
 *  `provider/model_id` never would; order-preserving, because the daemon already
 *  ranked the array. */
export const filterModels = (
	models: readonly ModelEntry[],
	query: string,
): readonly ModelEntry[] => {
	const tokens = query.trim().toLowerCase().split(WHITESPACE).filter(Boolean);
	if (tokens.length === 0) return models;
	return models.filter((model) => {
		const text =
			`${model.selector} ${model.name} ${model.label ?? ""} ${model.provider}`.toLowerCase();
		return tokens.every((token) => text.includes(token));
	});
};

/** One row of the folder picker. */
export type FolderRow = Readonly<{
	kind: "default" | "home" | "recent" | "tmp";
	path: string;
}>;

/**
 * The folder picker's rows: the computer's default first, then its recent
 * folders, then home and the temp folder — each path once.
 *
 * WHY NO SUBFOLDER BROWSING. The relay publishes no directory-listing route (its
 * only folder read is `GET /api/directories`: home, recent, tmp and default), so
 * the picker can offer exactly what the computer vouches for and nothing it would
 * have to guess. Every row is a folder the spawn gate admits, so no row is a dead
 * tap. A path no row names goes through `typedFolder`, the secondary "Other path"
 * row — never the primary surface.
 *
 * Deduplicated because the default is usually the first recent folder, and two
 * rows for one choice read as two choices (design D3).
 */
export const folderRows = (folders: HomeFolders): readonly FolderRow[] => {
	const seen = new Set<string>();
	const rows: FolderRow[] = [];
	const add = (kind: FolderRow["kind"], path: string | undefined) => {
		if (path === undefined || path.length === 0 || seen.has(path)) return;
		seen.add(path);
		rows.push({ kind, path });
	};
	add("default", folders.default);
	for (const path of folders.recent) add("recent", path);
	add("home", folders.home);
	add("tmp", folders.tmp);
	return rows;
};

/** The relay refuses a start field longer than this (`invalid_start_request`). */
const PATH_MAX = 4096;

export type TypedFolder =
	| Readonly<{ ok: true; path: string }>
	| Readonly<{ ok: false; reason: "empty" | "outside" | "too_long" }>;

/**
 * A typed path, checked against the computer's own spawn gate BEFORE it is sent.
 *
 * The gate (`_spawn_dir_allowed` in local-operator's `mobile/daemon.py`) admits
 * home and the temp folder and everything under them, after `~` expansion. A
 * phone cannot resolve symlinks or test that the folder exists — the start route
 * still answers that with `invalid_start_directory`, which the home already shows
 * — but it can refuse the path that is certain to fail, while the reader is still
 * looking at the field, instead of after they press send.
 */
export const typedFolder = (raw: string, folders: HomeFolders): TypedFolder => {
	const path = raw.trim();
	if (path.length === 0) return { ok: false, reason: "empty" };
	if (path.length > PATH_MAX) return { ok: false, reason: "too_long" };
	const under = (root: string | undefined) =>
		root !== undefined &&
		root.length > 0 &&
		(path === root ||
			path.startsWith(`${root}/`) ||
			path.startsWith(`${root}\\`));
	if (
		path === "~" ||
		path.startsWith("~/") ||
		under(folders.home) ||
		under(folders.tmp)
	)
		return { ok: true, path };
	return { ok: false, reason: "outside" };
};
