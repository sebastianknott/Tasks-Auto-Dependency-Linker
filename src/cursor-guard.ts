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

	setLine(n: number, text: string): string {
		this.dirty = true;
		this.editor.setLine(n, text);
		return text;
	}

	/** The line the caret sat in when this guard was constructed. */
	get cursorLine(): number {
		return this.head.line;
	}

	/**
	 * Restores the selection captured at construction, but only when a
	 * line was changed. A no-op pass leaves the cursor untouched.
	 */
	restore(): void {
		if (!this.dirty) {
			return;
		}
		this.editor.setSelection(this.clampToLine(this.anchor), this.clampToLine(this.head));
	}


	/**
	 * A write may have shrunk the exact line the caret sat in. Replaying
	 * a stale ch past the new line's end would hand the real editor an
	 * out-of-range position; Obsidian recovers from that by snapping the
	 * caret to the start of the next line instead of clamping it. Clamp
	 * here so the caret always lands on the line it started on.
	 */
	private clampToLine(position: EditorPositionLike): EditorPositionLike {
		if (position.line < 0 || position.line >= this.editor.lineCount()) {
			return position;
		}
		const lineLength = this.editor.getLine(position.line).length;
		return { line: position.line, ch: Math.min(position.ch, lineLength) };
	}
}
