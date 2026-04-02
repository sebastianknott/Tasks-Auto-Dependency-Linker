/**
 * Orchestrates multi-pass processing of all editor lines.
 *
 * Separated from `indentation-handler.ts` so each file stays
 * within the FTA complexity budget.
 */

import type { EditorLike, IndentationHandler } from './indentation-handler';

/**
 * Read-only interface for querying a vault-wide marker cache.
 *
 * Decouples {@link EditorProcessor} from the concrete
 * {@link MarkerCache} subclasses so tests can supply simple stubs.
 */
export interface MarkerCacheLike {
	getAll(): Set<string>;
	getAllExcluding(filePath: string): Set<string>;
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
 * Vault caches are injected at construction time. Per-call state
 * (editor, lines) is stored as instance fields during processing.
 */
export class EditorProcessor {
	private readonly handler: IndentationHandler;
	private readonly idCache: MarkerCacheLike;
	private readonly depCache: MarkerCacheLike;

	/** Active editor for the current processAllLines call. */
	private editor!: EditorLike;
	/** Snapshot of all editor lines, mutated during cleanup passes. */
	private lines!: string[];
	/** The list block currently being cleaned. */
	private currentBlock!: { start: number; end: number };
	/** Lines slice for the block currently being cleaned. */
	private currentBlockLines!: string[];

	constructor(
		handler: IndentationHandler,
		idCache: MarkerCacheLike,
		depCache: MarkerCacheLike,
	) {
		this.handler = handler;
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
		const blocks = this.handler.identifyListBlocks(this.lines);
		const knownIds = this.collectKnownIds(filePath);
		const vaultDepIds = this.depCache.getAll();

		for (let b = 0; b < blocks.length; b++) {
			this.currentBlock = blocks[b]!;
			this.currentBlockLines = this.lines.slice(
				this.currentBlock.start, this.currentBlock.end,
			);
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
			const id = this.handler.getTaskId(line);
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
			const id = this.handler.getTaskId(this.lines[i]!);
			if (id) {
				ids.add(id);
			}
		}
		return ids;
	}

	/** Pass 2a: Removes stale `⛔` from former parents within a block. */
	private cleanStaleDeps(blockIds: Set<string>): void {
		const relationships = this.handler.buildRelationshipMap(this.currentBlockLines);
		for (let bi = 0; bi < this.currentBlockLines.length; bi++) {
			const line = this.currentBlockLines[bi]!;
			const desiredDeps = this.handler.getDesiredDepsForParent(
				this.currentBlockLines, bi, relationships,
			);
			const cleaned = this.handler.removeStaleDeps(line, desiredDeps, blockIds);
			if (cleaned !== line) {
				this.applyCleanedLine(bi, cleaned);
			}
		}
	}

	/** Pass 2b: Removes dangling `⛔` that reference deleted `🆔` IDs. */
	private cleanDanglingDeps(knownIds: Set<string>): void {
		for (let bi = 0; bi < this.currentBlockLines.length; bi++) {
			const line = this.currentBlockLines[bi]!;
			const cleaned = this.handler.removeDanglingDeps(line, knownIds);
			if (cleaned !== line) {
				this.applyCleanedLine(bi, cleaned);
			}
		}
	}

	/** Pass 2c: Removes orphaned `🆔` with no `⛔` referencing them. */
	private cleanOrphanedIds(vaultDepIds: Set<string>): void {
		for (let bi = 0; bi < this.currentBlockLines.length; bi++) {
			const line = this.currentBlockLines[bi]!;
			const id = this.handler.getTaskId(line);
			if (
				id &&
				!this.handler.isIdReferencedAsDep(this.lines, id) &&
				!vaultDepIds.has(id)
			) {
				const cleaned = this.handler.removeIdFromLine(line);
				this.applyCleanedLine(bi, cleaned);
			}
		}
	}

	/**
	 * Writes a cleaned line back to the editor and updates both
	 * the document-level and block-level line arrays.
	 */
	private applyCleanedLine(blockIndex: number, cleaned: string): void {
		const docIndex = this.currentBlock.start + blockIndex;
		this.editor.setLine(docIndex, cleaned);
		this.lines[docIndex] = cleaned;
		this.currentBlockLines[blockIndex] = cleaned;
	}
}
