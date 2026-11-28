import { Text, type TextProps } from "react-native";

import { useComposedDir } from "@/ui/direction";

/**
 * `Text` that states the page's base direction, for every Radient Guard line.
 *
 * WHY. Guard's keyed copy is composed: most Urdu lines open with an organisation
 * name, the product word `Guard`/`Radient`, or a `{placeholder}` that resolves to
 * a Latin name (`Guard کے اعداد و شمار {org} کے ساتھ شیئر کریں؟`). The browser's
 * `dir="auto"` — which react-native-web puts on every `Text` — takes the base
 * direction from the FIRST strong character, so those lines compute
 * `direction: ltr` inside the RTL sheet and the Urdu and Latin runs visibly
 * swap places (i18n auditor 1, PR #402). The catalogue is byte-pinned (receipts
 * bind its hashes, and docs/i18n.md forbids bidi controls in values), so the fix
 * belongs in the rendering layer: `useComposedDir()` is the repo's mechanism
 * (`dir="rtl"` on web, `writingDirection: "rtl"` on native; NOTHING in an LTR
 * catalogue, so English and the other LTR locales are byte-identical).
 *
 * CONSTRAINT. The value rides the element's own `style` on native, so a caller
 * must not pass `style` here (it would clobber the direction); the `TextProps`
 * type omits it to make that a compile error rather than a silent bug.
 */
export const GuardText = (props: Omit<TextProps, "style">) => {
	const composedDir = useComposedDir();
	return <Text {...composedDir} {...props} />;
};
