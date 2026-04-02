/**
 * Vault-wide unique ID generation for the Tasks Auto-Dependency Linker plugin.
 *
 * Generates 6-character lowercase alphanumeric IDs and ensures vault-wide
 * uniqueness by checking against a set of existing IDs.
 */

import { TaskParser } from './task-parser';

/** Characters used for ID generation: a-z, 0-9. */
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates and manages unique 6-char alphanumeric IDs.
 *
 * Each instance is stateless. Call {@link collectAllIds} to gather
 * existing IDs from vault content, then {@link generateUniqueId} to
 * produce an ID guaranteed not to collide.
 */
export class IdEngine {
	/** Generates a random 6-character lowercase alphanumeric ID. */
	generateId(): string {
		let id = '';
		for (let i = 0; i < 6; i++) {
			id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]!;
		}
		return id;
	}

	/**
	 * Scans file content and returns all `🆔` IDs found.
	 *
	 * Uses the {@link TaskParser.ID_REGEX} to extract IDs line by line.
	 * Dependency IDs (`⛔`) are not included.
	 */
	collectAllIds(content: string): Set<string> {
		const ids = new Set<string>();
		for (const line of content.split('\n')) {
			const match = line.match(TaskParser.ID_REGEX);
			if (match) {
				ids.add(match[1]!);
			}
		}
		return ids;
	}

	/**
	 * Scans file content and returns all IDs referenced as `⛔` dependencies.
	 *
	 * Uses the {@link TaskParser.DEP_REGEX} to extract dependency IDs line by
	 * line. Comma-separated lists are split into individual IDs.
	 */
	collectAllDepIds(content: string): Set<string> {
		const ids = new Set<string>();
		for (const line of content.split('\n')) {
			const match = line.match(TaskParser.DEP_REGEX);
			if (match) {
				for (const id of match[1]!.split(',')) {
					ids.add(id.trim());
				}
			}
		}
		return ids;
	}

	/**
	 * Generates an ID guaranteed not to exist in the provided set.
	 *
	 * Retries if a collision occurs (astronomically unlikely with
	 * 2.18 billion combinations).
	 */
	generateUniqueId(existingIds: Set<string>): string {
		let id = this.generateId();
		while (existingIds.has(id)) {
			id = this.generateId();
		}
		return id;
	}
}

/** A vault file entry with its path and content. */
export interface FileEntry {
	readonly path: string;
	readonly content: string;
}

/**
 * Abstract base for per-file marker caches.
 *
 * Tracks a set of strings per file path. Subclasses define how to
 * extract those strings from file content via {@link extract}.
 *
 * Shared logic for building, updating, and querying the cache lives
 * here, eliminating duplication between IdCache and DepCache.
 */
export abstract class MarkerCache {
	protected readonly idEngine: IdEngine;
	private readonly fileEntries: Map<string, Set<string>> = new Map();

	constructor(idEngine: IdEngine) {
		this.idEngine = idEngine;
	}

	/**
	 * Extracts the relevant marker strings from file content.
	 *
	 * @param content - Raw file content to scan.
	 * @returns A set of extracted marker strings.
	 */
	protected abstract extract(content: string): Set<string>;

	/**
	 * Rebuilds the cache from scratch using an array of file entries.
	 * Clears any previously cached data.
	 */
	buildFromFiles(files: FileEntry[]): void {
		this.fileEntries.clear();
		for (const file of files) {
			this.fileEntries.set(file.path, this.extract(file.content));
		}
	}

	/**
	 * Replaces the cached entries for a single file.
	 *
	 * Removes all entries previously associated with the file, then
	 * adds any entries found in the new content. Other files are
	 * unaffected.
	 */
	updateForFile(filePath: string, content: string): void {
		this.fileEntries.set(filePath, this.extract(content));
	}

	/** Returns a set containing the union of all per-file entries. */
	getAll(): Set<string> {
		const all = new Set<string>();
		for (const fileSet of this.fileEntries.values()) {
			for (const entry of fileSet) {
				all.add(entry);
			}
		}
		return all;
	}

	/**
	 * Returns a set containing the union of all per-file entries,
	 * excluding entries from the specified file path.
	 *
	 * Useful during editing to get vault entries that come from
	 * other files (the current file's entries may be stale).
	 */
	getAllExcluding(filePath: string): Set<string> {
		const all = new Set<string>();
		for (const [path, fileSet] of this.fileEntries) {
			if (path === filePath) {
				continue;
			}
			for (const entry of fileSet) {
				all.add(entry);
			}
		}
		return all;
	}
}

/**
 * Vault-wide cache of existing `🆔` IDs.
 *
 * Extends {@link MarkerCache} with {@link IdEngine.collectAllIds} as
 * the extraction strategy. Convenience methods preserve the original
 * API so consumers are unaffected by the refactoring.
 */
export class IdCache extends MarkerCache {
	protected extract(content: string): Set<string> {
		return this.idEngine.collectAllIds(content);
	}
}

/**
 * Vault-wide cache of dependency references (`⛔` IDs).
 *
 * Extends {@link MarkerCache} with {@link IdEngine.collectAllDepIds}
 * as the extraction strategy. The convenience method preserves the
 * original API so consumers are unaffected by the refactoring.
 */
export class DepCache extends MarkerCache {
	protected extract(content: string): Set<string> {
		return this.idEngine.collectAllDepIds(content);
	}
}
