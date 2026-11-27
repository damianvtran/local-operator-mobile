import type { ReactNode } from "react";
import type { SharedValue } from "react-native-reanimated";

/** Content modes share one modal/focus owner; switching is not navigation. */
export type WorkspaceDrawerMode = "agents" | "team-bridge";
export type WorkspaceDrawerController = {
	/** The drawer's opening progress (0 closed … 1 full width), on the UI
	 *  thread. Lives here so a future gesture (`commit B`) can drive the same
	 *  value the shell reads, without a second owner. */
	progress: SharedValue<number>;
	/** The reader's intent: open. False from the instant a close starts; the
	 *  page swipe is disabled while it is true. */
	visible: boolean;
	open: (options?: {
		mode?: WorkspaceDrawerMode;
		returnFocus?: () => void;
	}) => void;
	close: () => void;
	selectMode: (mode: WorkspaceDrawerMode) => void;
	/** Mount the panel off-screen at touch-down, without settling it. */
	prime: () => void;
	/** Drop a primed panel a touch never dragged (a tap, a scroll). */
	abandon: () => void;
	/** Settle to open or closed from wherever a finger left the panel. */
	settle: (open: boolean) => void;
};

/** The Bridge owner supplies its live projection, never a mirrored drawer store.
 * No adapter means no Bridge entry, rather than an inert promised destination. */
export type WorkspaceDrawerBridgeAdapter = {
	bridgePane: (props: {
		onNavigate: () => void;
		/** Present only in the temporary drawer. The docked split pane has
		 *  nothing to close and omits it, which is also how the pane tells its
		 *  `bg-elevated` drawer ground from the docked `bg-canvas` (QA Q2-1). */
		onClose?: () => void;
	}) => ReactNode;
	bridgeBadge: {
		count: number | null;
		state: "ready" | "loading" | "unavailable";
		a11yLabel: string;
	};
};
