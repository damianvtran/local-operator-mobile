import { describe, expect, it } from "vitest";
import { computerDisplayName } from "../discovery";

describe("computerDisplayName (TestFlight 883, D4)", () => {
	it("cuts Ola's EC2 internal DNS name to the label that names the machine", () => {
		expect(
			computerDisplayName("ip-192-168-0-70.ca-central-1.compute.internal"),
		).toBe("ip-192-168-0-70");
	});

	it("cuts any dotted host name to its first label", () => {
		expect(computerDisplayName("damians-mbp.local")).toBe("damians-mbp");
		expect(computerDisplayName("abc123-lop.radienthq.com")).toBe("abc123-lop");
	});

	it.each([
		"Mac mini",
		"damians-mbp",
		"Damian's MacBook Pro",
		"build box v2.1",
		"",
		".hidden",
		"trailing.",
		"127.0.0.1:4098",
		"10.0.0.5",
		"host.example.com:8443",
	])("leaves %j unchanged: not a bare dotted DNS name", (name) => {
		expect(computerDisplayName(name)).toBe(name);
	});
});
