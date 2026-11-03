import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const AAPT_ELEMENT = /^(\s*)E:\s+([\w-]+)/;
const AAPT_ATTRIBUTE = /^\s*A:\s+([\w:]+)(?:\([^)]*\))?\s*=\s*(.*)/;
const QUOTED_VALUE = /"([^"\n]*)"/;
const XML_RESOURCE = /resource\s+(0x[a-f0-9]+)\s+(?:[\w.]+:)?xml\/([\w_]+)/i;
const RESOURCE_BOUNDARY = /\bresource\s+0x/i;
const REFERENCE_PREFIX = /^@/;
const SOURCE_SHA = /^[a-f0-9]{40}$/;

type XmlNode = {
	name: string;
	indent: number;
	attributes: Record<string, string>;
	parent?: XmlNode;
};
/** Parse AAPT2's actual decoded XML tree, not a plugin-source guess. Unknown or
 * ambiguous output refuses evidence rather than treating a missing rule as safe. */
export function parseAaptXmlTree(text: string): XmlNode[] {
	const nodes: XmlNode[] = [];
	const stack: XmlNode[] = [];
	for (const line of text.split("\n")) {
		const element = AAPT_ELEMENT.exec(line);
		if (element) {
			const indent = element[1]?.length ?? 0;
			while (stack.length && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
			const node: XmlNode = {
				name: element[2] ?? "",
				indent,
				attributes: {},
				...(stack.at(-1) ? { parent: stack.at(-1) } : {}),
			};
			nodes.push(node);
			stack.push(node);
			continue;
		}
		const attribute = AAPT_ATTRIBUTE.exec(line);
		if (attribute && stack.length) {
			const name = attribute[1] ?? "";
			const raw = attribute[2] ?? "";
			const value = QUOTED_VALUE.exec(raw)?.[1] ?? raw.trim();
			const node = stack.at(-1);
			if (!node || name in node.attributes)
				throw new Error("ambiguous packaged XML attribute");
			node.attributes[name] = value;
		}
	}
	if (!nodes.length) throw new Error("packaged XML tree was not decoded");
	return nodes;
}
function resourceNames(
	resources: string,
): Map<string, { name: string; files: string[] }> {
	const result = new Map<string, { name: string; files: string[] }>();
	let current: { name: string; files: string[] } | null = null;
	for (const line of resources.split("\n")) {
		const resource = XML_RESOURCE.exec(line);
		if (resource) {
			current = { name: resource[2] ?? "", files: [] };
			result.set((resource[1] ?? "").toLowerCase(), current);
		} else if (RESOURCE_BOUNDARY.test(line)) current = null;
		if (current)
			for (const match of line.matchAll(/\b(res\/[^\s"']+\.xml)\b/g))
				if (!current.files.includes(match[1] ?? ""))
					current.files.push(match[1] ?? "");
	}
	return result;
}
function verifyScope(nodes: XmlNode[], parent: XmlNode): void {
	const children = nodes.filter((node) => node.parent === parent);
	const includes = children.filter((node) => node.name === "include");
	if (
		!includes.length ||
		includes.some(
			(node) =>
				node.attributes.domain !== "sharedpref" || node.attributes.path !== ".",
		)
	)
		throw new Error(
			"backup policy does not exclude native file/vault/sentinel domains by allowlist",
		);
	if (
		!children.some(
			(node) =>
				node.name === "exclude" &&
				node.attributes.domain === "sharedpref" &&
				node.attributes.path === "SecureStore",
		)
	)
		throw new Error(
			"packaged backup policy does not exclude SecureStore key material",
		);
}
export function verifyAndroidBackupDumps(input: {
	manifest: string;
	resources: string;
	xml: (path: string) => string;
	generatedManifest?: string;
}) {
	const applications = parseAaptXmlTree(input.manifest).filter(
		(node) => node.name === "application",
	);
	if (applications.length !== 1)
		throw new Error("packaged manifest has no unique application");
	const application = applications[0];
	if (!application) throw new Error("missing application");
	const resources = resourceNames(input.resources);
	const selected: Record<string, string> = {};
	for (const [attribute, root] of [
		["fullBackupContent", "full-backup-content"],
		["dataExtractionRules", "data-extraction-rules"],
	] as const) {
		const reference = application.attributes[`android:${attribute}`];
		if (!reference) throw new Error(`packaged manifest missing ${attribute}`);
		const resource = resources.get(
			reference.replace(REFERENCE_PREFIX, "").toLowerCase(),
		);
		if (resource?.files.length !== 1)
			throw new Error(`packaged ${attribute} resource is absent or ambiguous`);
		const path = resource.files[0];
		if (!path) throw new Error("missing resource path");
		selected[attribute] = resource.name;
		if (input.generatedManifest) {
			const uncommented = input.generatedManifest.replace(
				/<!--[\s\S]*?-->/g,
				"",
			);
			const attributes = [
				...uncommented.matchAll(
					new RegExp(`android:${attribute}\\s*=\\s*["']([^"']+)["']`, "g"),
				),
			];
			if (
				attributes.length !== 1 ||
				attributes[0]?.[1] !== `@xml/${resource.name}`
			)
				throw new Error(
					`generated and packaged ${attribute} select different rules`,
				);
		}
		const nodes = parseAaptXmlTree(input.xml(path));
		const roots = nodes.filter((node) => node.name === root && !node.parent);
		if (roots.length !== 1 || !roots[0])
			throw new Error(`packaged backup XML root is invalid: ${root}`);
		if (attribute === "fullBackupContent") verifyScope(nodes, roots[0]);
		else
			for (const name of ["cloud-backup", "device-transfer"]) {
				const scopes = nodes.filter(
					(node) => node.name === name && node.parent === roots[0],
				);
				if (scopes.length !== 1 || !scopes[0])
					throw new Error(`packaged ${name} policy missing or ambiguous`);
				verifyScope(nodes, scopes[0]);
			}
	}
	return {
		selected,
		secureStoreExcluded: true,
		vaultFileDomainExcluded: true,
		sentinelCacheNotIncluded: true,
	};
}
export function inspectStageBBackupArtifact(options: {
	apk: string;
	aapt2: string;
	generatedManifest?: string;
	sourceSha: string;
	variant: "debug" | "release";
}) {
	if (!SOURCE_SHA.test(options.sourceSha))
		throw new Error("backup artifact requires an exact source SHA");
	const dump = (kind: string, path?: string) =>
		execFileSync(
			options.aapt2,
			["dump", kind, options.apk, ...(path ? ["--file", path] : [])],
			{ encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
		);
	const result = verifyAndroidBackupDumps({
		manifest: dump("xmltree", "AndroidManifest.xml"),
		resources: dump("resources"),
		xml: (path) => dump("xmltree", path),
		...(options.generatedManifest
			? { generatedManifest: readFileSync(options.generatedManifest, "utf8") }
			: {}),
	});
	return {
		...result,
		sourceSha: options.sourceSha,
		variant: options.variant,
		artifactDigest: createHash("sha256")
			.update(readFileSync(options.apk))
			.digest("hex"),
		generatedManifestChecked: options.generatedManifest !== undefined,
		releaseVariantVerified: options.variant === "release",
	};
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const arg = (name: string) => {
		const index = process.argv.indexOf(`--${name}`);
		return index > 0 ? process.argv[index + 1] : undefined;
	};
	const apk = arg("apk");
	const aapt2 = arg("aapt2");
	const sourceSha = arg("source");
	const output = arg("output");
	const variant = arg("variant");
	if (
		!apk ||
		!aapt2 ||
		!sourceSha ||
		!output ||
		!["debug", "release"].includes(variant ?? "")
	)
		throw new Error(
			"required: --apk --aapt2 --source --variant debug|release --output [--generated-manifest]",
		);
	const result = inspectStageBBackupArtifact({
		apk,
		aapt2,
		sourceSha,
		variant: variant as "debug" | "release",
		...(process.argv.includes("--generated-manifest")
			? { generatedManifest: arg("generated-manifest") }
			: {}),
	});
	writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
	console.log(
		`PASS packaged ${variant} backup exclusions; release variant verified=${result.releaseVariantVerified}`,
	);
}
