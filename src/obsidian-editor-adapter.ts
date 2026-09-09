/**
 * Adapts Obsidian's real `Editor` to the plugin's `EditorLike` contract.
 *
 * Obsidian's `Editor.setLine` returns `void`, but every consumer in
 * this plugin (`CursorGuard`, `LineWriteArbiter`, `EditorProcessor`)
 * relies on `setLine` returning the line's effective content after the
 * write, so a correction never goes unnoticed. `Editor.setLine` is
 * synchronous, so reading the line back immediately after the write is
 * safe and gives this the same contract as every other `LineEditor`.
 */
import type { Editor } from 'obsidian';
import type { EditorLike, EditorPositionLike } from './types';

export class ObsidianEditorAdapter implements EditorLike {
	constructor(private readonly editor: Editor) {}

	lineCount(): number {
		return this.editor.lineCount();
	}

	getLine(n: number): string {
		return this.editor.getLine(n);
	}

	setLine(n: number, text: string): string {
		this.editor.setLine(n, text);
		return this.editor.getLine(n);
	}

	getCursor(which?: 'anchor' | 'head'): EditorPositionLike {
		return this.editor.getCursor(which);
	}

	setSelection(anchor: EditorPositionLike, head: EditorPositionLike): void {
		this.editor.setSelection(anchor, head);
	}
}
