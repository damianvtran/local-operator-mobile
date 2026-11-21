/**
 * A remote conversation row paints its device line, and announces it, from the
 * catalogue (i18n slice: the remote row's "On <device>" line).
 *
 * THE DEFECT. `ListRow` painted the literal `On {remote.device}`: English in
 * every language, and a sentence a translator could not reorder (Hindi and
 * Urdu put the postposition after the name). The string scanner did not see it
 * (JSX text of one short word before an expression), so only a render proves
 * the line now reads through `mobile.sidebar.row.on_device`.
 *
 * WHY A MOUNTED TEST. The line is JSX inside `ListRow`, not a pure helper, so
 * the REAL `ListRow` renders through react-dom with react-native's primitives
 * replaced by a recorder (the same boundary stubs
 * `features/sessions/__tests__/session-row-locale-frame.test.tsx` uses), and
 * the test reads back both the painted line and the row's one accessible name.
 */
import {
	act,
	createElement,
	Fragment,
	isValidElement,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const host = vi.hoisted(() => ({
	/** Every string child and string prop, with the testID of its element. */
	records: [] as { testID?: string; prop: string; text: string }[],
}));

function strings(node: unknown): string[] {
	if (typeof node === "string") return [node];
	if (Array.isArray(node)) return node.flatMap(strings);
	return [];
}

/** Records every string prop and string child it is handed. */
function Recorder(props: Record<string, unknown>): ReactNode {
	const testID = typeof props.testID === "string" ? props.testID : undefined;
	const nested: ReactNode[] = [];
	for (const [name, value] of Object.entries(props)) {
		if (name === "children") continue;
		/* The paragraph base the native half of `useComposedDir()` states — the
		 *  one non-string prop the direction test needs to read back. */
		if (
			name === "style" &&
			value !== null &&
			typeof value === "object" &&
			typeof (value as { writingDirection?: unknown }).writingDirection ===
				"string"
		)
			host.records.push({
				testID,
				prop: "writingDirection",
				text: (value as { writingDirection: string }).writingDirection,
			});
		if (typeof value === "string")
			host.records.push({ testID, prop: name, text: value });
		else if (isValidElement(value)) nested.push(value);
	}
	const children =
		typeof props.children === "function"
			? (props.children as (state: { pressed: boolean }) => ReactNode)({
					pressed: false,
				})
			: (props.children as ReactNode);
	/* A child of `{t(...)}` arrives as one string; React would also accept
	 *  `["On ", name]`, which is what the old literal produced — joined here so
	 *  the assertion compares the whole painted line either way. */
	const text = strings(children).join("");
	if (text !== "") host.records.push({ testID, prop: "children", text });
	return createElement(Fragment, null, ...nested, children ?? null);
}

vi.mock("react-native", () => {
	class Value {
		constructor(public value: number) {}
		setValue(next: number): void {
			this.value = next;
		}
	}
	const animation = { start: () => undefined, stop: () => undefined };
	return {
		View: Recorder,
		Text: Recorder,
		Pressable: Recorder,
		ActivityIndicator: () => null,
		Animated: {
			View: Recorder,
			Value,
			loop: () => animation,
			sequence: () => animation,
			timing: () => animation,
		},
		Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios },
		PixelRatio: { getFontScale: () => 1 },
		useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
	};
});
vi.mock("lucide-react-native", () => ({ Check: () => null }));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000000",
	useReducedMotion: () => true,
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/shimmer", () => ({ Shimmer: () => null }));

const INDICATOR = "remote-row-indicator";
/** A user-chosen name with a space and a digit: it must arrive verbatim. */
const DEVICE = "Studio Mac 2";

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	host.records = [];
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
});

/** Mounts the real row; `direction` wraps it in the app's DirectionProvider,
 *  as the root does for the active catalogue. */
async function mountRemoteRow(direction?: "ltr" | "rtl"): Promise<void> {
	const { ListRow } = await import("@/ui/components/list-row");
	const { DirectionProvider } = await import("@/ui/direction");
	const row = createElement(ListRow, {
		title: "Payments",
		remote: {
			device: DEVICE,
			reachable: true,
			indicatorTestID: INDICATOR,
		},
		onPress: () => undefined,
	});
	await act(async () =>
		root.render(
			direction === undefined
				? row
				: createElement(DirectionProvider, {
						direction,
						locale: direction === "rtl" ? "ur" : "en",
						// biome-ignore lint/correctness/noChildrenProp: createElement form
						children: row,
					}),
		),
	);
}

const deviceLineBase = (): string[] =>
	host.records
		.filter((r) => r.testID === INDICATOR && r.prop === "writingDirection")
		.map((r) => r.text);

const deviceLine = (): string[] =>
	host.records
		.filter((r) => r.testID === INDICATOR && r.prop === "children")
		.map((r) => r.text);

const accessibleNames = (): string[] =>
	host.records
		.filter((r) => r.prop === "accessibilityLabel")
		.map((r) => r.text);

describe("a remote row's device line is keyed", () => {
	it("paints the English sentence byte for byte", async () => {
		setLocaleSource(() => "en");
		await mountRemoteRow();
		expect(deviceLine()).toEqual([`On ${DEVICE}`]);
		expect(accessibleNames()).toContain(`Payments, on ${DEVICE}`);
	});

	it("paints and announces the reader's catalogue (ur), name intact", async () => {
		setLocaleSource(() => "ur");
		await mountRemoteRow();
		const line = renderFor(
			"mobile.sidebar.row.on_device",
			{ device: DEVICE },
			"ur",
		);
		// Guard: an Urdu line equal to English would pass without the key.
		expect(line).not.toBe(`On ${DEVICE}`);
		expect(line).toContain(DEVICE);
		expect(deviceLine()).toEqual([line]);
		expect(accessibleNames()).toContain(
			renderFor(
				"mobile.sidebar.row_label.join",
				{
					first: "Payments",
					second: renderFor(
						"mobile.sidebar.row_label.on_device",
						{ device: DEVICE },
						"ur",
					),
				},
				"ur",
			),
		);
	});
});

/* Audit ondev-ur-5a0f53 (A-ur-1/R-ur-1): the line mixes the Urdu frame with a
 * usually-Latin name, so it must state the page's base rather than inherit one
 * from its first strong character. Platform is mocked as iOS, where the answer
 * is the `writingDirection` style. */
describe("a remote row's device line states the page's direction", () => {
	it("an RTL page gives the line an rtl base", async () => {
		setLocaleSource(() => "ur");
		await mountRemoteRow("rtl");
		expect(deviceLineBase()).toEqual(["rtl"]);
	});

	it("an LTR page adds nothing (the catalogue's own base stands)", async () => {
		setLocaleSource(() => "en");
		await mountRemoteRow("ltr");
		expect(deviceLineBase()).toEqual([]);
		expect(deviceLine()).toEqual([`On ${DEVICE}`]);
	});
});
