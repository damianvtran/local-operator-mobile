import {
	act,
	createElement,
	Fragment,
	isValidElement,
	type ReactNode,
	useEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "zustand";
import type { ProjectSummary, ProjectView } from "@/contracts";
import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import { createConfigStore } from "@/state/config-store";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * Projects and Project detail, MOUNTED, while a config frame changes the
 * language underneath them (D1 design QA, PR #251).
 *
 * THE DEFECT. Both screens render keyed copy through `t()`, which reads the
 * locale at call time — but neither subscribed to the language, so nothing
 * re-rendered them when a late backend frame moved it. The served web build
 * showed it: a `fr → ur` frame flipped `<html>` to `ur`/rtl while the mounted
 * list kept `Projets` and the detail kept `JALONS` / `SESSIONS LIÉES`, until
 * a cold reload painted the Urdu that was there all along.
 *
 * WHAT IS REAL HERE. React's reconciler (react-dom over `installDomShim`), the
 * screens' own source, the i18n runtime and catalogues, and the config store
 * (`createConfigStore` + `applyFrame`, the path a backend language frame takes).
 * `useLocaleFrame` is the production hook's body verbatim — `useStore` over the
 * config store's `language` — pointed at this test's store, and the locale
 * source is registered the way connection-provider.tsx registers it.
 *
 * WHAT IS STUBBED. Only the boundaries a Node renderer cannot load: the
 * react-native host views, expo-router, and the `@/ui/components` leaves, which
 * are replaced by one recorder that keeps every string they are handed. None of
 * them holds copy of its own, so the strings recorded are the screens' strings.
 *
 * WHAT IT DOES NOT PROVE: pixels. The served web frames after the fix are the
 * browser layer's job; this pins that a language frame alone repaints the copy.
 */

const host = vi.hoisted(() => ({
	texts: [] as string[],
	store: null as unknown as ReturnType<
		typeof import("@/state/config-store").createConfigStore
	>,
	summaries: [] as unknown[],
	view: null as unknown,
	client: null as unknown,
}));

/** Every string in a node tree: a `Text`'s children may be an array. */
function strings(node: unknown): string[] {
	if (typeof node === "string") return [node];
	if (Array.isArray(node)) return node.flatMap(strings);
	return [];
}

/** A leaf component that records the copy it is handed and renders anything
 *  element-shaped it carries (`headerLeading`, `headerAction`, children). */
function Recorder(props: Record<string, unknown>): ReactNode {
	const nested: ReactNode[] = [];
	for (const [name, value] of Object.entries(props)) {
		if (name === "children") continue;
		if (typeof value === "string") host.texts.push(value);
		else if (isValidElement(value)) nested.push(value);
	}
	const children =
		typeof props.children === "function"
			? (props.children as (state: { pressed: boolean }) => ReactNode)({
					pressed: false,
				})
			: (props.children as ReactNode);
	host.texts.push(...strings(children));
	return createElement(Fragment, null, ...nested, children ?? null);
}

vi.mock("react-native", () => ({
	View: Recorder,
	Text: Recorder,
	Pressable: Recorder,
	/* `@/ui/direction` reads the platform at import (project-detail's milestone
	 *  placeholders, PR #302 D1); native is the branch with no `dir` side effect. */
	Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios },
}));
vi.mock("lucide-react-native", () => ({ Pencil: () => null }));
vi.mock("expo-router", () => ({
	useRouter: () => ({ back: () => undefined, push: () => undefined }),
	useLocalSearchParams: () => ({ key: "payments" }),
	// expo-router runs the callback on focus; a mounted test screen is focused.
	useFocusEffect: (callback: () => void) => {
		useEffect(callback, [callback]);
	},
}));
vi.mock("@/features/auth/connection-provider", () => {
	const relay = () => host.client;
	return {
		useConnection: () => ({ relay, refusal: null }),
		useLocaleFrame: () => useStore(host.store, (state) => state.language),
	};
});
vi.mock("@/features/projects/project-create", () => ({
	ProjectCreateSheet: () => null,
}));
vi.mock("@/features/projects/projects-markers", () => ({
	ProjectsStateMarkers: () => null,
	ProjectDetailStateMarkers: () => null,
}));
vi.mock("@/state/ui-store", () => ({
	useUiStore: (select: (state: { showToast: () => void }) => unknown) =>
		select({ showToast: () => undefined }),
}));
for (const leaf of [
	"alert",
	"back-button",
	"badge",
	"button",
	"dialog",
	"empty-state",
	"icon-button",
	"input",
	"refusal-surface",
	"screen",
	"section-header",
	"sheet",
	"skeleton",
]) {
	// `doMock` (not hoisted) is enough: the screens are imported inside the tests,
	// after these registrations. Every leaf gets the same export table; a module
	// only exposes the names its importers ask for.
	vi.doMock(`@/ui/components/${leaf}`, () => ({
		Alert: Recorder,
		BackButton: Recorder,
		Badge: Recorder,
		Button: Recorder,
		Dialog: () => null,
		EmptyState: Recorder,
		IconButton: Recorder,
		Input: () => null,
		RefusalSurface: Recorder,
		Screen: Recorder,
		SectionHeader: Recorder,
		Sheet: () => null,
		Skeleton: () => null,
	}));
}

/* The six drawer destinations swapped their chevron for the drawer button; the
 * Node renderer cannot load its provider, and this test is about copy. */
vi.doMock("@/features/sessions/workspace-drawer", () => ({
	WorkspaceDrawerButton: Recorder,
}));

const SUMMARY: ProjectSummary = {
	id: "p1",
	name: "payments",
	description: "",
	owner: null,
	team: null,
	title: "Payments migration",
	status: "active",
	tags: [],
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones_completed: 1,
	milestones_total: 2,
	sessions: 1,
	live_sessions: 0,
	coordination_sessions: 0,
	progress_stale: false,
	progress_updated_at: null,
	progress_refreshed_at: null,
	progress_refreshed_by: "",
	updated_at: 1,
};

const VIEW: ProjectView = {
	id: "p1",
	name: "payments",
	description: "",
	owner: null,
	team: null,
	title: "Payments migration",
	status: "active",
	progress: "Halfway there",
	progress_updated_at: null,
	progress_reported_by: "",
	progress_refreshed_at: null,
	progress_refreshed_by: "",
	progress_stale: false,
	tags: [],
	sessions: [],
	coordination_sessions: [],
	created_at: 1,
	updated_at: 1,
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones: [],
	updates: [],
};

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	host.store = createConfigStore({ now: () => 1 });
	host.client = {
		projects: async () => ({ projects: [SUMMARY] }),
		project: async () => ({ project: VIEW, links: [] }),
	};
	// The registration connection-provider.tsx makes at import, against this
	// test's store: `t()` resolves the language the config stream last sent.
	setLocaleSource(() => host.store.getState().language);
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
});

/** A backend language frame, through the store's real reducer. */
const frame = (language: string, at: number): void =>
	host.store
		.getState()
		.applyFrame({ changed_keys: ["language"], language }, at);

async function mount(screen: () => ReactNode): Promise<void> {
	await act(async () => root.render(createElement(screen)));
	// The screens' first read is async; let it settle into state.
	await act(async () => undefined);
}

/** Assert the mounted screen shows `key` in `fr`, then — with ONLY the language
 *  moving — in `ur`, and no longer in `fr`. */
async function expectRepaint(keys: readonly Parameters<typeof renderFor>[0][]) {
	for (const key of keys)
		expect(host.texts).toContain(renderFor(key, {}, "fr"));
	host.texts = [];
	await act(async () => frame("ur", 3));
	for (const key of keys) {
		expect(renderFor(key, {}, "ur")).not.toBe(renderFor(key, {}, "fr"));
		expect(host.texts).toContain(renderFor(key, {}, "ur"));
		expect(host.texts).not.toContain(renderFor(key, {}, "fr"));
	}
}

describe("a mounted projects surface repaints on a language frame", () => {
	it("Projects: the title follows fr → ur without a remount", async () => {
		const { default: Projects } = await import("@/features/projects/projects");
		frame("fr", 2);
		await mount(Projects);
		expect(host.texts).toContain("Payments migration");
		await expectRepaint(["mobile.projects.title"]);
	});

	it("Project detail: section headers follow fr → ur without a remount", async () => {
		const { default: ProjectDetail } = await import(
			"@/features/projects/project-detail"
		);
		frame("fr", 2);
		await mount(ProjectDetail);
		await expectRepaint([
			"mobile.projects.section.progress",
			"mobile.projects.section.milestones",
			"mobile.projects.section.linked_sessions",
		]);
	});
});
