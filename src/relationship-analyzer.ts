/**
 * Structural analysis of parent-child relationships in task lists.
 *
 * Reads indentation structure to determine which tasks are children
 * of which parents, using {@link TaskParser} for line classification.
 */

import { TaskParser } from './task-parser';

/**
 * Analyzes task list structure to find parent-child relationships and
 * identify contiguous list blocks.
 *
 * Instantiate with a {@link TaskParser} bound to the vault's indentation
 * config, then use the methods below to resolve structure in a snapshot
 * of document lines.
 */
export class RelationshipAnalyzer {
	private readonly parser: TaskParser;

	constructor(parser: TaskParser) {
		this.parser = parser;
	}

	/**
	 * Walks upward from `lineIndex` to find the nearest task line at a
	 * strictly lower indent level. Returns the line index, or `null`.
	 *
	 * Non-task lines are skipped. If the current line itself is not a
	 * task, returns `null`. Stops immediately when a non-list-item line
	 * is encountered (blank line, heading, paragraph), because that marks
	 * a list boundary.
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
	 * Collects the set of child IDs that should be `⛔`-referenced by
	 * a given parent, based on the relationship map.
	 *
	 * Reads child `🆔` IDs from `lines` for each child entry that maps
	 * to `parentIndex` in `relationships`. Children without an ID are
	 * skipped.
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
}
