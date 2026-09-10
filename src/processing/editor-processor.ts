/**
 * Orchestrates multi-pass processing of all editor lines.
 */

import { CursorGuard } from '../editing/cursor-guard';
import type { LineWriteArbiter } from '../editing/line-write-arbiter';
import type { LinkPass } from './link-pass';
import type { CleanupPass } from './cleanup-pass';
import type { EditorLike } from '../types';

/**
 * Runs one processing pass over an editor.
 *
 * Owns the pass lifecycle and nothing else: open the write gate, link,
 * clean, close the gate, put the caret back. {@link LinkPass} and
 * {@link CleanupPass} carry the marker logic.
 */
export class EditorProcessor {
	constructor(
		private readonly linkPass: LinkPass,
		private readonly cleanupPass: CleanupPass,
		private readonly arbiter: LineWriteArbiter,
	) {}

	/**
	 * Processes every line in the editor for dependency linking.
	 *
	 * The editor is wrapped in a {@link CursorGuard} so that, when a line
	 * is rewritten, the user's caret or selection is restored to where it
	 * was instead of jumping to the end of the line.
	 *
	 * Both passes write through the arbiter rather than the guard, so
	 * every rewrite of the cursor line passes the suppression gate.
	 *
	 * @param editor - The editor whose lines are processed.
	 * @param filePath - Path of the file being edited, used to
	 *   exclude its own IDs from cross-file checks.
	 */
	processAllLines(editor: EditorLike, filePath: string): void {
		const guard = new CursorGuard(editor);
		this.arbiter.beginPass(guard, guard.cursorLine, filePath);
		const lines = this.linkPass.run(this.arbiter);
		this.cleanupPass.run(this.arbiter, lines, filePath);
		this.arbiter.endPass();
		guard.restore();
	}
}
