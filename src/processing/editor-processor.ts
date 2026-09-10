/**
 * Orchestrates multi-pass processing of all editor lines.
 *
 * Separated from `task-linker.ts` so each file stays
 * within the FTA complexity budget.
 */

import type { TaskLinker } from '../linking/task-linker';
import type { DependencyCleaner } from '../linking/dependency-cleaner';
import type { TaskParser } from '../parsing/task-parser';
import type { RelationshipAnalyzer } from '../parsing/relationship-analyzer';
import { CursorGuard } from '../editing/cursor-guard';
import type { LineWriteArbiter } from '../editing/line-write-arbiter';
import type { EditorLike, LineEditor, MarkerCacheLike } from '../types';

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
	private readonly linker: TaskLinker;
	private readonly cleaner: DependencyCleaner;
	private readonly parser: TaskParser;
	private readonly relAnalyzer: RelationshipAnalyzer;
	private readonly idCache: MarkerCacheLike;
	private readonly depCache: MarkerCacheLike;
	private readonly arbiter: LineWriteArbiter;

	/** Active editor for the current processAllLines call. */
	private editor!: LineEditor;
	/** Snapshot of all editor lines, updated in-place by applyCleanedLine. */
	private lines!: string[];
	/** The list block currently being cleaned. */
	private currentBlock!: { start: number; end: number };

	// eslint-disable-next-line max-params
	constructor(
		linker: TaskLinker,
		cleaner: DependencyCleaner,
		parser: TaskParser,
		relAnalyzer: RelationshipAnalyzer,
		idCache: MarkerCacheLike,
		depCache: MarkerCacheLike,
		arbiter: LineWriteArbiter,
	) {
		this.linker = linker;
		this.cleaner = cleaner;
		this.parser = parser;
		this.relAnalyzer = relAnalyzer;
		this.idCache = idCache;
		this.depCache = depCache;
		this.arbiter = arbiter;
	}

	/**
	 * Processes every line in the editor for dependency linking.
	 *
	 * The editor is wrapped in a {@link CursorGuard} so that, when a line
	 * is rewritten, the user's caret or selection is restored to where it
	 * was instead of jumping to the end of the line.
	 *
	 * @param editor - The editor whose lines are processed.
	 * @param filePath - Path of the file being edited, used to
	 *   exclude its own IDs from cross-file checks.
	 */
	processAllLines(editor: EditorLike, filePath: string): void {
		const guard = new CursorGuard(editor);
		this.arbiter.beginPass(guard, guard.cursorLine, filePath);
		this.editor = this.arbiter;
		this.runLinkPass();
		this.runCleanupPass(filePath);
		this.arbiter.endPass();
		guard.restore();
	}

	/**
	 * Pass 1: Adds `🆔` / `⛔` link markers based on indentation,
	 * then snapshots all editor lines into {@link lines}.
	 *
	 * Skips a line only when its `🆔` is currently absent *and* the
	 * arbiter refuses to let a fresh one be minted for it (see
	 * {@link LineWriteArbiter.blocksIdMinting}). A suppressed id that is
	 * merely a *different* value, not absent (the user renamed it by
	 * hand), must still run through `processLine` normally so the
	 * id-rename cascades onto the parent's `⛔` the same way it always
	 * has.
	 */
	private runLinkPass(): void {
		const existingIds = this.idCache.getAll();
		const lineCount = this.editor.lineCount();

		// Read all lines once so processLine can find parents without rebuilding
		// the full array on every call (avoids O(N^2) line reads).
		this.linker.prepareForLinkPass(this.editor);

		for (let i = 0; i < lineCount; i++) {
			const idMissing = this.parser.getTaskId(this.editor.getLine(i)) === null;
			if (idMissing && this.arbiter.blocksIdMinting(i)) {
				continue;
			}
			const mintedId = this.linker.processLine(this.editor, i, existingIds);
			if (mintedId !== null) {
				existingIds.add(mintedId);
			}
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
