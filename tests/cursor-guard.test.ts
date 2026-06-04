import { describe, it, expect, vi } from 'vitest';
import { CursorGuard } from '../src/cursor-guard';
import type { EditorLike, EditorPositionLike } from '../src/types';

/**
 * Editor mock that records selection calls and tracks a mutable cursor.
 */
function createMockEditor(lines: string[], anchor: EditorPositionLike, head: EditorPositionLike) {
	return {
		lineCount: vi.fn(() => lines.length),
		getLine: vi.fn((n: number) => lines[n]!),
		setLine: vi.fn((n: number, text: string) => {
			lines[n] = text;
		}),
		getCursor: vi.fn((which?: 'anchor' | 'head') => (which === 'head' ? head : anchor)),
		setSelection: vi.fn(),
	};
}

describe('CursorGuard', () => {
	it('delegates lineCount, getLine, and setLine to the wrapped editor', () => {
		const lines = ['a', 'b'];
		const editor = createMockEditor(lines, { line: 0, ch: 0 }, { line: 0, ch: 0 });
		const guard = new CursorGuard(editor);

		expect(guard.lineCount()).toBe(2);
		expect(guard.getLine(1)).toBe('b');
		guard.setLine(0, 'changed');
		expect(lines[0]).toBe('changed');
	});

	it('restores the captured selection when a line was changed', () => {
		const anchor = { line: 1, ch: 3 };
		const head = { line: 1, ch: 5 };
		const editor = createMockEditor(['x', 'y'], anchor, head);
		const guard = new CursorGuard(editor);

		guard.setLine(1, 'y changed');
		guard.restore();

		expect(editor.setSelection).toHaveBeenCalledTimes(1);
		expect(editor.setSelection).toHaveBeenCalledWith(anchor, head);
	});

	it('does not touch the selection when no line changed', () => {
		const editor = createMockEditor(['x'], { line: 0, ch: 0 }, { line: 0, ch: 0 });
		const guard = new CursorGuard(editor);

		guard.restore();

		expect(editor.setSelection).not.toHaveBeenCalled();
	});

	it('captures the selection at construction, before any edits', () => {
		const anchor = { line: 2, ch: 1 };
		const head = { line: 2, ch: 4 };
		const editor = createMockEditor(['a', 'b', 'cccc'], anchor, head);
		new CursorGuard(editor);

		// Both anchor and head are read up front.
		expect(editor.getCursor).toHaveBeenCalledWith('anchor');
		expect(editor.getCursor).toHaveBeenCalledWith('head');
	});

	it('restores using the position captured at construction, not a later one', () => {
		const captured = { line: 0, ch: 2 };
		const editor: EditorLike & { setSelection: ReturnType<typeof vi.fn> } =
			createMockEditor(['hello'], captured, captured);
		const guard = new CursorGuard(editor);

		// Simulate the cursor moving after capture (should be ignored).
		editor.getCursor = vi.fn(() => ({ line: 0, ch: 99 }));
		guard.setLine(0, 'hello world');
		guard.restore();

		expect(editor.setSelection).toHaveBeenCalledWith(captured, captured);
	});
});
