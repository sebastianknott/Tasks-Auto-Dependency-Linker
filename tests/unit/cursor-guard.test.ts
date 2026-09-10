import { describe, it, expect, vi } from 'vitest';
import { CursorGuard } from '../../src/cursor-guard';
import type { EditorLike } from '../../src/types';
import { createEditor } from '../fixtures/editor';

describe('CursorGuard', () => {
	it('delegates lineCount, getLine, and setLine to the wrapped editor', () => {
		const lines = ['a', 'b'];
		const editor = createEditor(lines, { line: 0, ch: 0 }, { line: 0, ch: 0 });
		const guard = new CursorGuard(editor);

		expect(guard.lineCount()).toBe(2);
		expect(guard.getLine(1)).toBe('b');
		guard.setLine(0, 'changed');
		expect(lines[0]).toBe('changed');
	});

	it('restores the captured selection when a line was changed', () => {
		const anchor = { line: 1, ch: 3 };
		const head = { line: 1, ch: 5 };
		const editor = createEditor(['x', 'y'], anchor, head);
		const guard = new CursorGuard(editor);

		guard.setLine(1, 'y changed');
		guard.restore();

		expect(editor.setSelection).toHaveBeenCalledTimes(1);
		expect(editor.setSelection).toHaveBeenCalledWith(anchor, head);
	});

	it('does not touch the selection when no line changed', () => {
		const editor = createEditor(['x'], { line: 0, ch: 0 }, { line: 0, ch: 0 });
		const guard = new CursorGuard(editor);

		guard.restore();

		expect(editor.setSelection).not.toHaveBeenCalled();
	});

	it('captures the selection at construction, before any edits', () => {
		const anchor = { line: 2, ch: 1 };
		const head = { line: 2, ch: 4 };
		const editor = createEditor(['a', 'b', 'cccc'], anchor, head);
		new CursorGuard(editor);

		// Both anchor and head are read up front.
		expect(editor.getCursor).toHaveBeenCalledWith('anchor');
		expect(editor.getCursor).toHaveBeenCalledWith('head');
	});

	it('restores using the position captured at construction, not a later one', () => {
		const captured = { line: 0, ch: 2 };
		const editor: EditorLike & { setSelection: ReturnType<typeof vi.fn> } =
			createEditor(['hello'], captured, captured);
		const guard = new CursorGuard(editor);

		// Simulate the cursor moving after capture (should be ignored).
		editor.getCursor = vi.fn(() => ({ line: 0, ch: 99 }));
		guard.setLine(0, 'hello world');
		guard.restore();

		expect(editor.setSelection).toHaveBeenCalledWith(captured, captured);
	});

	it('clamps the restored ch to the new line length when a write shrank the cursor line', () => {
		const position = { line: 0, ch: 11 }; // end of 'hello world'
		const editor = createEditor(['hello world'], position, position);
		const guard = new CursorGuard(editor);

		guard.setLine(0, 'hi');
		guard.restore();

		expect(editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 2 }, { line: 0, ch: 2 });
	});

	it('treats a captured line equal to lineCount as out of range', () => {
		const position = { line: 2, ch: 3 }; // lineCount is 2, so line 2 does not exist
		const editor = createEditor(['a', 'b'], position, position);
		const guard = new CursorGuard(editor);

		guard.setLine(0, 'changed');

		expect(() => guard.restore()).not.toThrow();
		expect(editor.setSelection).toHaveBeenCalledWith(position, position);
	});

	it('leaves an out-of-range captured line untouched instead of throwing', () => {
		const position = { line: -1, ch: 5 };
		const editor = createEditor(['a'], position, position);
		const guard = new CursorGuard(editor);

		guard.setLine(0, 'b');

		expect(() => guard.restore()).not.toThrow();
		expect(editor.setSelection).toHaveBeenCalledWith(position, position);
	});

	it('does not touch a ch that still fits within the new line length', () => {
		const anchor = { line: 1, ch: 3 };
		const head = { line: 1, ch: 5 };
		const editor = createEditor(['x', 'y'], anchor, head);
		const guard = new CursorGuard(editor);

		guard.setLine(1, 'y changed, still long enough');
		guard.restore();

		expect(editor.setSelection).toHaveBeenCalledWith({ line: 1, ch: 3 }, { line: 1, ch: 5 });
	});

	it('returns the text it was handed from setLine', () => {
		const editor = createEditor(['a', 'b'], { line: 0, ch: 0 }, { line: 0, ch: 0 });
		const guard = new CursorGuard(editor);

		expect(guard.setLine(0, 'changed')).toBe('changed');
	});

	it('exposes cursorLine from the head captured at construction', () => {
		const head = { line: 3, ch: 2 };
		const editor = createEditor(['a', 'b', 'c', 'd'], { line: 3, ch: 0 }, head);
		const guard = new CursorGuard(editor);

		expect(guard.cursorLine).toBe(3);
	});

	it('cursorLine does not change when the underlying cursor moves later', () => {
		const editor = createEditor(['a', 'b'], { line: 0, ch: 0 }, { line: 0, ch: 0 });
		const guard = new CursorGuard(editor);

		editor.getCursor = vi.fn(() => ({ line: 1, ch: 0 }));

		expect(guard.cursorLine).toBe(0);
	});
});
