/**
 * Vault-wide per-file caches of the marker IDs found in each file.
 */

import { MarkerScanner } from '../parsing/marker-scanner';
import type { FileEntry } from '../types';

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
	protected readonly scanner: MarkerScanner;
	private readonly fileEntries: Map<string, Set<string>> = new Map();

	constructor(scanner: MarkerScanner) {
		this.scanner = scanner;
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

	/**
	 * Drops all cached entries associated with the given path.
	 *
	 * Removes the entry for the exact path, plus any entry whose key
	 * starts with `path + '/'`. The prefix rule covers folder deletion
	 * and rename, where the path identifies a directory rather than a
	 * single file; every file nested under that directory must also be
	 * forgotten. A sibling path that merely shares a string prefix
	 * without the separator, for example 'notes-archive.md' relative to
	 * 'notes', is left untouched.
	 */
	pruneFile(path: string): void {
		this.fileEntries.delete(path);
		const prefix = `${path}/`;
		for (const key of this.fileEntries.keys()) {
			if (key.startsWith(prefix)) {
				this.fileEntries.delete(key);
			}
		}
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
 * Extends {@link MarkerCache} with {@link MarkerScanner.collectAllIds}
 * as the extraction strategy.
 */
export class IdCache extends MarkerCache {
	protected extract(content: string): Set<string> {
		return this.scanner.collectAllIds(content);
	}
}

/**
 * Vault-wide cache of dependency references (`⛔` IDs).
 *
 * Extends {@link MarkerCache} with {@link MarkerScanner.collectAllDepIds}
 * as the extraction strategy.
 */
export class DepCache extends MarkerCache {
	protected extract(content: string): Set<string> {
		return this.scanner.collectAllDepIds(content);
	}
}
