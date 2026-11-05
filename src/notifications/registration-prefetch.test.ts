import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
	os: "ios",
	fail: false,
	item: null as string | null,
}));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return seam.os;
		},
	},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "synthetic-install" }));
vi.mock("@/connection", () => {
	const adapter = {
		getItemAsync: async () => seam.item,
		setItemAsync: async (_key: string, value: string) => {
			if (seam.fail) throw Error("Keystore unavailable");
			seam.item = value;
		},
	};
	return {
		expoSecureStore: async () => adapter,
		memorySecureStore: () => adapter,
	};
});

import { onPushRegistration, recordRegistration } from "./install-id";

beforeEach(() => {
	seam.os = "ios";
	seam.fail = false;
	seam.item = JSON.stringify({ v: 1, install_id: "synthetic-install" });
});
describe("registration readiness trigger", () => {
	it("fires only after registration is persisted", async () => {
		let seen = "";
		const stop = onPushRegistration(() => {
			seen = seam.item ?? "";
		});
		try {
			await recordRegistration("synthetic-device", "synthetic-key");
			expect(JSON.parse(seen).device_id).toBe("synthetic-device");
		} finally {
			stop();
		}
	});
	it("does not advertise a key whose keystore write failed", async () => {
		seam.fail = true;
		const callback = vi.fn();
		const stop = onPushRegistration(callback);
		try {
			await recordRegistration("synthetic-device", "synthetic-key");
			expect(callback).not.toHaveBeenCalled();
		} finally {
			stop();
		}
	});
	it("does not claim native persistence on the web fallback", async () => {
		seam.os = "web";
		const callback = vi.fn();
		const stop = onPushRegistration(callback);
		try {
			await recordRegistration("synthetic-device", "synthetic-key");
			expect(callback).not.toHaveBeenCalled();
		} finally {
			stop();
		}
	});
});
