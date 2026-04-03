/**
 * Indentation-based dependency linking for the Tasks Auto-Dependency Linker.
 *
 * Detects parent-child relationships from indentation and automatically
 * adds `🆔` / `⛔` markers using {@link TaskParser} and {@link IdEngine}.
 */

import { TaskParser } from './task-parser';
import { IdEngine } from './id-engine';
import { RelationshipAnalyzer } from './relationship-analyzer';

/**
 * Minimal subset of Obsidian's Editor API used by this handler.
 * Keeps the handler testable without a real Obsidian instance.
 */
export interface EditorLike {
	lineCount(): number;
	getLine(n: number): string;
	setLine(n: number, text: string): void;
}

/**
 * Processes indentation changes and manages task dependency markers.
 *
 * Instantiate with a {@link TaskParser} and {@link IdEngine}, then call
 * {@link processLine} on each line that may have changed indentation.
 *
 * Collaborators are exposed as `readonly` so that callers (e.g.
 * {@link EditorProcessor}) can use them directly for read-only
 * operations instead of routing through thin wrapper methods.
 */
export class IndentationHandler {
	readonly parser: TaskParser;
	readonly relAnalyzer: RelationshipAnalyzer;
	private readonly idEngine: IdEngine;
	/** Snapshot of editor lines set once before each link pass. */
	private snapshot: string[] = new Array<string>();

	constructor(parser: TaskParser, idEngine: IdEngine) {
		this.parser = parser;
		this.idEngine = idEngine;
		this.relAnalyzer = new RelationshipAnalyzer(parser);
	}

	/**
	 * Reads all editor lines into the internal snapshot.
	 *
	 * Call once before the link-pass loop so that every subsequent
	 * {@link processLine} call can find parent tasks from the snapshot
	 * in O(1) per line rather than rebuilding the full array on each call.
	 */
	prepareForLinkPass(editor: EditorLike): void {
		const count = editor.lineCount();
		this.snapshot = [];
		for (let i = 0; i < count; i++) {
			this.snapshot.push(editor.getLine(i));
		}
	}

	/**
	 * Processes a single line: if it is an indented task with a parent,
	 * ensures the child has a `🆔` and the parent has a `⛔` for that ID.
	 */
	processLine(
		editor: EditorLike,
		lineIndex: number,
		existingIds: Set<string>,
	): void {
		const parentIndex = this.relAnalyzer.findParentTask(this.snapshot, lineIndex);
		if (parentIndex === null) {
			return;
		}

		let childLine = editor.getLine(lineIndex);
		let childId = this.parser.getTaskId(childLine);

		if (!childId) {
			childId = this.idEngine.generateUniqueId(existingIds);
			childLine = this.parser.addIdToLine(childLine, childId);
			editor.setLine(lineIndex, childLine);
			existingIds.add(childId);
		}

		const parentLine = editor.getLine(parentIndex);
		const updatedParentLine = this.parser.addDependencyToLine(
			parentLine,
			childId,
		);
		if (updatedParentLine !== parentLine) {
			editor.setLine(parentIndex, updatedParentLine);
		}
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
