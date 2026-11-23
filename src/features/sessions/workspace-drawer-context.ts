/*
 * The drawer's context and its readers, apart from `workspace-drawer.tsx`.
 *
 * `ConversationsPane` reads the context and renders the mode bar, while the
 * provider renders `ConversationsDrawer`, which renders the pane. Kept in
 * `workspace-drawer.tsx` they made a require cycle (provider -> drawer -> pane
 * -> provider) that Metro warns about in dev. This module imports only types,
 * so both sides depend on it and neither on the other.
 */
import { createContext, useContext } from "react";
import type {
	WorkspaceDrawerBridgeAdapter,
	WorkspaceDrawerController,
	WorkspaceDrawerMode,
} from "@/features/sessions/workspace-drawer.contract";

export const WorkspaceDrawerContext = createContext<
	| (WorkspaceDrawerController & {
			mode: WorkspaceDrawerMode;
			bridgeAdapter?: WorkspaceDrawerBridgeAdapter;
			newChatRequest: number;
			consumeNewChatRequest: (request: number) => boolean;
			setAgentsPresentation: (value: {
				notice?: string | null;
				homeDirectory?: string | null;
			}) => void;
	  })
	| null
>(null);

export const useWorkspaceDrawer = () => {
	const value = useContext(WorkspaceDrawerContext);
	if (!value) throw new Error("WorkspaceDrawerProvider is required");
	return value;
};

/**
 * Optional reader for surfaces (`ConversationsPane`) that render both inside
 * `WorkspaceDrawerProvider` and inside isolated tests without one.
 */
export const useOptionalWorkspaceDrawer = () =>
	useContext(WorkspaceDrawerContext);
