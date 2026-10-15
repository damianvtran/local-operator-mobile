/* Diagnostic metadata only. Resolve package locations without requiring SDK or
 * application modules: loading them could execute config/entry side effects.
 * The separate, explicitly approved resolveAppEntry invocation is owned by the
 * Python collector. Nothing here bundles, compiles, installs, or reads .env. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");

const root = fs.realpathSync(process.argv[2]);
const project = createRequire(path.join(root, "package.json"));
let bytes = 0;
function boundedFile(file, cap) {
	const real = fs.realpathSync(file);
	const relative = path.relative(root, real).split(path.sep).join("/");
	if (path.basename(real).startsWith(".env") || /\.(pem|p8|p12|key|keystore)$/.test(real)) throw new Error("SDK_PATH_REFUSED");
	if (!relative.startsWith("node_modules/") || !/^[A-Za-z0-9_./@+%=~-]+$/.test(relative) || relative.split("/").includes("..")) throw new Error("SDK_PATH_REFUSED");
	const size = fs.statSync(real).size;
	if (size > cap || bytes + size > 1048576) throw new Error("SDK_BYTES_EXCEEDED");
	bytes += size;
	return { real, relative, raw: fs.readFileSync(real) };
}
let current = "expo";
try {
	const packages = [];
	function locate(name, expected, resolver) {
		current = name;
		let metadata;
		try {
			metadata = resolver.resolve(`${name}/package.json`);
		} catch {
			// Some SDKs export their entry but not package.json. Walk only the
			// resolved entry's six known ancestors, never scan a dependency tree
			// and never require/evaluate that entry to discover metadata.
			let directory = path.dirname(resolver.resolve(name));
			for (let depth = 0; depth < 6; depth += 1) {
				const candidate = path.join(directory, "package.json");
				if (fs.existsSync(candidate)) {
					const inspected = boundedFile(candidate, 65536);
					if (JSON.parse(inspected.raw.toString("utf8")).name === name) {
						metadata = candidate;
						break;
					}
				}
				directory = path.dirname(directory);
			}
		}
		if (!metadata || path.basename(fs.realpathSync(metadata)) !== "package.json") throw new Error("SDK_PATH_REFUSED");
		const file = boundedFile(metadata, 65536);
		const data = JSON.parse(file.raw.toString("utf8"));
		if (data.name !== name || data.version !== expected) throw new Error("SDK_VERSION_MISMATCH");
		packages.push({ name, version: data.version, path: file.relative, sha256: crypto.createHash("sha256").update(file.raw).digest("hex") });
		return path.dirname(file.real);
	}
	const expo = locate("expo", "57.0.26", project);
	const expoRequire = createRequire(path.join(expo, "package.json"));
	const cli = locate("@expo/cli", "57.0.27", expoRequire);
	const metro = locate("@expo/metro-config", "57.0.12", expoRequire);
	locate("@expo/config-plugins", "57.0.9", expoRequire);
	const rn = locate("react-native", "0.86.3", project);
	const rnRequire = createRequire(path.join(rn, "package.json"));
	locate("@react-native/community-cli-plugin", "0.86.3", rnRequire);
	locate("hermes-compiler", "250829098.0.17", rnRequire);
	locate("metro-source-map", "0.84.5", rnRequire);
	locate("@expo/metro", "56.0.2", createRequire(path.join(metro, "package.json")));
	const sources = [];
	for (const [role, directory, suffix] of [
		["resolve-entry", expo, "scripts/resolveAppEntry.js"],
		["rn-bundle-phase", rn, "scripts/react-native-xcode.sh"],
		["rn-compose-map", rn, "scripts/compose-source-maps.js"],
		["expo-embed", cli, "build/src/export/embed/exportEmbedAsync.js"],
		["expo-serializer", metro, "build/serializer/withExpoSerializers.js"],
		["expo-map", metro, "build/serializer/sourceMap.js"],
	]) {
		const file = boundedFile(path.join(directory, suffix), 262144);
		sources.push({ role, path: file.relative, bytes: file.raw.length, sha256: crypto.createHash("sha256").update(file.raw).digest("hex") });
	}
	process.stdout.write(JSON.stringify({ schema: 1, kind: "installed-sdk-metadata-only", packages, sources }));
} catch (error) {
	const allowed = ["SDK_PATH_REFUSED", "SDK_BYTES_EXCEEDED", "SDK_VERSION_MISMATCH"];
	process.stdout.write(JSON.stringify({ schema: 1, code: allowed.includes(error.message) ? error.message : "SDK_RESOLUTION_FAILED", package: current }));
	process.exitCode = 1;
}
