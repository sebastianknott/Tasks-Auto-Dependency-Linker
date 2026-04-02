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

/**
 * Orchestrates processing all lines in an editor.
 *
 * Uses a multi-pass approach:
 * 1. **Link pass**: adds `🆔` / `⛔` markers based on current indentation.
 * 2. **Cleanup pass** (per list block):
 *    a. Removes stale `⛔` from former parents (relationship-based).
 *    b. Removes dangling `⛔` that reference deleted `🆔` IDs.
 *    c. Removes orphaned `🆔` with no `⛔` referencing them.
 *
 * Extracted from main.ts so the iteration logic is testable and mutation-covered.
 */
export class EditorProcessor {
	private readonly handler: IndentationHandler;

	constructor(handler: IndentationHandler) {
		this.handler = handler;
	}

	/**
	 * Processes every line in the editor for dependency linking.
	 *
	 * @param editor - The editor whose lines are processed.
	 * @param existingIds - All `🆔` IDs known across the entire vault
	 *   (used for collision-free ID generation in Pass 1).
	 * @param vaultDepIds - All `⛔` dep references known across the
	 *   vault. Orphaned `🆔` markers whose ID appears in this set
	 *   are preserved (referenced by a `⛔` in another vault file).
	 * @param otherVaultIds - All `🆔` IDs from vault files **other
	 *   than the current document**. Used by the dangling-dep pass to
	 *   preserve `⛔` markers that reference cross-file `🆔` IDs.
	 *   When omitted, only the live document IDs are considered.
	 */
	processAllLines(
		editor: EditorLike,
		existingIds: Set<string>,
		vaultDepIds?: Set<string>,
		otherVaultIds?: Set<string>,
	): void {
		const lineCount = editor.lineCount();

		// Pass 1: Add 🆔 / ⛔ link markers based on indentation
		for (let i = 0; i < lineCount; i++) {
			this.handler.processLine(editor, i, existingIds);
		}

		// Read lines after pass 1
		const lines: string[] = [];
		for (let i = 0; i < lineCount; i++) {
			lines.push(editor.getLine(i));
		}

		// Identify list blocks so cleanup is scoped per-list
		const blocks = this.handler.identifyListBlocks(lines);

		// Collect all 🆔 IDs present in the document and combine with
		// IDs from other vault files for dangling-dep checks
		const knownIds = new Set<string>(otherVaultIds);
		for (let i = 0; i < lines.length; i++) {
			const id = this.handler.getTaskId(lines[i]!);
			if (id) {
				knownIds.add(id);
			}
		}

		// Collect all 🆔 IDs present in each block for cross-reference checks
		const blockIdSets: Map<number, Set<string>> = new Map();
		for (let b = 0; b < blocks.length; b++) {
			const ids = new Set<string>();
			const block = blocks[b]!;
			for (let i = block.start; i < block.end; i++) {
				const id = this.handler.getTaskId(lines[i]!);
				if (id) {
					ids.add(id);
				}
			}
			blockIdSets.set(b, ids);
		}

		// Pass 2: Cleanup per list block
		for (let b = 0; b < blocks.length; b++) {
			const block = blocks[b]!;
			const blockLines = lines.slice(block.start, block.end);
			const blockIds = blockIdSets.get(b)!;
			const relationships = this.handler.buildRelationshipMap(blockLines);

			// Pass 2a: Remove stale ⛔ (only for deps whose 🆔 is in this block)
			for (let bi = 0; bi < blockLines.length; bi++) {
				const line = blockLines[bi]!;
				const desiredDeps = this.handler.getDesiredDepsForParent(
					blockLines,
					bi,
					relationships,
				);
				const cleaned = this.handler.removeStaleDeps(
					line,
					desiredDeps,
					blockIds,
				);
				if (cleaned !== line) {
					const docIndex = block.start + bi;
					editor.setLine(docIndex, cleaned);
					lines[docIndex] = cleaned;
					blockLines[bi] = cleaned;
				}
			}

			// Pass 2b: Remove dangling ⛔ (references to deleted 🆔 IDs)
			for (let bi = 0; bi < blockLines.length; bi++) {
				const line = blockLines[bi]!;
				const cleaned = this.handler.removeDanglingDeps(
					line,
					knownIds,
				);
				if (cleaned !== line) {
					const docIndex = block.start + bi;
					editor.setLine(docIndex, cleaned);
					lines[docIndex] = cleaned;
					blockLines[bi] = cleaned;
				}
			}

			// Pass 2c: Remove orphaned 🆔 (no ⛔ references it in document or vault)
			for (let bi = 0; bi < blockLines.length; bi++) {
				const line = blockLines[bi]!;
				const id = this.handler.getTaskId(line);
				if (
					id &&
					!this.handler.isIdReferencedAsDep(lines, id) &&
					!vaultDepIds?.has(id)
				) {
					const cleaned = this.handler.removeIdFromLine(line);
					const docIndex = block.start + bi;
					editor.setLine(docIndex, cleaned);
					lines[docIndex] = cleaned;
					blockLines[bi] = cleaned;
				}
			}
		}
	}
}
