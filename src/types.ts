/**
 * Shared interfaces used across multiple modules.
 *
 * These define abstraction boundaries that are not owned by any single
 * consumer, so they live in their own module to avoid circular imports
 * and misplaced ownership.
 */

/**
 * Minimal subset of Obsidian's Editor API used by this plugin.
 * Keeps handlers and processors testable without a real Obsidian instance.
 */
export interface EditorLike {
	lineCount(): number;
	getLine(n: number): string;
	setLine(n: number, text: string): void;
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
