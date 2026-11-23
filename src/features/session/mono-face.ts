/**
 * The mono face's NATIVE family name: the PostScript name of the bundled
 * `design/fonts/JetBrainsMono-Regular.ttf` (iOS matches it) and that file's
 * basename (the name `expo-font`'s config plugin registers on Android).
 *
 * WHY A STYLE AND NOT ONLY THE CLASS (operator report, iPhone build 773): the
 * theme's `--font-mono` is a CSS fallback LIST (`'JetBrains Mono', ui-monospace,
 * …`). The web resolves it; React Native has no fallback stacks and treats the
 * whole string as one family name, finds none, and silently paints the system
 * sans. Web keeps the class's stack (and its woff2), so this applies off-web only.
 *
 * A module of its own because two renderers need the same name: the markdown
 * code face (`components/markdown.tsx`) and the diagram's monospace labels
 * (`components/diagram-block.tsx`), and neither may import the other.
 */
export const NATIVE_MONO_FAMILY = "JetBrainsMono-Regular";
