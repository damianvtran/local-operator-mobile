/**
 * A `.css` import is a real module to Metro (uniwind's transformer processes it),
 * and TypeScript needs to be told that. The declaration is here rather than in
 * `tsconfig.json`'s `types` because it guards exactly one import — the styling
 * layer's entry in the root layout.
 */
declare module "*.css";

/*
 * `react-dom/server` ships no types and `@types/react-dom` is not a dependency:
 * the app never imports it, and one test renders through it to read the DOM the
 * web target produces (src/ui/components/semantics.test.ts). The single function
 * that test uses is declared here rather than adding a package for it.
 */
declare module "react-dom/server" {
	export function renderToStaticMarkup(element: unknown): string;
}
