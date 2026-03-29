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
 * Each instance is stateless — call {@link collectAllIds} to gather
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

/**
 * Manages the vault-wide cache of existing `🆔` IDs.
 *
 * Delegates to {@link IdEngine.collectAllIds} for scanning and exposes
 * the mutable set for use by {@link IndentationHandler}.
 */
export class IdCache {
	private readonly idEngine: IdEngine;
	private ids: Set<string> = new Set();

	constructor(idEngine: IdEngine) {
		this.idEngine = idEngine;
	}

	/**
	 * Rebuilds the cache from scratch using an array of file contents.
	 * Clears any previously cached IDs.
	 */
	buildFromContents(contents: string[]): void {
		this.ids.clear();
		for (const content of contents) {
			for (const id of this.idEngine.collectAllIds(content)) {
				this.ids.add(id);
			}
		}
	}

	/** Adds any new IDs found in a single file's content to the cache. */
	updateFromContent(content: string): void {
		for (const id of this.idEngine.collectAllIds(content)) {
			this.ids.add(id);
		}
	}

	/** Returns the mutable set of cached IDs. */
	getIds(): Set<string> {
		return this.ids;
	}
}

/**
 * Manages the vault-wide cache of dependency references (`⛔` IDs).
 *
 * Delegates to {@link IdEngine.collectAllDepIds} for scanning and exposes
 * the mutable set so orphan cleanup can check cross-file references.
 */
export class DepCache {
	private readonly idEngine: IdEngine;
	private deps: Set<string> = new Set();

	constructor(idEngine: IdEngine) {
		this.idEngine = idEngine;
	}

	/**
	 * Rebuilds the cache from scratch using an array of file contents.
	 * Clears any previously cached dep references.
	 */
	buildFromContents(contents: string[]): void {
		this.deps.clear();
		for (const content of contents) {
			for (const id of this.idEngine.collectAllDepIds(content)) {
				this.deps.add(id);
			}
		}
	}

	/** Adds any new dep references found in a single file's content to the cache. */
	updateFromContent(content: string): void {
		for (const id of this.idEngine.collectAllDepIds(content)) {
			this.deps.add(id);
		}
	}

	/** Returns the mutable set of cached dep references. */
	getDeps(): Set<string> {
		return this.deps;
	}
}
