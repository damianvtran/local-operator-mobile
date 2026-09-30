/**
 * A `.css` import is a real module to Metro (uniwind's transformer processes it),
 * and TypeScript needs to be told that. The declaration is here rather than in
 * `tsconfig.json`'s `types` because it guards exactly one import — the styling
 * layer's entry in the root layout.
 */
declare module "*.css";
