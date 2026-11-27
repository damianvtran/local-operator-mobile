import * as Clipboard from "expo-clipboard";
import {
	lazy,
	memo,
	type ReactNode,
	Suspense,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	AccessibilityInfo,
	Platform,
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { DiagramGlyph } from "@/features/session/components/diagram-glyphs";
import { useTextSelection } from "@/features/session/components/selectable-message";
import { GroupInsetContext } from "@/features/session/components/trace-rail";
import {
	currentResult,
	type DiagramRequest,
	type DiagramResult,
	peekDiagram,
	renderDiagram,
} from "@/features/session/diagram-render";
import {
	DIAGRAM_FRAME_PAD,
	diagramInnerWidth,
	diagramLayout,
} from "@/features/session/diagram-source";
import { peleThemeVariables } from "@/features/session/diagram-theme";
import { NATIVE_MONO_FAMILY } from "@/features/session/mono-face";
import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTheme } from "@/ui/appearance";
import { estimatedColumnWidth } from "@/ui/column";
import { LTR_TEXT } from "@/ui/direction";
import { HORIZONTAL_SCROLL_PROPS } from "@/ui/horizontal-scroll";
import { TOUCH_FLOOR } from "@/ui/layout";
import { ScrollSafePressable } from "@/ui/scroll-safe-pressable";
import { DiagramSvgView } from "./diagram-svg-view";

/**
 * A closed ```mermaid fence, drawn.
 *
 * The caller (`Markdown`) decides WHETHER a block is a diagram
 * (`isDiagramBlock`) and passes `fallback`, the ordinary code block for the same
 * lines. This component owns what to show instead of it:
 *
 *   - first frame, from the cache when the diagram was drawn before; otherwise
 *     the code block while Pele loads and renders (a few milliseconds, once);
 *   - `ok`: the diagram, in a frame, scaled to the column;
 *   - refused: the code block with the reason above it, in words and in colour
 *     (status is never colour alone) — the source stays readable and copyable.
 *
 * THEME. Colours are read from the app's role tokens through the active theme
 * entry and handed to Pele as concrete values, so a theme change (light, dark, any
 * custom palette) is a new request and a redraw, not a stale picture.
 *
 * GESTURES. Tapping the picture opens the full-screen viewer (pan, and pinch-zoom
 * on iOS: `diagram-viewer.tsx`, built on the Team Bridge image viewer's pattern);
 * a long press goes to the message's selection mode. The header's own button
 * copies the source (the code block's gesture, moved off the picture so a tap
 * on it can mean "look closer"). Inside the picture, a diagram wider than the
 * column scrolls SIDEWAYS only, so a one-finger vertical drag always scrolls
 * the transcript.
 *
 * THE FRAME IS `surface`, THE CODE BLOCK `sunken`: a figure on a card, a listing
 * in a well. Same border, radius and header strip; Pele paints its own
 * background as `surface`, so the card is the ground it was drawn for.
 */

/** The viewer is its own module, loaded the first time a diagram is opened: most
 *  diagrams are read in the transcript and never opened, and it brings the
 *  modal stack and safe-area machinery with it. */
const DiagramViewer = lazy(() =>
	import("@/features/session/components/diagram-viewer").then((module) => ({
		default: module.DiagramViewer,
	})),
);

const WEB = Platform.OS === "web";

/** How long the "copied" marker stays. */
const COPIED_MS = 1500;

/** The source as the control's spoken value: whole for any ordinary diagram,
 *  cut at a length a screen reader can sensibly read. */
const SPOKEN_LIMIT = 2000;
const spoken = (source: string): string =>
	source.length > SPOKEN_LIMIT ? `${source.slice(0, SPOKEN_LIMIT)}…` : source;

/** Family names per target. Native: the platform sans (undefined, like the rest
 *  of the transcript's prose) and the bundled mono face. Web: the faces
 *  `theme.css` declares, by their CSS names. */
const FONTS = WEB
	? { sans: "Figtree", mono: "JetBrains Mono" }
	: { sans: undefined, mono: NATIVE_MONO_FAMILY };

/** Pele's variables from the ACTIVE theme's role values. `active` changes
 *  identity exactly when the palette does (mode, slot or system scheme), so the
 *  memo below is the theme-change trigger and nothing else is subscribed. */
const useDiagramTheme = (): Record<string, string> => {
	const { active } = useTheme();
	return useMemo(
		() => peleThemeVariables((role) => active.colors[role]),
		[active],
	);
};

function DiagramBlockView({
	source,
	language,
	fallback,
}: {
	source: string;
	language: string;
	fallback: ReactNode;
}) {
	const theme = useDiagramTheme();
	const viewport = useWindowDimensions();
	const groupInsetPt = useContext(GroupInsetContext);
	const [measured, setMeasured] = useState(0);
	const column =
		measured > 0
			? measured
			: Math.max(0, estimatedColumnWidth(viewport) - groupInsetPt);
	const inner = diagramInnerWidth(column);

	const request: DiagramRequest = useMemo(
		() => ({ source, width: inner, theme, fonts: FONTS }),
		[source, inner, theme],
	);
	const [settled, setSettled] = useState<{
		request: DiagramRequest;
		result: DiagramResult;
	} | null>(null);

	// A synchronous answer when this diagram was drawn before (a virtualised row
	// mounting again), so the first frame is the diagram and not the code block.
	const cached = peekDiagram(request);
	// A new request for the SAME source (a theme change, a rotation, a width the
	// estimate got wrong) keeps the last drawing until the new one settles: the
	// alternative is the code block for a frame, a 400 pt jump and back.
	const current = currentResult(cached, settled, source);

	useEffect(() => {
		if (cached) return;
		let live = true;
		renderDiagram(request).then((result) => {
			if (live) setSettled({ request, result });
		});
		return () => {
			live = false;
		};
	}, [request, cached]);

	const [copied, setCopied] = useState(false);
	const [viewing, setViewing] = useState(false);
	const { enter } = useTextSelection();
	const { active } = useTheme();

	// The marker is transient (the code block's comment says so; its own never
	// clears): it resets after a beat, and with the source, so a new diagram in a
	// reused row never wears the last one's "copied".
	// biome-ignore lint/correctness/useExhaustiveDependencies: `source` is the reset trigger, not a value read inside.
	useEffect(() => setCopied(false), [source]);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), COPIED_MS);
		return () => clearTimeout(timer);
	}, [copied]);

	if (!current) return <>{fallback}</>;
	if (!current.ok) {
		return (
			<View className="gap-1">
				<Text className="text-meta text-danger">
					{t("mobile.session.diagram.error")}
				</Text>
				{current.message !== "" ? (
					// Pele's own words, English and verbatim: a parser diagnostic about the
					// reader's source, not interface copy, so it keeps its own direction.
					<Text
						className="text-meta text-ink-dim"
						style={LTR_TEXT}
						numberOfLines={2}
					>
						{current.message}
					</Text>
				) : null}
				{fallback}
			</View>
		);
	}

	const { prepared, type } = current;
	const layout = diagramLayout(prepared, inner);
	const label =
		prepared.label !== ""
			? t("mobile.session.diagram.label_titled", {
					type,
					title: prepared.label,
				})
			: t("mobile.session.diagram.label", { type });

	const drawing = (
		<View
			// The drawing is one figure; its words are the source, which the control
			// below exposes as its value. Reading every `<text>` out in paint order
			// would not be the diagram.
			aria-hidden
			style={{ width: layout.width, height: layout.height }}
		>
			<DiagramSvgView prepared={prepared} scale={layout.scale} />
		</View>
	);

	const marker = copied
		? `${language} · ${t("mobile.session.diagram.copied")}`
		: language;
	const copy = () => {
		void Clipboard.setStringAsync(source).then(() => {
			setCopied(true);
			AccessibilityInfo.announceForAccessibility(
				t("mobile.session.diagram.copied"),
			);
		});
	};

	return (
		<View
			className="overflow-hidden rounded-sm border border-hairline bg-surface"
			onLayout={(event) => {
				const width = Math.round(event.nativeEvent.layout.width);
				if (width > 0 && width !== measured) setMeasured(width);
			}}
		>
			<View className="flex-row items-center border-b border-hairline ps-2">
				<Text className="min-w-0 flex-1 text-meta text-ink-dim">{marker}</Text>
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={t("mobile.session.diagram.copy")}
					testID={CONTROL.diagramCopy}
					onPress={copy}
					className="items-center justify-center"
					style={{ width: TOUCH_FLOOR, height: TOUCH_FLOOR }}
				>
					<DiagramGlyph
						kind={copied ? "check" : "copy"}
						color={active.colors["ink-dim"]}
					/>
				</Pressable>
			</View>
			<ScrollSafePressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={label}
				accessibilityHint={t("mobile.session.diagram.open_hint")}
				// The Mermaid source is the text alternative: the picture's words, in
				// the order the author wrote them, for a reader who cannot see it.
				aria-valuetext={spoken(source)}
				testID={CONTROL.diagramOpen}
				onPress={() => setViewing(true)}
				onLongPress={enter}
			>
				{layout.scrolls ? (
					<ScrollView
						horizontal
						// Sideways only: vertical drags fall through to the transcript. The
						// indicator is the cue that the figure continues past the edge.
						showsHorizontalScrollIndicator
						nestedScrollEnabled
						{...HORIZONTAL_SCROLL_PROPS}
					>
						<View style={{ padding: DIAGRAM_FRAME_PAD }}>{drawing}</View>
					</ScrollView>
				) : (
					<View style={{ padding: DIAGRAM_FRAME_PAD, alignItems: "center" }}>
						{drawing}
					</View>
				)}
			</ScrollSafePressable>
			{viewing ? (
				<Suspense fallback={null}>
					<DiagramViewer
						prepared={prepared}
						onClose={() => setViewing(false)}
					/>
				</Suspense>
			) : null}
		</View>
	);
}

/** Memoised on the source: a closed fence above a growing tail must not redraw
 *  with every streamed token. `fallback` is rebuilt by the parent each frame, so
 *  it is deliberately not compared — it is a function of `source`/`language`. */
export const DiagramBlock = memo(
	DiagramBlockView,
	(before, after) =>
		before.source === after.source && before.language === after.language,
);
