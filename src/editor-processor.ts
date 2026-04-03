/**
 * Orchestrates multi-pass processing of all editor lines.
 *
 * Separated from `indentation-handler.ts` so each file stays
 * within the FTA complexity budget.
 */

import type { IndentationHandler } from './indentation-handler';
import type { TaskParser } from './task-parser';
import type { RelationshipAnalyzer } from './relationship-analyzer';
import type { EditorLike, MarkerCacheLike } from './types';

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
 * All collaborators are injected at construction time. Per-call state
 * (editor, lines, currentBlock) is stored as instance fields during
 * processing and reset at the start of each {@link processAllLines} call.
 */
export class EditorProcessor {
	private readonly handler: IndentationHandler;
	private readonly parser: TaskParser;
	private readonly relAnalyzer: RelationshipAnalyzer;
	private readonly idCache: MarkerCacheLike;
	private readonly depCache: MarkerCacheLike;

	/** Active editor for the current processAllLines call. */
	private editor!: EditorLike;
	/** Snapshot of all editor lines, updated in-place by applyCleanedLine. */
	private lines!: string[];
	/** The list block currently being cleaned. */
	private currentBlock!: { start: number; end: number };

	constructor(
		handler: IndentationHandler,
		parser: TaskParser,
		relAnalyzer: RelationshipAnalyzer,
		idCache: MarkerCacheLike,
		depCache: MarkerCacheLike,
	) {
		this.handler = handler;
		this.parser = parser;
		this.relAnalyzer = relAnalyzer;
		this.idCache = idCache;
		this.depCache = depCache;
	}

	/**
	 * Processes every line in the editor for dependency linking.
	 *
	 * @param editor - The editor whose lines are processed.
	 * @param filePath - Path of the file being edited, used to
	 *   exclude its own IDs from cross-file checks.
	 */
	processAllLines(editor: EditorLike, filePath: string): void {
		this.editor = editor;
		this.runLinkPass();
		this.runCleanupPass(filePath);
	}

	/**
	 * Pass 1: Adds `🆔` / `⛔` link markers based on indentation,
	 * then snapshots all editor lines into {@link lines}.
	 */
	private runLinkPass(): void {
		const existingIds = this.idCache.getAll();
		const lineCount = this.editor.lineCount();

		// Read all lines once so processLine can find parents without rebuilding
		// the full array on every call (avoids O(N^2) line reads).
		this.handler.prepareForLinkPass(this.editor);

		for (let i = 0; i < lineCount; i++) {
			this.handler.processLine(this.editor, i, existingIds);
		}

		this.lines = [];
		for (let i = 0; i < lineCount; i++) {
			this.lines.push(this.editor.getLine(i));
		}
	}

	/** Pass 2: Runs all cleanup sub-passes on each list block. */
	private runCleanupPass(filePath: string): void {
		const blocks = this.relAnalyzer.identifyListBlocks(this.lines);
		const knownIds = this.collectKnownIds(filePath);
		const vaultDepIds = this.depCache.getAll();

		for (let b = 0; b < blocks.length; b++) {
			this.currentBlock = blocks[b]!;
			const blockIds = this.collectIdsInRange(this.currentBlock);

			this.cleanStaleDeps(blockIds);
			this.cleanDanglingDeps(knownIds);
			this.cleanOrphanedIds(vaultDepIds);
		}
	}

	/**
	 * Collects all `🆔` IDs visible for dangling-dep checks:
	 * IDs in the current document plus IDs from other vault files.
	 */
	private collectKnownIds(filePath: string): Set<string> {
		const knownIds = new Set<string>(this.idCache.getAllExcluding(filePath));
		for (const line of this.lines) {
			const id = this.parser.getTaskId(line);
			if (id) {
				knownIds.add(id);
			}
		}
		return knownIds;
	}

	/** Collects all `🆔` IDs within a block range. */
	private collectIdsInRange(
		block: { start: number; end: number },
	): Set<string> {
		const ids = new Set<string>();
		for (let i = block.start; i < block.end; i++) {
			const id = this.parser.getTaskId(this.lines[i]!);
			if (id) {
				ids.add(id);
			}
		}
		return ids;
	}

	/** Pass 2a: Removes stale `⛔` from former parents within a block. */
	private cleanStaleDeps(blockIds: Set<string>): void {
		const blockLines = this.lines.slice(this.currentBlock.start, this.currentBlock.end);
		const relationships = this.relAnalyzer.buildRelationshipMap(blockLines);
		for (let bi = 0; bi < blockLines.length; bi++) {
			const line = blockLines[bi]!;
			const desiredDeps = this.relAnalyzer.getDesiredDepsForParent(
				blockLines, bi, relationships,
			);
			const cleaned = this.handler.removeStaleDeps(line, desiredDeps, blockIds);
			if (cleaned !== line) {
				this.applyCleanedLine(bi, cleaned);
			}
		}
	}

	/** Pass 2b: Removes dangling `⛔` that reference deleted `🆔` IDs. */
	private cleanDanglingDeps(knownIds: Set<string>): void {
		const start = this.currentBlock.start;
		for (let i = start; i < this.currentBlock.end; i++) {
			const line = this.lines[i]!;
			const cleaned = this.handler.removeDanglingDeps(line, knownIds);
			if (cleaned !== line) {
				this.applyCleanedLine(i - start, cleaned);
			}
		}
	}

	/** Pass 2c: Removes orphaned `🆔` with no `⛔` referencing them. */
	private cleanOrphanedIds(vaultDepIds: Set<string>): void {
		const start = this.currentBlock.start;
		for (let i = start; i < this.currentBlock.end; i++) {
			const line = this.lines[i]!;
			const id = this.parser.getTaskId(line);
			if (
				id &&
				!this.handler.isIdReferencedAsDep(this.lines, id) &&
				!vaultDepIds.has(id)
			) {
				const cleaned = this.parser.removeIdFromLine(line);
				this.applyCleanedLine(i - start, cleaned);
			}
		}
	}

	/**
	 * Writes a cleaned line back to the editor and updates the
	 * document-level line array so subsequent passes see current state.
	 */
	private applyCleanedLine(blockIndex: number, cleaned: string): void {
		const docIndex = this.currentBlock.start + blockIndex;
		this.editor.setLine(docIndex, cleaned);
		this.lines[docIndex] = cleaned;
	}
}
