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
 * Manages the vault-wide cache of existing `🆔` IDs.
 *
 * Tracks IDs per file so that when a file is modified, stale IDs from
 * its previous content are removed before new ones are added.
 *
 * Delegates to {@link IdEngine.collectAllIds} for scanning.
 */
export class IdCache {
	private readonly idEngine: IdEngine;
	private readonly fileIds: Map<string, Set<string>> = new Map();

	constructor(idEngine: IdEngine) {
		this.idEngine = idEngine;
	}

	/**
	 * Rebuilds the cache from scratch using an array of file entries.
	 * Clears any previously cached IDs.
	 */
	buildFromFiles(files: FileEntry[]): void {
		this.fileIds.clear();
		for (const file of files) {
			this.fileIds.set(file.path, this.idEngine.collectAllIds(file.content));
		}
	}

	/**
	 * Replaces the cached IDs for a single file.
	 *
	 * Removes all IDs previously associated with the file, then adds
	 * any IDs found in the new content. IDs from other files are
	 * unaffected.
	 */
	updateForFile(filePath: string, content: string): void {
		this.fileIds.set(filePath, this.idEngine.collectAllIds(content));
	}

	/** Returns a set containing the union of all per-file IDs. */
	getIds(): Set<string> {
		const ids = new Set<string>();
		for (const fileSet of this.fileIds.values()) {
			for (const id of fileSet) {
				ids.add(id);
			}
		}
		return ids;
	}

	/**
	 * Returns a set containing the union of all per-file IDs,
	 * excluding IDs from the specified file path.
	 *
	 * Useful during editing to get vault IDs that come from
	 * other files (the current file's IDs may be stale).
	 */
	getIdsExcluding(filePath: string): Set<string> {
		const ids = new Set<string>();
		for (const [path, fileSet] of this.fileIds) {
			if (path === filePath) {
				continue;
			}
			for (const id of fileSet) {
				ids.add(id);
			}
		}
		return ids;
	}
}

/**
 * Manages the vault-wide cache of dependency references (`⛔` IDs).
 *
 * Tracks deps per file so that when a file is modified, stale dep
 * references from its previous content are removed before new ones
 * are added.
 *
 * Delegates to {@link IdEngine.collectAllDepIds} for scanning.
 */
export class DepCache {
	private readonly idEngine: IdEngine;
	private readonly fileDeps: Map<string, Set<string>> = new Map();

	constructor(idEngine: IdEngine) {
		this.idEngine = idEngine;
	}

	/**
	 * Rebuilds the cache from scratch using an array of file entries.
	 * Clears any previously cached dep references.
	 */
	buildFromFiles(files: FileEntry[]): void {
		this.fileDeps.clear();
		for (const file of files) {
			this.fileDeps.set(
				file.path,
				this.idEngine.collectAllDepIds(file.content),
			);
		}
	}

	/**
	 * Replaces the cached dep references for a single file.
	 *
	 * Removes all deps previously associated with the file, then adds
	 * any deps found in the new content. Deps from other files are
	 * unaffected.
	 */
	updateForFile(filePath: string, content: string): void {
		this.fileDeps.set(
			filePath,
			this.idEngine.collectAllDepIds(content),
		);
	}

	/** Returns a set containing the union of all per-file deps. */
	getDeps(): Set<string> {
		const deps = new Set<string>();
		for (const fileSet of this.fileDeps.values()) {
			for (const dep of fileSet) {
				deps.add(dep);
			}
		}
		return deps;
	}
}
