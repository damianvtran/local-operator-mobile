import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { SkillEntry } from "@/contracts";
import type { RelayEndpoints } from "@/relay/endpoints";
import { installDomShim } from "@/testing/dom-shim";
import { useSkills } from "./use-skills";

/*
 * The hook in the Node host, driven the way the platform drives it: the field's
 * `onChangeText`, then `onSelectionChange`, `onFocus`, `onBlur`. `Screen` stands
 * in for the session screen, which owns the draft the hook reads and writes.
 */
const CATALOGUE: SkillEntry[] = [
	{ name: "ape-agent", description: "Drive an agent", hidden: false },
	{ name: "research", description: "Look it up", hidden: false },
	{ name: "secret", description: "By name only", hidden: true },
];

type Hook = ReturnType<typeof useSkills>;

const selectionEvent = (start: number, end = start) =>
	({ nativeEvent: { selection: { start, end } } }) as never;

const mount = (
	options: {
		available?: boolean;
		slash?: boolean;
		skills?: () => Promise<{ skills: SkillEntry[] }>;
		endpoints?: boolean;
	} = {},
) => {
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	const skills = vi.fn(
		options.skills ?? (() => Promise.resolve({ skills: CATALOGUE })),
	);
	const state = { text: "", hook: null as Hook | null };
	const config = { available: options.available ?? true, slash: options.slash };
	const endpoints =
		options.endpoints === false
			? null
			: ({ skills } as unknown as Pick<RelayEndpoints, "skills">);
	const setText = vi.fn((next: string) => {
		state.text = next;
		render();
	});
	function Screen() {
		state.hook = useSkills({
			sessionId: "s1",
			endpoints,
			available: config.available,
			text: state.text,
			setText,
			slashDraft: config.slash ?? state.text.startsWith("/"),
		});
		return null;
	}
	const render = () => root.render(<Screen />);
	const hook = () => {
		if (!state.hook) throw new Error("not mounted");
		return state.hook;
	};
	return { state, hook, root, skills, setText, config, render };
};

const settled = async (m: ReturnType<typeof mount>) => {
	await act(async () => {
		m.render();
		await Promise.resolve();
	});
};

const type = (m: ReturnType<typeof mount>, text: string) =>
	act(() => m.hook().onChangeText(text));

describe("useSkills", () => {
	it("fetches the catalogue ONCE per session, only when the capability is on", async () => {
		const on = mount();
		await settled(on);
		expect(on.skills).toHaveBeenCalledTimes(1);
		expect(on.skills).toHaveBeenCalledWith("s1");
		// Typing never refetches.
		type(on, "$");
		type(on, "$re");
		expect(on.skills).toHaveBeenCalledTimes(1);
		act(() => on.root.unmount());

		const off = mount({ available: false });
		await settled(off);
		expect(off.skills).not.toHaveBeenCalled();
		type(off, "$");
		expect(off.hook().rows).toEqual([]);
		act(() => off.root.unmount());

		const none = mount({ endpoints: false });
		await settled(none);
		type(none, "$");
		expect(none.hook().rows).toEqual([]);
		act(() => none.root.unmount());
	});

	it("opens on $ and narrows by prefix as the user types", async () => {
		const m = mount();
		await settled(m);
		type(m, "$");
		expect(m.hook().rows.map((row) => row.name)).toEqual([
			"ape-agent",
			"research",
			"secret",
		]);
		type(m, "$re");
		expect(m.hook().rows.map((row) => row.name)).toEqual(["research"]);
		act(() => m.root.unmount());
	});

	it("a pick rewrites only the token, hands the field a one-shot caret, and closes", async () => {
		const m = mount();
		await settled(m);
		type(m, "please use $re now");
		// The platform reports the caret inside the token.
		act(() => m.hook().onSelectionChange(selectionEvent(14)));
		expect(m.hook().rows.map((row) => row.name)).toEqual(["research"]);
		act(() => m.hook().pick("research"));
		expect(m.state.text).toBe("please use $research now");
		expect(m.hook().selection).toEqual({ start: 21, end: 21 });
		expect(m.hook().rows).toEqual([]);
		// The platform's own report releases the one-shot (a controlled
		// `selection` would fight the IME).
		act(() => m.hook().onSelectionChange(selectionEvent(21)));
		expect(m.hook().selection).toBeUndefined();
		expect(m.hook().rows).toEqual([]);
		act(() => m.root.unmount());
	});

	it("the pick never touches focus: only text and selection change", async () => {
		const m = mount();
		await settled(m);
		type(m, "$");
		const before = m.hook();
		act(() => before.pick("ape-agent"));
		expect(m.state.text).toBe("$ape-agent ");
		// There is no blur/focus handler call on the pick path.
		expect(m.setText).toHaveBeenLastCalledWith("$ape-agent ");
		act(() => m.root.unmount());
	});

	it("a leading / belongs to the slash sheet: the tray never opens", async () => {
		const m = mount();
		await settled(m);
		type(m, "/team $re");
		expect(m.hook().rows).toEqual([]);
		act(() => m.root.unmount());
	});

	it("a remote conversation (capability off) opens nothing and fetches nothing", async () => {
		const m = mount({ available: false });
		await settled(m);
		type(m, "$re");
		expect(m.hook().rows).toEqual([]);
		expect(m.skills).not.toHaveBeenCalled();
		act(() => m.root.unmount());
	});

	it("ANY catalogue failure leaves the tray closed, silently", async () => {
		const m = mount({ skills: () => Promise.reject(new Error("404")) });
		await settled(m);
		type(m, "$");
		expect(m.hook().rows).toEqual([]);
		act(() => m.root.unmount());
	});

	it("a restored draft does not open until the user focuses or edits", async () => {
		const m = mount();
		m.state.text = "$re";
		await settled(m);
		// A passive selection report on an untouched draft: still closed.
		act(() => m.hook().onSelectionChange(selectionEvent(3)));
		expect(m.hook().rows).toEqual([]);
		// Focus is the user's gesture.
		act(() => m.hook().onFocus());
		expect(m.hook().rows.map((row) => row.name)).toEqual(["research"]);
		act(() => m.root.unmount());
	});

	it("text changed under the hook (a send cleared it) resets: nothing stays armed", async () => {
		const m = mount();
		await settled(m);
		type(m, "$re");
		expect(m.hook().rows).toHaveLength(1);
		act(() => {
			m.state.text = "$re";
			m.setText("");
		});
		expect(m.hook().rows).toEqual([]);
		// Dictation appends `$re` while the field is not being edited: still closed.
		act(() => m.setText("$re"));
		expect(m.hook().rows).toEqual([]);
		act(() => m.root.unmount());
	});

	it("blur dismisses; a row press in flight is not a dismissal; focus re-arms", async () => {
		const m = mount();
		await settled(m);
		type(m, "$re");
		act(() => m.hook().hold());
		act(() => m.hook().onBlur());
		expect(m.hook().rows).toHaveLength(1);
		act(() => m.hook().release());
		act(() => m.hook().onBlur());
		expect(m.hook().rows).toEqual([]);
		// The selection report a dismissing gesture also produces does not reopen.
		act(() => m.hook().onSelectionChange(selectionEvent(3)));
		expect(m.hook().rows).toEqual([]);
		act(() => m.hook().onFocus());
		expect(m.hook().rows).toHaveLength(1);
		act(() => m.root.unmount());
	});

	it("a range selection closes the tray; collapsing it reopens", async () => {
		const m = mount();
		await settled(m);
		type(m, "$re");
		act(() => m.hook().onSelectionChange(selectionEvent(0, 3)));
		expect(m.hook().rows).toEqual([]);
		act(() => m.hook().onSelectionChange(selectionEvent(3)));
		expect(m.hook().rows).toHaveLength(1);
		act(() => m.root.unmount());
	});

	it("typing past the token closes it without any dismissal", async () => {
		const m = mount();
		await settled(m);
		type(m, "$re");
		type(m, "$re ");
		expect(m.hook().rows).toEqual([]);
		act(() => m.root.unmount());
	});
});
