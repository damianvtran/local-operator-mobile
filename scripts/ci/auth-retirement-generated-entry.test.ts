import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("the generated entry resolves its actual controller through Expo's Metro resolver", () => {
	const root = resolve(import.meta.dirname, "../..");
	const source = readFileSync(
		join(root, "scripts/ci/auth-retirement-ios-proof.ts"),
		"utf8",
	);
	// Inspect the generated import itself, not a second hard-coded entry string.
	const matches = [
		...source.matchAll(
			/import \{ installAuthRetirementProof \} from '([^']+)'/g,
		),
	];
	expect(matches).toHaveLength(1);
	const specifier = matches[0]?.[1];
	expect(specifier).toBe("./src/testing/auth-retirement-proof.ts");
	const require = createRequire(import.meta.url);
	const expo = require.resolve("expo/metro-config");
	const expoRequire = createRequire(expo);
	const config = expoRequire.resolve("@expo/metro-config");
	const metro = createRequire(config)("metro-resolver") as {
		resolve: (
			context: unknown,
			specifier: string,
			platform: string,
		) => { type: string; filePath: string };
	};
	const resolution = metro.resolve(
		{
			originModulePath: join(root, "auth-retirement-proof.entry.js"),
			getPackageForModule: () => null,
			mainFields: ["react-native", "browser", "main"],
			sourceExts: ["js", "jsx", "json", "ts", "tsx"],
			assetExts: new Set<string>(),
			preferNativePlatform: true,
			fileSystemLookup: (path: string) => {
				try {
					const stat = statSync(path);
					return {
						exists: true,
						type: stat.isDirectory() ? "d" : "f",
						realPath: realpathSync(path),
					};
				} catch (error) {
					if (
						(error as NodeJS.ErrnoException).code === "ENOENT" ||
						(error as NodeJS.ErrnoException).code === "ENOTDIR"
					)
						return { exists: false };
					throw error;
				}
			},
		},
		specifier!,
		"ios",
	);
	expect(resolution).toEqual({
		type: "sourceFile",
		filePath: realpathSync(join(root, "src/testing/auth-retirement-proof.ts")),
	});
});
