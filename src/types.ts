/**
 * Shared interfaces used across multiple modules.
 *
 * These define abstraction boundaries that are not owned by any single
 * consumer, so they live in their own module to avoid circular imports
 * and misplaced ownership.
 */

/**
 * A position in the editor: a zero-based line and character offset.
 * Mirrors Obsidian's `EditorPosition`.
 */
export interface EditorPositionLike {
	line: number;
	ch: number;
}

/**
 * The line-reading and line-writing surface of the editor. This is all
 * the link and cleanup passes need, so they accept this narrower type.
 */
export interface LineEditor {
	lineCount(): number;
	getLine(n: number): string;
	setLine(n: number, text: string): void;
}

/**
 * Minimal subset of Obsidian's Editor API used by this plugin.
 * Extends {@link LineEditor} with the selection methods needed to keep
 * the user's caret in place across edits. Keeps handlers and processors
 * testable without a real Obsidian instance.
 */
export interface EditorLike extends LineEditor {
	/**
	 * Returns the anchor or head of the current selection. With no
	 * argument, returns the primary cursor position.
	 */
	getCursor(which?: 'anchor' | 'head'): EditorPositionLike;
	/** Sets the selection from `anchor` to `head`. */
	setSelection(anchor: EditorPositionLike, head: EditorPositionLike): void;
}

/**
 * Read-only interface for querying a vault-wide marker cache.
 *
 * Decouples {@link EditorProcessor} from the concrete
 * {@link MarkerCache} subclasses so tests can supply simple stubs.
 */
export interface MarkerCacheLike {
	getAll(): Set<string>;
	getAllExcluding(filePath: string): Set<string>;
}
