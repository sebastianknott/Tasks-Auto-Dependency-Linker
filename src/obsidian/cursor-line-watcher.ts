import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';

/**
 * Watches for the text cursor moving to a different line inside a
 * Markdown editor, so callers can trigger a cleanup pass on caret move.
 *
 * Obsidian's `Workspace.on(...)` event list has no cursor or selection
 * event (checked against the installed obsidian.d.ts, v1.12.3: the full
 * overload list only has `editor-menu`, `editor-change`, `editor-paste`,
 * `editor-drop`, plus non-editor events). The supported route to observe
 * cursor movement is a CodeMirror 6 extension registered via
 * `Plugin.registerEditorExtension(extension: Extension)`, so this class
 * exposes one via `extension()`.
 *
 * The callback passed to the constructor MUST NOT synchronously write to
 * the editor. CodeMirror forbids dispatching a transaction from inside an
 * update listener, and doing so throws. Callers are expected to route the
 * callback through a `setTimeout`-based debounce, which defers the write
 * outside the listener's call stack and makes it safe.
 *
 * One watcher instance is shared across every editor view in the
 * workspace, since the same `extension()` value is registered once via
 * `registerEditorExtension` and CodeMirror applies it to every view.
 * Because of this sharing, `reset()` must be called whenever a different
 * file is opened, so a cursor landing on the same line number in the new
 * document is not mistaken for "no movement" carried over from the old
 * one.
 */
export class CursorLineWatcher {
	private readonly onLineChange: () => void;
	private lastLine: number | null = null;

	constructor(onLineChange: () => void) {
		this.onLineChange = onLineChange;
	}

	/** Builds the CodeMirror 6 extension to register via `registerEditorExtension`. */
	extension(): Extension {
		return EditorView.updateListener.of((update: ViewUpdate) => this.handle(update));
	}

	/**
	 * Handles one CodeMirror update. Fires `onLineChange` only when the
	 * selection was explicitly set AND the cursor's line number differs
	 * from the last remembered line. The first observation after
	 * construction, or after `reset()`, only records the line: there was
	 * no prior line to compare against, so no movement occurred yet.
	 */
	handle(update: ViewUpdate): void {
		if (!update.selectionSet) {
			return;
		}
		const line = update.state.doc.lineAt(update.state.selection.main.head).number;
		if (line === this.lastLine) {
			return;
		}
		const hadObservedBefore = this.lastLine !== null;
		this.lastLine = line;
		if (hadObservedBefore) {
			this.onLineChange();
		}
	}

	/** Clears the remembered line. Call this when a different file is opened. */
	reset(): void {
		this.lastLine = null;
	}
}
