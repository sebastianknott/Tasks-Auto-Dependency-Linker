/**
 * Extraction of `🆔` and `⛔` marker IDs from raw file content.
 */

import { TaskParser } from './task-parser';

/**
 * Scans file content for the marker IDs the plugin tracks.
 *
 * Stateless. Each method takes raw content and returns the set of IDs
 * it found, leaving storage and lifetime decisions to the caller.
 */
export class MarkerScanner {
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
}
