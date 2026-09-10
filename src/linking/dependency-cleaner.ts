/**
 * Removal of `⛔` dependency markers that no longer describe a live
 * parent-child relationship.
 *
 * Pure string transforms over task lines, driven by {@link TaskParser}.
 * Separated from `task-linker.ts` because linking and cleaning share no
 * state and never run in the same pass.
 */

import type { TaskParser } from '../parsing/task-parser';

/**
 * Cleans obsolete `⛔` markers off task lines.
 *
 * Instantiate with a {@link TaskParser}, then call the methods below
 * from the cleanup pass. Every method is pure: it reads a line and
 * returns the corrected line without touching an editor.
 */
export class DependencyCleaner {
	private readonly parser: TaskParser;

	constructor(parser: TaskParser) {
		this.parser = parser;
	}

	/**
	 * Removes `⛔` markers from a task line that are not in the desired
	 * set of dependency IDs. Returns the updated line.
	 *
	 * When `managedIds` is provided, only deps whose ID is in that set
	 * are considered for removal. Deps referencing IDs outside the set
	 * (e.g. cross-list references) are left untouched.
	 */
	removeStaleDeps(
		line: string,
		desiredDeps: Set<string>,
		managedIds?: Set<string>,
	): string {
		let result = line;
		for (const dep of this.parser.getTaskDependencies(line)) {
			if (managedIds && !managedIds.has(dep)) {
				continue;
			}
			if (!desiredDeps.has(dep)) {
				result = this.parser.removeDependencyFromLine(result, dep);
			}
		}
		return result;
	}

	/**
	 * Returns true if the given ID is referenced as a `⛔` dependency
	 * on any line in the provided array.
	 */
	isIdReferencedAsDep(lines: string[], id: string): boolean {
		for (const line of lines) {
			if (this.parser.getTaskDependencies(line).includes(id)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Removes `⛔` markers that reference IDs with no corresponding `🆔`
	 * in the document. Returns the updated line.
	 *
	 * A `⛔` is considered dangling when the ID it references does not
	 * appear as a `🆔` marker anywhere in the provided `knownIds` set.
	 * This handles the case where a child task was deleted entirely.
	 *
	 * Uses the live document IDs (not the vault cache) as the source of
	 * truth, because the vault cache may be stale for the current file
	 * during an editing session.
	 */
	removeDanglingDeps(
		line: string,
		knownIds: Set<string>,
	): string {
		let result = line;
		for (const dep of this.parser.getTaskDependencies(line)) {
			if (!knownIds.has(dep)) {
				result = this.parser.removeDependencyFromLine(result, dep);
			}
		}
		return result;
	}
}
