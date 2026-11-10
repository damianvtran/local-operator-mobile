import type { ReactNode } from "react";

/** Content modes share one modal/focus owner; switching is not navigation. */
export type WorkspaceDrawerMode = "agents" | "team-bridge";
export type WorkspaceDrawerController = {
	open: (options?: {
		mode?: WorkspaceDrawerMode;
		returnFocus?: () => void;
	}) => void;
	close: () => void;
	selectMode: (mode: WorkspaceDrawerMode) => void;
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
