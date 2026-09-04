import { describe, it, expect, vi } from 'vitest';
import { ObsidianEditorAdapter } from '../src/obsidian-editor-adapter';
import type { EditorPositionLike } from '../src/types';

/**
 * Mimics Obsidian's real `Editor`, whose `setLine` returns `void`.
 */
function createRealEditorMock(lines: string[]) {
	return {
		lineCount: vi.fn(() => lines.length),
		getLine: vi.fn((n: number) => lines[n]!),
		setLine: vi.fn((n: number, text: string): void => {
			lines[n] = text;
		}),
		getCursor: vi.fn(
			(which?: 'anchor' | 'head'): EditorPositionLike =>
				which === 'head' ? { line: 1, ch: 1 } : { line: 0, ch: 0 },
		),
		setSelection: vi.fn(),
	};
}

describe('ObsidianEditorAdapter', () => {
	it('delegates lineCount and getLine', () => {
		const editor = createRealEditorMock(['a', 'b']);
		const adapter = new ObsidianEditorAdapter(editor);

		expect(adapter.lineCount()).toBe(2);
		expect(adapter.getLine(1)).toBe('b');
	});

	it('setLine writes through the real editor and returns the resulting line', () => {
		const lines = ['a', 'b'];
		const editor = createRealEditorMock(lines);
		const adapter = new ObsidianEditorAdapter(editor);

		const result = adapter.setLine(0, 'changed');

		expect(editor.setLine).toHaveBeenCalledWith(0, 'changed');
		expect(lines[0]).toBe('changed');
		expect(result).toBe('changed');
	});

	it('delegates getCursor and setSelection', () => {
		const editor = createRealEditorMock(['a']);
		const adapter = new ObsidianEditorAdapter(editor);

		expect(adapter.getCursor('head')).toEqual({ line: 1, ch: 1 });
		adapter.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 1 });
		expect(editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 0 }, { line: 1, ch: 1 });
	});
});
