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
import type { ProjectView } from "@/contracts";
import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL } from "@/ui/a11y";

/**
 * The milestone editor's placeholders, MOUNTED in Urdu, state the page's
 * direction (PR #302 design review, D1).
 *
 * THE DEFECT. react-native-web renders a field with `dir="auto"`, and HTML
 * `dir=auto` takes its direction from the VALUE, never the placeholder. The two
 * milestone fields are empty when the sheet opens, and the Urdu date hint opens
 * with a Latin mask, so both hints sat on the LEFT of an RTL sheet. The fix is
 * the one `own-tunnel.tsx` uses for its Urdu password field: pass
 * `placeholderDir={useComposedDir()}` and let `Input` apply it while empty.
 *
 * WHAT IS REAL HERE. The screen's source, the REAL `Input` (where the empty-field
 * rule lives), the real `DirectionProvider`/`useComposedDir` under the web
 * platform branch, the i18n runtime and catalogues. The assertion is on the
 * props the platform `TextInput` receives: that is the `dir` the browser sees.
 *
 * WHAT IS STUBBED. The react-native host views (recorded), expo-router, the
 * relay client (one empty project), and the leaf components that are not the
 * field — `Sheet` renders its children while visible, `Button` records its
 * `onPress` by test id so the test can open the editor the way a tap does.
 */

const host = vi.hoisted(() => ({
	inputs: new Map<string, Record<string, unknown>>(),
	presses: new Map<string, () => void>(),
	view: null as unknown,
}));

function Recorder(props: Record<string, unknown>): ReactNode {
	const nested: ReactNode[] = [];
	for (const [name, value] of Object.entries(props)) {
		if (name !== "children" && isValidElement(value)) nested.push(value);
	}
	const children =
		typeof props.children === "function"
			? (props.children as (state: { pressed: boolean }) => ReactNode)({
					pressed: false,
				})
			: (props.children as ReactNode);
	return createElement(Fragment, null, ...nested, children ?? null);
}

vi.mock("react-native", () => ({
	View: Recorder,
	Text: Recorder,
	Pressable: Recorder,
	/* The platform field: what it is handed is what the browser renders. */
	TextInput: (props: Record<string, unknown>) => {
		host.inputs.set(String(props.testID), props);
		return null;
	},
	/* The web branch: `composedDirection` answers `{ dir }` only there, and
	 *  `Input` forwards only the web `dir`. */
	Platform: { OS: "web", select: (o: Record<string, unknown>) => o.web },
}));
vi.mock("lucide-react-native", () => ({ Pencil: () => null }));
vi.mock("expo-router", () => ({
	useRouter: () => ({ back: () => undefined, push: () => undefined }),
	useLocalSearchParams: () => ({ key: "payments" }),
	useFocusEffect: (callback: () => void) => {
		useEffect(callback, [callback]);
	},
}));
vi.mock("@/features/auth/connection-provider", () => {
	const relay = () => ({
		project: async () => ({ project: host.view, links: [] }),
	});
	return {
		useConnection: () => ({ relay, refusal: null }),
		useLocaleFrame: () => "ur",
	};
});
vi.mock("@/features/projects/projects-markers", () => ({
	ProjectsStateMarkers: () => null,
	ProjectDetailStateMarkers: () => null,
}));
vi.mock("@/state/ui-store", () => ({
	useUiStore: (select: (state: { showToast: () => void }) => unknown) =>
		select({ showToast: () => undefined }),
}));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000000",
	useKeyboardAppearance: () => "light",
}));
for (const leaf of [
	"alert",
	"back-button",
	"badge",
	"dialog",
	"icon-button",
	"refusal-surface",
	"screen",
	"section-header",
	"skeleton",
]) {
	vi.doMock(`@/ui/components/${leaf}`, () => ({
		Alert: Recorder,
		BackButton: Recorder,
		Badge: Recorder,
		Dialog: () => null,
		IconButton: Recorder,
		RefusalSurface: Recorder,
		Screen: Recorder,
		SectionHeader: Recorder,
		Skeleton: () => null,
	}));
}
vi.doMock("@/ui/components/button", () => ({
	Button: (props: { testID?: string; onPress?: () => void }) => {
		if (props.testID !== undefined && props.onPress !== undefined)
			host.presses.set(props.testID, props.onPress);
		return null;
	},
}));
vi.doMock("@/ui/components/sheet", () => ({
	Sheet: (props: { visible: boolean; children?: ReactNode }) =>
		props.visible ? createElement(Fragment, null, props.children) : null,
}));

const VIEW = {
	id: "p1",
	name: "payments",
	description: "",
	owner: null,
	team: null,
	title: "Payments migration",
	status: "active",
	progress: "",
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
} satisfies ProjectView;

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	host.inputs.clear();
	host.presses.clear();
	host.view = VIEW;
	setLocaleSource(() => "ur");
	dom = installDomShim();
	/* `DirectionProvider` writes `dir`/`lang` on `<html>` on web; the shim has
	 *  no document element, so it gets an inert one. */
	(globalThis.document as unknown as Record<string, unknown>).documentElement =
		{
			getAttribute: () => null,
			setAttribute: () => undefined,
			removeAttribute: () => undefined,
		};
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
});

describe("the Urdu milestone editor's placeholders", () => {
	it("carry dir=rtl on both empty fields", async () => {
		const { DirectionProvider } = await import("@/ui/direction");
		const { default: ProjectDetail } = await import(
			"@/features/projects/project-detail"
		);
		await act(async () =>
			root.render(
				createElement(DirectionProvider, {
					direction: "rtl",
					locale: "ur",
					// biome-ignore lint/correctness/noChildrenProp: createElement form
					children: createElement(ProjectDetail),
				}),
			),
		);
		await act(async () => undefined);
		const add = host.presses.get(CONTROL.projectAddMilestone);
		expect(add).toBeDefined();
		await act(async () => add?.());

		for (const [testID, key] of [
			[
				CONTROL.projectMilestoneName,
				"mobile.projects.milestone.name_placeholder",
			],
			[
				CONTROL.projectMilestoneDate,
				"mobile.projects.milestone.target_date_placeholder",
			],
		] as const) {
			const field = host.inputs.get(testID);
			expect(field?.placeholder).toBe(renderFor(key, {}, "ur"));
			expect(field?.value).toBe("");
			expect(field?.dir).toBe("rtl");
		}
	});
});
