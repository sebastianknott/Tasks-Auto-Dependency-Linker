/**
 * Pass 2 of editor processing: the three marker cleanup sub-passes.
 */

import type { DependencyCleaner } from '../linking/dependency-cleaner';
import type { TaskParser } from '../parsing/task-parser';
import type { RelationshipAnalyzer } from '../parsing/relationship-analyzer';
import type { LineWriteArbiter } from '../editing/line-write-arbiter';
import type { LineEditor, MarkerCacheLike } from '../types';

/**
 * Strips markers that indentation changes left behind, one list block
 * at a time:
 *
 * a. Removes stale `⛔` from former parents (relationship-based).
 * b. Removes dangling `⛔` that reference deleted `🆔` IDs.
 * c. Removes orphaned `🆔` with no `⛔` referencing them.
 *
 * Collaborators are injected at construction. Per-call state (editor,
 * lines, currentBlock) is stored as instance fields for the duration of
 * one {@link run} call.
 */
export class CleanupPass {
	/** Active editor for the current run call. */
	private editor!: LineEditor;
	/** Snapshot of all editor lines, updated in-place by applyCleanedLine. */
	private lines!: string[];
	/** The list block currently being cleaned. */
	private currentBlock!: { start: number; end: number };

	// eslint-disable-next-line max-params
	constructor(
		private readonly cleaner: DependencyCleaner,
		private readonly parser: TaskParser,
		private readonly relAnalyzer: RelationshipAnalyzer,
		private readonly idCache: MarkerCacheLike,
		private readonly depCache: MarkerCacheLike,
		private readonly arbiter: LineWriteArbiter,
	) {}

	/**
	 * Runs all three cleanup sub-passes on each list block.
	 *
	 * @param editor - The editor to clean, already wrapped by the arbiter.
	 * @param lines - Line snapshot from {@link LinkPass.run}, mutated in
	 *   place as sub-passes rewrite lines.
	 * @param filePath - Path of the file being edited, used to exclude
	 *   its own IDs from cross-file checks.
	 */
	run(editor: LineEditor, lines: string[], filePath: string): void {
		this.editor = editor;
		this.lines = lines;

		const blocks = this.relAnalyzer.identifyListBlocks(this.lines);
		const knownIds = this.collectKnownIds(filePath);
		const vaultDepIds = new Set([
			...this.depCache.getAll(),
			...this.arbiter.getSuppressedDepIds(),
			...this.arbiter.getFrozenDepsForIndeterminateLine(),
		]);

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
	 * IDs in the current document plus IDs from other vault files, plus
	 * the cursor line's frozen id when that line is mid-edit.
	 *
	 * Pass 2b ({@link cleanDanglingDeps}) walks every line in a block,
	 * including parent lines that are not the cursor line and therefore
	 * carry no write protection of their own. When the cursor line is a
	 * child whose `🆔` is a bare fragment mid-deletion, the live-text scan
	 * above finds no id for it, so a `⛔` on the parent that still points
	 * at the child's last well-formed id would otherwise look dangling and
	 * get stripped from a line the user never touched. Unioning in
	 * {@link LineWriteArbiter.getFrozenIdForCursorLine} closes that gap.
	 *
	 * Pass 2a ({@link cleanStaleDeps}) does not need this: it only ever
	 * removes a dep that is present in `blockIds`/`managedIds`, i.e. an id
	 * that is currently live and well-formed somewhere in the block, so a
	 * merely in-flux id is never a removal candidate for it in the first
	 * place.
	 */
	private collectKnownIds(filePath: string): Set<string> {
		const knownIds = new Set<string>(this.idCache.getAllExcluding(filePath));
		for (const line of this.lines) {
			const id = this.parser.getTaskId(line);
			if (id) {
				knownIds.add(id);
			}
		}
		const frozenId = this.arbiter.getFrozenIdForCursorLine();
		if (frozenId) {
			knownIds.add(frozenId);
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
			const cleaned = this.cleaner.removeStaleDeps(line, desiredDeps, blockIds);
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
			const cleaned = this.cleaner.removeDanglingDeps(line, knownIds);
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
				!this.cleaner.isIdReferencedAsDep(this.lines, id) &&
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
		this.lines[docIndex] = this.editor.setLine(docIndex, cleaned);
	}
}
