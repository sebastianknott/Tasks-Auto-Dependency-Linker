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
	 * ensures the parent has an `🆔` and the child has a `⛔` for that ID.
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

		let parentLine = editor.getLine(parentIndex);
		let parentId = this.parser.getTaskId(parentLine);

		if (!parentId) {
			parentId = this.idEngine.generateUniqueId(existingIds);
			parentLine = this.parser.addIdToLine(parentLine, parentId);
			editor.setLine(parentIndex, parentLine);
			existingIds.add(parentId);
		}

		let childLine = editor.getLine(lineIndex);
		childLine = this.parser.addDependencyToLine(childLine, parentId);
		editor.setLine(lineIndex, childLine);
	}
}
