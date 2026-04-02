/**
 * Indentation-based dependency linking for the Tasks Auto-Dependency Linker.
 *
 * Detects parent-child relationships from indentation and automatically
 * adds `🆔` / `⛔` markers using {@link TaskParser} and {@link IdEngine}.
 */

import { TaskParser } from './task-parser';
import { IdEngine } from './id-engine';

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
 */
export class IndentationHandler {
	private readonly parser: TaskParser;
	private readonly idEngine: IdEngine;
	/** Snapshot of editor lines set once before each link pass. */
	private snapshot: string[] = [];

	constructor(parser: TaskParser, idEngine: IdEngine) {
		this.parser = parser;
		this.idEngine = idEngine;
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
	 * Walks upward from `lineIndex` to find the nearest task line at a
	 * strictly lower indent level. Returns the line index, or `null`.
	 *
	 * Non-task lines are skipped. If the current line itself is not a
	 * task, returns `null`.
	 */
	findParentTask(lines: string[], lineIndex: number): number | null {
		const currentLine = lines[lineIndex];
		if (currentLine === undefined || !this.parser.isTaskLine(currentLine)) {
			return null;
		}

		const currentIndent = this.parser.getIndentLevel(currentLine);

		for (let i = lineIndex - 1; i >= 0; i--) {
			const line = lines[i]!;
			if (!this.parser.isListItem(line)) {
				return null;
			}
			if (!this.parser.isTaskLine(line)) {
				continue;
			}
			if (this.parser.getIndentLevel(line) < currentIndent) {
				return i;
			}
		}

		return null;
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
		const parentIndex = this.findParentTask(this.snapshot, lineIndex);
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
	 * Builds a map of desired parent-child relationships from current
	 * indentation. Returns a Map where key = child line index,
	 * value = parent line index.
	 */
	buildRelationshipMap(lines: string[]): Map<number, number> {
		const relationships = new Map<number, number>();
		for (let i = 0; i < lines.length; i++) {
			const parentIndex = this.findParentTask(lines, i);
			if (parentIndex !== null) {
				relationships.set(i, parentIndex);
			}
		}
		return relationships;
	}

	/**
	 * Collects the set of child IDs that should be `⛔`-referenced by
	 * a given parent, based on the relationship map.
	 */
	getDesiredDepsForParent(
		lines: string[],
		parentIndex: number,
		relationships: Map<number, number>,
	): Set<string> {
		const deps = new Set<string>();
		for (const [childIdx, pIdx] of relationships) {
			if (pIdx !== parentIndex) {
				continue;
			}
			const childId = this.parser.getTaskId(lines[childIdx]!);
			if (childId) {
				deps.add(childId);
			}
		}
		return deps;
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
		const currentDeps = this.parser.getTaskDependencies(line);
		let result = line;
		for (const dep of currentDeps) {
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
	 * Identifies contiguous list blocks in the document.
	 *
	 * A list block is a maximal contiguous sequence of list-item lines.
	 * Non-list-item lines (blank lines, headings, paragraphs, etc.)
	 * act as boundaries between blocks.
	 *
	 * Returns an array of `{start, end}` ranges where `start` is
	 * inclusive and `end` is exclusive (like `Array.slice`).
	 */
	identifyListBlocks(
		lines: string[],
	): Array<{ start: number; end: number }> {
		const blocks: Array<{ start: number; end: number }> = [];
		let blockStart: number | null = null;

		for (let i = 0; i < lines.length; i++) {
			const isItem = this.parser.isListItem(lines[i]!);
			if (isItem && blockStart === null) {
				blockStart = i;
			} else if (!isItem && blockStart !== null) {
				blocks.push({ start: blockStart, end: i });
				blockStart = null;
			}
		}

		if (blockStart !== null) {
			blocks.push({ start: blockStart, end: lines.length });
		}

		return blocks;
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
		const currentDeps = this.parser.getTaskDependencies(line);
		let result = line;
		for (const dep of currentDeps) {
			if (!knownIds.has(dep)) {
				result = this.parser.removeDependencyFromLine(result, dep);
			}
		}
		return result;
	}

	/** Returns the `🆔` from a line, or null. Delegates to {@link TaskParser}. */
	getTaskId(line: string): string | null {
		return this.parser.getTaskId(line);
	}

	/** Removes the `🆔` marker from a line. Delegates to {@link TaskParser}. */
	removeIdFromLine(line: string): string {
		return this.parser.removeIdFromLine(line);
	}
}
