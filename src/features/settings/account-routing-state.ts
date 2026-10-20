import { createStore } from "zustand/vanilla";
import type { Payload } from "@/contracts";
import { isRelayError, isRelayMissing, type RelayEndpoints } from "@/relay";

export type AccountRoutingRead =
	| { kind: "loading" }
	| { kind: "ready"; payload: Payload<"accountRouting"> }
	| { kind: "unsupported" | "error"; serverText: string | null };
export type AccountRoutingSave =
	| "idle"
	| "pending"
	| "saved"
	| "rejected"
	| "error";
export type AccountRoutingState = {
	read: AccountRoutingRead;
	draft: string;
	save: AccountRoutingSave;
	saveError: string | null;
};
type Client = Pick<RelayEndpoints, "accountRouting" | "setAccountRouting">;
const backendText = (error: unknown): string | null =>
	isRelayError(error) && error.serverError?.trim() ? error.serverError : null;

/** Ephemeral view state for ONE immutable selected-route client.
 *
 * This is not connection-store or a phone routing policy. It owns no default,
 * choices, language or persistence; backend metadata supplies every such fact.
 * Keeping async state outside RN follows this repo's Node-test boundary and
 * permits real transport/race controls without calling them native proof.
 * A new client gets a NEW model at render time, so old responses cannot flash
 * on another computer before an effect cleanup runs. Lifecycle generation also
 * protects disconnect/unmount and React's setup/cleanup/setup development cycle.
 */
export function createAccountRoutingEditor(client: Client) {
	let active = false;
	let generation = 0;
	let pending = false;
	const store = createStore<AccountRoutingState>(() => ({
		read: { kind: "loading" },
		draft: "",
		save: "idle",
		saveError: null,
	}));
	const owns = (ticket: number) => active && generation === ticket;

	const reload = async () => {
		if (!active || pending) return;
		const ticket = ++generation;
		store.setState({
			read: { kind: "loading" },
			save: "idle",
			saveError: null,
		});
		try {
			const payload = await client.accountRouting();
			if (owns(ticket))
				store.setState({
					read: { kind: "ready", payload },
					draft: payload.setting.value,
				});
		} catch (error) {
			if (owns(ticket))
				store.setState({
					read: {
						kind: isRelayMissing(error) ? "unsupported" : "error",
						serverText: backendText(error),
					},
				});
		}
	};
	return Object.assign(store, {
		activate: () => {
			active = true;
			pending = false;
			return reload();
		},
		deactivate: () => {
			active = false;
			pending = false;
			generation += 1;
		},
		reload,
		choose: (value: string) => {
			const snapshot = store.getState();
			if (!active || pending || snapshot.read.kind !== "ready") return;
			if (
				!snapshot.read.payload.setting.choices.some(
					(choice) => choice.value === value,
				)
			)
				return;
			store.setState({ draft: value, save: "idle", saveError: null });
		},
		savePolicy: async () => {
			const snapshot = store.getState();
			if (!active || pending || snapshot.read.kind !== "ready") return;
			const requested = snapshot.draft;
			if (requested === snapshot.read.payload.setting.value) return;
			if (
				!snapshot.read.payload.setting.choices.some(
					(choice) => choice.value === requested,
				)
			)
				return;
			const ticket = generation;
			// Native presses can arrive before disabled props commit. This guard
			// admits one setting intent, not one request per batched press.
			pending = true;
			store.setState({ save: "pending", saveError: null });
			try {
				const payload = await client.setAccountRouting(requested);
				if (owns(ticket))
					store.setState({
						read: { kind: "ready", payload },
						save: payload.setting.value === requested ? "saved" : "error",
					});
			} catch (error) {
				if (owns(ticket))
					store.setState({
						save:
							isRelayError(error) &&
							error.kind === "rejected" &&
							(error.status ?? 0) >= 400 &&
							(error.status ?? 0) < 500
								? "rejected"
								: "error",
						saveError: backendText(error),
					});
			} finally {
				if (owns(ticket)) pending = false;
			}
		},
	});
}
