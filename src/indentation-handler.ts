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

	constructor(parser: TaskParser, idEngine: IdEngine) {
		this.parser = parser;
		this.idEngine = idEngine;
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
		const lineCount = editor.lineCount();
		const lines: string[] = [];
		for (let i = 0; i < lineCount; i++) {
			lines.push(editor.getLine(i));
		}

		const parentIndex = this.findParentTask(lines, lineIndex);
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
	 */
	removeStaleDeps(line: string, desiredDeps: Set<string>): string {
		const currentDeps = this.parser.getTaskDependencies(line);
		let result = line;
		for (const dep of currentDeps) {
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

	/** Returns the `🆔` from a line, or null. Delegates to {@link TaskParser}. */
	getTaskId(line: string): string | null {
		return this.parser.getTaskId(line);
	}

	/** Removes the `🆔` marker from a line. Delegates to {@link TaskParser}. */
	removeIdFromLine(line: string): string {
		return this.parser.removeIdFromLine(line);
	}
}

/**
 * Orchestrates processing all lines in an editor.
 *
 * Uses a two-pass approach:
 * 1. **Link pass**: adds `🆔` / `⛔` markers based on current indentation.
 * 2. **Cleanup pass**: removes stale `⛔` from former parents and orphaned `🆔`.
 *
 * Extracted from main.ts so the iteration logic is testable and mutation-covered.
 */
export class EditorProcessor {
	private readonly handler: IndentationHandler;

	constructor(handler: IndentationHandler) {
		this.handler = handler;
	}

	/** Processes every line in the editor for dependency linking. */
	processAllLines(editor: EditorLike, existingIds: Set<string>): void {
		const lineCount = editor.lineCount();

		// Pass 1: Link — add 🆔 / ⛔ markers based on indentation
		for (let i = 0; i < lineCount; i++) {
			this.handler.processLine(editor, i, existingIds);
		}

		// Read lines after pass 1
		const lines: string[] = [];
		for (let i = 0; i < lineCount; i++) {
			lines.push(editor.getLine(i));
		}

		// Build desired relationships from current indentation
		const relationships = this.handler.buildRelationshipMap(lines);

		// Pass 2a: Remove stale ⛔ from each task line
		for (let i = 0; i < lineCount; i++) {
			const line = lines[i]!;
			const desiredDeps = this.handler.getDesiredDepsForParent(
				lines,
				i,
				relationships,
			);
			const cleaned = this.handler.removeStaleDeps(line, desiredDeps);
			if (cleaned !== line) {
				editor.setLine(i, cleaned);
				lines[i] = cleaned;
			}
		}

		// Pass 2b: Remove orphaned 🆔 (no ⛔ references it anywhere)
		for (let i = 0; i < lineCount; i++) {
			const line = lines[i]!;
			const id = this.handler.getTaskId(line);
			if (id && !this.handler.isIdReferencedAsDep(lines, id)) {
				const cleaned = this.handler.removeIdFromLine(line);
				editor.setLine(i, cleaned);
				lines[i] = cleaned;
			}
		}
	}
}
