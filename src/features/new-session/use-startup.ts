import { useFocusEffect } from "expo-router";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import {
	getStartupAuthorization,
	subscribeStartupAuthorization,
} from "@/connection/startup-authorization";
import type { PromptImage } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import type { StartSessionRequest } from "@/relay/endpoints";
import type {
	StartupCoordinator,
	StartupDraft,
	StartupSnapshot,
} from "./startup-coordinator";
import {
	openStartup,
	type StartupAuthorization,
	startupForSession,
} from "./startup-runtime";

const EMPTY: StartupSnapshot = {
	version: 1,
	scope: "",
	phase: "draft",
	sessionId: null,
	selection: null,
	draft: { text: "", images: [] },
	queue: [],
	error: null,
	loaded: false,
};
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY;

/** The editor exists independently of backend/configuration readiness. Its
 * coordinator owns persistence and sends; navigation only attaches/detaches it.
 * Auth replacement hides the old snapshot synchronously, before an effect runs. */
export function useStartup(
	selection: StartSessionRequest | null,
	sessionId?: string,
) {
	const authorization = useSyncExternalStore(
		subscribeStartupAuthorization,
		getStartupAuthorization,
		getStartupAuthorization,
	);
	const { relay } = useConnection();
	const client = relay();
	const [owner, setOwner] = useState<{
		auth: StartupAuthorization;
		coordinator: StartupCoordinator;
	} | null>(null);
	const [openingError, setOpeningError] = useState<string | null>(null);
	const [local, setLocal] = useState<StartupDraft>({ text: "", images: [] });
	const localRef = useRef(local);
	const typedLocally = useRef(false);
	const previousAuth = useRef(authorization);
	const active =
		owner !== null &&
		owner.auth.scope === authorization?.scope &&
		owner.auth.revision === authorization.revision &&
		(sessionId === undefined ||
			owner.coordinator.snapshot().sessionId === sessionId);
	const coordinator = active ? owner.coordinator : null;
	const snapshot = useSyncExternalStore(
		coordinator?.subscribe ?? noopSubscribe,
		coordinator?.snapshot ?? emptySnapshot,
		emptySnapshot,
	);

	useEffect(() => {
		if (
			previousAuth.current !== null &&
			previousAuth.current !== authorization
		) {
			localRef.current = { text: "", images: [] };
			typedLocally.current = false;
			setLocal(localRef.current);
			owner?.coordinator.pause();
		}
		previousAuth.current = authorization;
	}, [authorization, owner]);

	useFocusEffect(
		useCallback(() => {
			let live = true;
			let attached: StartupCoordinator | null = null;
			if (authorization && client) {
				void (
					sessionId === undefined
						? openStartup(authorization, client)
						: startupForSession(authorization, client, sessionId)
				)
					.then((next) => {
						if (next === null) {
							if (live) setOwner(null);
							return;
						}
						if (!live) {
							next.pause();
							return;
						}
						attached = next;
						if (typedLocally.current) {
							next.edit(localRef.current.text, localRef.current.images);
							typedLocally.current = false;
						}
						setOpeningError(null);
						setOwner({ auth: authorization, coordinator: next });
						next.resume();
					})
					.catch(() => {
						if (live)
							setOpeningError(
								"Could not open safe draft storage. You can keep editing; nothing will be sent.",
							);
					});
			}
			return () => {
				live = false;
				attached?.pause();
			};
		}, [authorization, client, sessionId]),
	);

	useEffect(() => {
		if (coordinator && selection) void coordinator.configure(selection);
	}, [coordinator, selection]);
	const configure = (next: StartSessionRequest) =>
		coordinator?.configure(next, true) ?? Promise.resolve();
	useEffect(() => {
		if (!coordinator) return;
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") coordinator.resume();
			else coordinator.pause();
		});
		return () => subscription.remove();
	}, [coordinator]);

	const edit = (text: string, images: PromptImage[]) => {
		if (authorization !== getStartupAuthorization()) return;
		if (coordinator) coordinator.edit(text, images);
		else {
			typedLocally.current = true;
			localRef.current = { text, images };
			setLocal(localRef.current);
		}
	};
	const draft = coordinator
		? snapshot.draft
		: previousAuth.current !== null && previousAuth.current !== authorization
			? EMPTY.draft
			: local;
	return {
		coordinator,
		snapshot: { ...snapshot, draft, error: openingError ?? snapshot.error },
		setText: (text: string) =>
			edit(
				text,
				coordinator?.snapshot().draft.images ?? localRef.current.images,
			),
		setImages: (
			images: PromptImage[] | ((current: PromptImage[]) => PromptImage[]),
		) => {
			const current = coordinator?.snapshot().draft ?? localRef.current;
			edit(
				current.text,
				typeof images === "function" ? images(current.images) : images,
			);
		},
		send: () => {
			if (coordinator) void coordinator.enqueue();
			else
				setOpeningError(
					"Waiting for a safe connection. Your draft is still here.",
				);
		},
		configure,
		retry: () => {
			if (coordinator) void coordinator.retry();
		},
		newConversation: async () => {
			if (!authorization || !client) return;
			const next = await openStartup(authorization, client, true);
			setOwner({ auth: authorization, coordinator: next });
			next.resume();
		},
	};
}
