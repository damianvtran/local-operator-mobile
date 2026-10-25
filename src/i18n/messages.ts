/**
 * The ICU message subset this client renders, and the ONE parser that defines it.
 *
 * WHY A SUBSET RATHER THAN A LIBRARY. The app carries no message-formatting
 * dependency and this slice is not allowed to add one (`package.json` has no
 * `intl-messageformat`, and dependencies are not free on a phone bundle or in a
 * programme that must audit every byte it ships). So the grammar that the
 * catalogues actually use is implemented here, once, and the same parser is what
 * the key generator reads when it derives a message's parameter list — a
 * message that does not parse fails generation, so an invalid catalogue cannot
 * be committed.
 *
 * SUPPORTED — the whole surface of the four `mobile.*` namespaces:
 *
 * - plain placeholders: `{name}`
 * - `{count, plural, one {…} other {…}}`, with `#` for the formatted number and
 *   explicit `=N` branches; any CLDR category key is accepted (a locale whose
 *   rules produce `few`/`many` may add those branches without a code change)
 * - `{kind, select, wakes {…} other {…}}`
 * - nesting: a `select` inside a `plural` (and vice versa) renders recursively;
 *   `#` always means the innermost enclosing plural's count, as ICU specifies
 * - `''`-free apostrophes: `'` is always a literal character here
 *
 * NOT SUPPORTED — stated so nobody assumes otherwise:
 *
 * - argument formats other than `plural` and `select`: no `number`, `date`,
 *   `time`, `duration`, `list`, `spellout` or `selectordinal`
 * - `offset:` in a plural
 * - ICU apostrophe quoting (`''` and `'{literal}'`); `{` and `}` always delimit
 * - locale number formatting: `#` and plain numeric arguments render through
 *   `String(n)`, so there are no grouping separators, no localized digits and no
 *   decimal-separator choice. A locale that needs those needs this renderer
 *   extended (or a real formatter) — it does not silently get them.
 * - message selection by platform, gender or any variable that is not an
 *   explicit argument
 *
 * FAILURE MODES. A malformed message throws `RangeError` at parse time. A
 * missing or non-numeric argument throws `RangeError` at render time: both are
 * programming errors behind a typed key surface, and neither can leak `undefined`
 * or an empty string into a screen — the caller gets an exception in development
 * rather than a silent blank in production.
 *
 * Plural categories come from `Intl.PluralRules` when the runtime has it (Hermes
 * and Node both do), with an English one/other table as the fallback. The
 * FALLBACK matters beyond hygiene: an English source message must be formatted
 * with English plural rules even when the reader's preference is another locale,
 * because "Russian rules applied to English fallback would turn 21 into '21 job'"
 * (the programme's own note). `runtime.ts` passes the SOURCE locale here, not the
 * preference, for exactly that reason.
 */

/** How one placeholder is used, as the generator needs it to type the key. */
export type MessageArgumentKind = "text" | "plural" | "select";

export type MessageArguments = Readonly<Record<string, string | number>>;

type MessageNode =
	| { readonly type: "text"; readonly value: string }
	| { readonly type: "argument"; readonly name: string }
	| { readonly type: "number" }
	| {
			readonly type: "plural";
			readonly name: string;
			readonly options: ReadonlyMap<string, readonly MessageNode[]>;
	  }
	| {
			readonly type: "select";
			readonly name: string;
			readonly options: ReadonlyMap<string, readonly MessageNode[]>;
	  };

export interface ParsedMessage {
	/** The source text, so an error can quote the message that failed. */
	readonly source: string;
	/** Every placeholder the message uses, with how it is used. */
	readonly params: ReadonlyMap<string, MessageArgumentKind>;
	readonly nodes: readonly MessageNode[];
}

const IDENTIFIER = /[A-Za-z][A-Za-z0-9_]*/y;
const INTEGER = /-?\d+/y;
/** Non-global, so `.test()` never mutates `lastIndex` — hoisted for the same
 *  reason the kit's own modules hoist their regexes. */
const WHITESPACE = /\s/;

/** Parsed messages, keyed by source text. Catalogues are static strings, so the
 *  cache is bounded by the catalogue's size and every screen render after the
 *  first is a map lookup. */
const PARSED = new Map<string, ParsedMessage>();

/** The English plural table, used when `Intl.PluralRules` is unavailable. */
function englishPluralCategory(count: number): string {
	return Number.isInteger(count) && count === 1 ? "one" : "other";
}

const PLURAL_RULES = new Map<string, Intl.PluralRules | null>();

function pluralRulesFor(locale: string): Intl.PluralRules | null {
	const cached = PLURAL_RULES.get(locale);
	if (cached !== undefined) return cached;
	let rules: Intl.PluralRules | null = null;
	if (typeof Intl !== "undefined" && typeof Intl.PluralRules === "function") {
		try {
			rules = new Intl.PluralRules(locale);
		} catch {
			/* An unparseable tag is not a reason to fail a render that has a
			 * perfectly good English fallback table; the caller's locale source
			 * normalizes tags before they arrive here. */
			rules = null;
		}
	}
	PLURAL_RULES.set(locale, rules);
	return rules;
}

/**
 * The CLDR plural category for `count` in `locale`.
 *
 * Exported because the direction resolver and the fallback rules are the two
 * locale-sensitive decisions in this slice, and both are worth asserting on
 * their own rather than only through a rendered sentence.
 */
export function pluralCategory(locale: string, count: number): string {
	const rules = pluralRulesFor(locale);
	if (rules !== null) return rules.select(count);
	return englishPluralCategory(count);
}

/** Parse (and cache) one message. Throws `RangeError` on a malformed message. */
export function parseMessage(source: string): ParsedMessage {
	const cached = PARSED.get(source);
	if (cached !== undefined) return cached;
	const parsed = parseUncached(source);
	PARSED.set(source, parsed);
	return parsed;
}

function parseUncached(source: string): ParsedMessage {
	let position = 0;
	const params = new Map<string, MessageArgumentKind>();

	/* A function DECLARATION, not a const arrow: TypeScript only narrows control
	 * flow after a call to a never-returning function it can see declared that way,
	 * and every `if (x === null) fail(...)` below depends on that narrowing. */
	function fail(reason: string): never {
		throw new RangeError(
			`Invalid message ${JSON.stringify(source)}: ${reason} (at offset ${position})`,
		);
	}

	const skipWhitespace = (): void => {
		while (
			position < source.length &&
			WHITESPACE.test(source.charAt(position))
		) {
			position += 1;
		}
	};

	const readIdentifier = (what: string): string => {
		IDENTIFIER.lastIndex = position;
		const match = IDENTIFIER.exec(source);
		if (match === null) fail(`expected ${what}`);
		position += match[0].length;
		return match[0];
	};

	const recordParam = (name: string, kind: MessageArgumentKind): void => {
		const seen = params.get(name);
		if (seen !== undefined && seen !== kind) {
			fail(
				`placeholder ${JSON.stringify(name)} is used as both ${seen} and ${kind}`,
			);
		}
		params.set(name, kind);
	};

	/**
	 * The branches of one plural/select.
	 *
	 * `inPlural` is threaded rather than re-derived: `#` is a number only while
	 * some enclosing plural is being rendered, so a select branch INSIDE a plural
	 * keeps `#` a number (ICU's rule), while a top-level select's `#` stays the
	 * literal character it looks like. Getting this wrong renders `#` silently.
	 */
	const parseOptions = (
		kind: "plural" | "select",
		inPlural: boolean,
	): ReadonlyMap<string, readonly MessageNode[]> => {
		const options = new Map<string, readonly MessageNode[]>();
		for (;;) {
			skipWhitespace();
			if (position >= source.length) fail(`unterminated ${kind}`);
			const next = source.charAt(position);
			if (next === "}") break;
			let key: string;
			if (next === "=") {
				position += 1;
				INTEGER.lastIndex = position;
				const numeric = INTEGER.exec(source);
				if (numeric === null) fail("expected a number after '='");
				position += numeric[0].length;
				key = `=${numeric[0]}`;
			} else {
				key = readIdentifier(`${kind} option name`);
			}
			skipWhitespace();
			if (source.charAt(position) !== "{") fail("expected '{'");
			position += 1;
			const body = parseSequence(inPlural || kind === "plural");
			if (source.charAt(position) !== "}") fail("expected '}'");
			position += 1;
			if (options.has(key))
				fail(`duplicate ${kind} option ${JSON.stringify(key)}`);
			options.set(key, body);
		}
		if (!options.has("other")) fail(`${kind} is missing its 'other' branch`);
		return options;
	};

	const parsePlaceholder = (inPlural: boolean): MessageNode => {
		position += 1; // "{"
		skipWhitespace();
		const name = readIdentifier("a placeholder name");
		skipWhitespace();
		const next = source.charAt(position);
		if (next === "}") {
			position += 1;
			recordParam(name, "text");
			return { type: "argument", name };
		}
		if (next !== ",") fail("expected ',' or '}'");
		position += 1;
		skipWhitespace();
		const kind = readIdentifier("an argument type");
		if (kind !== "plural" && kind !== "select") {
			fail(`unsupported argument type ${JSON.stringify(kind)}`);
		}
		skipWhitespace();
		if (source.charAt(position) !== ",") fail("expected ','");
		position += 1;
		const options = parseOptions(kind, inPlural);
		skipWhitespace();
		if (source.charAt(position) !== "}") fail("expected '}'");
		position += 1;
		recordParam(name, kind);
		return { type: kind, name, options };
	};

	const parseSequence = (inPlural: boolean): readonly MessageNode[] => {
		const nodes: MessageNode[] = [];
		let text = "";
		const flush = (): void => {
			if (text === "") return;
			nodes.push({ type: "text", value: text });
			text = "";
		};
		while (position < source.length) {
			const character = source.charAt(position);
			if (character === "}") break;
			if (character === "{") {
				flush();
				nodes.push(parsePlaceholder(inPlural));
				continue;
			}
			if (character === "#" && inPlural) {
				flush();
				nodes.push({ type: "number" });
				position += 1;
				continue;
			}
			text += character;
			position += 1;
		}
		flush();
		return nodes;
	};

	const nodes = parseSequence(false);
	if (position !== source.length) {
		fail("unexpected '}'");
	}
	return { source, params, nodes };
}

function argumentValue(
	name: string,
	args: MessageArguments,
	message: ParsedMessage,
): string | number {
	if (!Object.hasOwn(args, name)) {
		throw new RangeError(
			`Message ${JSON.stringify(message.source)} is missing the argument ${JSON.stringify(name)}`,
		);
	}
	const value = args[name];
	if (value === undefined) {
		throw new RangeError(
			`Message ${JSON.stringify(message.source)} received undefined for ${JSON.stringify(name)}`,
		);
	}
	return value;
}

function numericValue(
	name: string,
	args: MessageArguments,
	message: ParsedMessage,
): number {
	const value = argumentValue(name, args, message);
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) {
		throw new RangeError(
			`Message ${JSON.stringify(message.source)} needs a number for ${JSON.stringify(name)}, received ${JSON.stringify(value)}`,
		);
	}
	return numeric;
}

function formatNodes(
	nodes: readonly MessageNode[],
	args: MessageArguments,
	locale: string,
	count: number | null,
	message: ParsedMessage,
): string {
	let output = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
				output += node.value;
				break;
			case "argument":
				output += String(argumentValue(node.name, args, message));
				break;
			case "number":
				if (count === null) {
					throw new RangeError(
						`Message ${JSON.stringify(message.source)} uses '#' outside a plural`,
					);
				}
				output += String(count);
				break;
			case "plural": {
				const value = numericValue(node.name, args, message);
				const exact = Number.isInteger(value)
					? node.options.get(`=${value}`)
					: undefined;
				const branch =
					exact ??
					node.options.get(pluralCategory(locale, value)) ??
					node.options.get("other");
				if (branch === undefined) {
					throw new RangeError(
						`Message ${JSON.stringify(message.source)} has no plural branch for ${value}`,
					);
				}
				output += formatNodes(branch, args, locale, value, message);
				break;
			}
			case "select": {
				const value = String(argumentValue(node.name, args, message));
				const branch = node.options.get(value) ?? node.options.get("other");
				if (branch === undefined) {
					throw new RangeError(
						`Message ${JSON.stringify(message.source)} has no select branch for ${JSON.stringify(value)}`,
					);
				}
				output += formatNodes(branch, args, locale, count, message);
				break;
			}
		}
	}
	return output;
}

/**
 * Render one message.
 *
 * `locale` decides plural rules and nothing else — it is the locale the MESSAGE
 * comes from, which for an English fallback is English even when the reader's
 * preference is not. Formatting a fallback with the preference's rules is the
 * bug this parameter exists to prevent.
 */
export function formatMessage(
	message: ParsedMessage,
	args: MessageArguments,
	locale: string,
): string {
	return formatNodes(message.nodes, args, locale, null, message);
}
