/**
 * Pass 1 of editor processing: adds `🆔` / `⛔` link markers.
 */

import type { TaskLinker } from '../linking/task-linker';
import type { TaskParser } from '../parsing/task-parser';
import type { LineWriteArbiter } from '../editing/line-write-arbiter';
import type { LineEditor, MarkerCacheLike } from '../types';

/**
 * Adds `🆔` / `⛔` markers to every task line based on indentation.
 *
 * Runs before {@link CleanupPass} and hands it the resulting line
 * snapshot, so the cleanup sub-passes never re-read the editor to
 * discover what linking produced.
 */
export class LinkPass {
	constructor(
		private readonly linker: TaskLinker,
		private readonly parser: TaskParser,
		private readonly idCache: MarkerCacheLike,
		private readonly arbiter: LineWriteArbiter,
	) {}

	/**
	 * Links every line, then snapshots the editor.
	 *
	 * Skips a line only when its `🆔` is currently absent *and* the
	 * arbiter refuses to let a fresh one be minted for it (see
	 * {@link LineWriteArbiter.blocksIdMinting}). A suppressed id that is
	 * merely a *different* value, not absent (the user renamed it by
	 * hand), must still run through `processLine` normally so the
	 * id-rename cascades onto the parent's `⛔`.
	 *
	 * @param editor - The editor to link, already wrapped by the arbiter.
	 * @returns Every editor line as it stands after linking.
	 */
	run(editor: LineEditor): string[] {
		const existingIds = this.idCache.getAll();
		const lineCount = editor.lineCount();

		// Read all lines once so processLine can find parents without rebuilding
		// the full array on every call (avoids O(N^2) line reads).
		this.linker.prepareForLinkPass(editor);

		for (let i = 0; i < lineCount; i++) {
			const idMissing = this.parser.getTaskId(editor.getLine(i)) === null;
			if (idMissing && this.arbiter.blocksIdMinting(i)) {
				continue;
			}
			const mintedId = this.linker.processLine(editor, i, existingIds);
			if (mintedId !== null) {
				existingIds.add(mintedId);
			}
		}

		const lines: string[] = [];
		for (let i = 0; i < lineCount; i++) {
			lines.push(editor.getLine(i));
		}
		return lines;
	}
}
