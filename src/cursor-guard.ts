/**
 * Preserves the editor selection across a batch of line edits.
 *
 * Replacing a whole line with `setLine` makes CodeMirror map a caret
 * that sat inside the replaced range to the end of the new text, so the
 * cursor jumps to the end of the line while the user is still typing.
 * This guard wraps the editor, captures the selection up front, tracks
 * whether any line was actually changed, and restores the original
 * selection afterwards so the caret stays where the user left it.
 */

import type { EditorLike, EditorPositionLike, LineEditor } from './types';

export class CursorGuard implements LineEditor {
	private readonly editor: EditorLike;
	private readonly anchor: EditorPositionLike;
	private readonly head: EditorPositionLike;
	private dirty = false;

	constructor(editor: EditorLike) {
		this.editor = editor;
		this.anchor = editor.getCursor('anchor');
		this.head = editor.getCursor('head');
	}

	lineCount(): number {
		return this.editor.lineCount();
	}

	getLine(n: number): string {
		return this.editor.getLine(n);
	}

	setLine(n: number, text: string): void {
		this.dirty = true;
		this.editor.setLine(n, text);
	}

	/**
	 * Restores the selection captured at construction, but only when a
	 * line was changed. A no-op pass leaves the cursor untouched.
	 */
	restore(): void {
		if (!this.dirty) {
			return;
		}
		this.editor.setSelection(this.anchor, this.head);
	}
}
