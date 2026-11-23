import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ScrollView, View } from "react-native";
import {
	type AvatarViewportBox,
	createViewportSignal,
	inAvatarViewport,
	type ViewportSignal,
} from "@/features/team-bridge/avatar-viewport";

// Rows subscribe to one measured clipping box; do not measure the viewport
// again for every mounted avatar on each scroll event.
const AvatarViewportContext = createContext<{
	signal: ViewportSignal;
	box: RefObject<AvatarViewportBox | null>;
} | null>(null);

export function AvatarViewportProvider({
	signal,
	clip,
	children,
}: {
	signal: ViewportSignal;
	clip: RefObject<ScrollView | null>;
	children: ReactNode;
}) {
	const [viewport] = useState(() => ({
		signal: createViewportSignal(),
		box: { current: null as AvatarViewportBox | null },
	}));
	// Publish after measuring the container, then each row measures at the same
	// coordinate origin. Ignore out-of-order measures from a rapid fling.
	useEffect(() => {
		let revision = 0;
		const measure = () => {
			const ticket = ++revision;
			clip.current
				?.getNativeScrollRef()
				?.measureInWindow((_x, y, width, height) => {
					if (ticket !== revision) return;
					viewport.box.current = { y, width, height };
					viewport.signal.emit();
				});
		};
		const unsubscribe = signal.subscribe(measure);
		const frame = requestAnimationFrame(measure);
		measure();
		return () => {
			revision += 1;
			cancelAnimationFrame(frame);
			unsubscribe();
		};
	}, [clip, signal, viewport]);
	return (
		<AvatarViewportContext.Provider value={viewport}>
			{children}
		</AvatarViewportContext.Provider>
	);
}

/** Visibility is reversible so leaving a row can withdraw its queued photo. */
export function useAvatarViewport(ref: RefObject<View | null>) {
	const viewport = useContext(AvatarViewportContext);
	const [visible, setVisible] = useState(false);
	const generation = useRef(0);
	useEffect(() => {
		if (!viewport) return;
		const measure = () => {
			const ticket = ++generation.current;
			ref.current?.measureInWindow((_x, y, width, height) => {
				if (ticket === generation.current) {
					const clip = viewport.box.current;
					setVisible(
						clip !== null && inAvatarViewport({ y, width, height }, clip),
					);
				}
			});
		};
		const unsubscribe = viewport.signal.subscribe(measure);
		measure();
		return () => {
			generation.current += 1;
			unsubscribe();
		};
	}, [ref, viewport]);
	return { visible: viewport === null || visible, row: viewport !== null };
}
