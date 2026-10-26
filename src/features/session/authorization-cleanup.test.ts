import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { clearAuthorizationData } from "./device-storage";

afterEach(() => {
	vi.unstubAllGlobals();
});
describe("explicit private-data retirement", () => {
	it("refuses success when enumeration is blocked", async () => {
		vi.stubGlobal("localStorage", {
			get length() {
				throw new Error("enumeration denied");
			},
		});
		await expect(clearAuthorizationData()).rejects.toThrow(
			"enumeration denied",
		);
	});
	it("refuses success when a private key cannot be deleted", async () => {
		vi.stubGlobal("localStorage", {
			length: 1,
			key: () => "lo-mobile-draft:legacy",
			removeItem: () => {
				throw new Error("deletion denied");
			},
		});
		await expect(clearAuthorizationData()).rejects.toThrow("deletion denied");
	});
	it("purges legacy and scoped private families only on the explicit cleanup call", async () => {
		const values = new Map([
			["lo-mobile-draft:legacy", "unknown owner"],
			["lo-mobile-command:same:authorization:a", "private"],
			["appearance", "light"],
		]);
		vi.stubGlobal("localStorage", {
			get length() {
				return values.size;
			},
			key: (n: number) => [...values.keys()][n] ?? null,
			removeItem: (key: string) => values.delete(key),
		});
		expect(values.get("lo-mobile-draft:legacy")).toBe("unknown owner");
		await clearAuthorizationData();
		expect([...values.keys()]).toEqual(["appearance"]);
	});
});
