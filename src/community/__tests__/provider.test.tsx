import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CommunityContext, useCommunityRows } from "@/community/provider";
import { createCommunityStore } from "@/community/store";
import { installDomShim } from "@/testing/dom-shim";

/**
 * Regression: the switcher once selected `communityRows` straight through
 * `useStore`, which returns a fresh array per read; useSyncExternalStore never
 * settled and React aborted with #185 (a blank screen in the web export). The
 * hook must give the SAME rows object across renders until the store writes.
 */
describe("useCommunityRows", () => {
	it("settles, and keeps its identity across unrelated renders", async () => {
		const scope = createCommunityStore({ client: () => null });
		scope.store.setState({
			communities: {
				state: "ready",
				error: null,
				data: {
					joined: [
						{ id: "loc", slug: "loc", name: "Local Operator", state: "active" },
					],
					featured: [],
				},
			},
		});
		const seen: unknown[] = [];
		const Probe = () => {
			seen.push(useCommunityRows());
			return null;
		};
		const dom = installDomShim();
		const root = createRoot(dom.container as Element);
		try {
			await act(async () =>
				root.render(
					createElement(
						CommunityContext.Provider,
						{ value: { ...scope, fixture: false, retire: () => {} } },
						createElement(Probe),
					),
				),
			);
			await act(async () => scope.store.setState({ drafts: { k: "typing" } }));
			expect(seen.length).toBeGreaterThan(0);
			expect(new Set(seen).size).toBe(1);
			expect(seen[0]).toEqual([
				{
					communityId: "loc",
					name: "Local Operator",
					readOnly: false,
					unread: 0,
				},
			]);
		} finally {
			await act(async () => root.unmount());
			dom.dispose();
			scope.actions.close();
		}
	});
});
