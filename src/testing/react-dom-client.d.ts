/**
 * `@types/react-dom` is not a dependency of this repository. The hook test
 * (`src/ui/components/modal-stack-entry.test.ts`) is the only thing that renders with
 * `react-dom`'s client, and this declares the two members it uses rather than adding a
 * dependency for them. If that test ever needs a third member, extend this file.
 */
declare module "react-dom/client" {
	export function createRoot(container: Element | DocumentFragment): {
		render(node: unknown): void;
		unmount(): void;
	};
}
