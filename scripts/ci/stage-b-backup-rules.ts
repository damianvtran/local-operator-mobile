import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const AAPT_ELEMENT = /^(\s*)E:\s+([\w-]+)/;
// AOSP tools/aapt2/Debug.cpp prints namespace_uri + ":" + name, not an XML prefix.
const ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android:";
const AAPT_ATTRIBUTE = /^\s*A:\s+([^\s=()]+)(?:\(0x[0-9a-f]+\))?\s*=\s*(.*)$/i;
const ATTRIBUTE_LINE = /^\s*A:/;
const LOCAL_ATTRIBUTE = /^[a-z_][\w.-]*$/i;
const RAW_ANNOTATION = /\s+\(Raw:.*$/;
const QUOTED_VALUE = /"([^"\n]*)"/;
const XML_RESOURCE = /resource\s+(0x[a-f0-9]+)\s+((?:[\w.]+:)?xml\/([\w_]+))/i;
const RESOURCE_BOUNDARY = /\bresource\s+0x/i;
const REFERENCE_PREFIX = /^@/;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const BACKUP_RESOURCE_NAME = /backup|extraction/i;

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
		if (ATTRIBUTE_LINE.test(line) && (!attribute || !stack.length))
			throw new Error("unrecognized packaged XML attribute");
		if (attribute && stack.length) {
			const qualified = attribute[1] ?? "";
			const android = qualified.startsWith(ANDROID_NAMESPACE);
			const local = android
				? qualified.slice(ANDROID_NAMESPACE.length)
				: qualified;
			if (!LOCAL_ATTRIBUTE.test(local))
				throw new Error("unknown packaged XML attribute namespace");
			const name = android ? `android:${local}` : local;
			// Compiled references win over the optional (Raw: "@xml/...") annotation.
			const raw = (attribute[2] ?? "").replace(RAW_ANNOTATION, "");
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
			current = { name: resource[3] ?? "", files: [] };
			for (const alias of new Set([
				resource[1] ?? "",
				resource[2] ?? "",
				`xml/${current.name}`,
			])) {
				const key = alias.toLowerCase();
				if (result.has(key)) throw new Error("ambiguous packaged XML resource");
				result.set(key, current);
			}
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
	receiptDirectory: string;
}) {
	if (!SOURCE_SHA.test(options.sourceSha))
		throw new Error("backup artifact requires an exact source SHA");
	mkdirSync(options.receiptDirectory, { recursive: true });
	const dump = (kind: string, path?: string) =>
		execFileSync(
			options.aapt2,
			["dump", kind, options.apk, ...(path ? ["--file", path] : [])],
			{ encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
		);
	const retain = (name: string, value: string) =>
		writeFileSync(join(options.receiptDirectory, name), value, { flag: "wx" });
	// Save raw instrument output BEFORE interpretation. A failed verifier must
	// leave the same inspectable evidence as a passing one, not just a stack trace.
	const manifest = dump("xmltree", "AndroidManifest.xml");
	retain("manifest.xmltree.txt", manifest);
	const resources = dump("resources");
	retain("resources.txt", resources);
	const index = resourceNames(resources);
	const candidates = new Set<string>();
	for (const resource of new Set(index.values()))
		if (BACKUP_RESOURCE_NAME.test(resource.name))
			for (const path of resource.files) candidates.add(path);
	try {
		for (const node of parseAaptXmlTree(manifest))
			if (node.name === "application")
				for (const name of [
					"android:fullBackupContent",
					"android:dataExtractionRules",
				]) {
					const reference = node.attributes[name];
					if (reference)
						for (const path of index.get(
							reference.replace(REFERENCE_PREFIX, "").toLowerCase(),
						)?.files ?? [])
							candidates.add(path);
				}
	} catch {
		/* Preserve the known backup XML too when manifest parsing refuses. */
	}
	const xml = new Map<string, string>();
	const xmlIndex: Record<string, string> = {};
	const readXml = (path: string): string => {
		const previous = xml.get(path);
		if (previous !== undefined) return previous;
		const value = dump("xmltree", path);
		const name = `xml-${createHash("sha256").update(path).digest("hex")}.xmltree.txt`;
		retain(name, value);
		xml.set(path, value);
		xmlIndex[path] = name;
		return value;
	};
	// Prefetch both policies before validation can reject the first one.
	try {
		for (const path of candidates) readXml(path);
	} finally {
		retain("xml-index.json", `${JSON.stringify(xmlIndex, null, 2)}\n`);
	}
	const result = verifyAndroidBackupDumps({
		manifest,
		resources,
		xml: readXml,
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
	let result: ReturnType<typeof inspectStageBBackupArtifact>;
	try {
		result = inspectStageBBackupArtifact({
			apk,
			aapt2,
			sourceSha,
			variant: variant as "debug" | "release",
			receiptDirectory: dirname(output),
			...(process.argv.includes("--generated-manifest")
				? { generatedManifest: arg("generated-manifest") }
				: {}),
		});
	} catch (error) {
		mkdirSync(dirname(output), { recursive: true });
		writeFileSync(
			output,
			`${JSON.stringify({ sourceSha, variant, passed: false, error: error instanceof Error ? error.message : "backup verification failed" }, null, 2)}\n`,
			{ flag: "wx" },
		);
		throw error;
	}
	writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
	console.log(
		`PASS packaged ${variant} backup exclusions; release variant verified=${result.releaseVariantVerified}`,
	);
}
