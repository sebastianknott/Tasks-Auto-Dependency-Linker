/**
 * Mock of the '@codemirror/view' module for testing.
 *
 * The real package drives an in-DOM CodeMirror 6 editor view and is not
 * safe to import under vitest's `node` test environment. This mock exists
 * only to give `CursorLineWatcher.extension()` something runtime-callable
 * to invoke: `EditorView.updateListener.of(fn)` here simply captures `fn`
 * on the returned object so a test can retrieve and invoke it directly.
 *
 * Type-only imports (`import type { ViewUpdate } from '@codemirror/view'`)
 * are erased at compile time and never load this file, so they still
 * resolve against the real package typings during `tsc` and Stryker's
 * TypeScript checker.
 */

/** Captured listener wrapper returned by `updateListener.of(...)`. */
export interface CapturedUpdateListener {
	fn: (update: unknown) => void;
}

class UpdateListenerFacetStub {
	of(fn: (update: unknown) => void): CapturedUpdateListener {
		return { fn };
	}
}

export class EditorView {
	static readonly updateListener = new UpdateListenerFacetStub();
}
