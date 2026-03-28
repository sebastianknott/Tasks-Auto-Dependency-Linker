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
