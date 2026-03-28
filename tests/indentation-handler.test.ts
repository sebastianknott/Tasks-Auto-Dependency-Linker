import { describe, it, expect, vi } from 'vitest';
import { IndentationHandler } from '../src/indentation-handler';
import { TaskParser, DEFAULT_INDENT_CONFIG } from '../src/task-parser';
import { IdEngine } from '../src/id-engine';

/** Minimal Editor mock matching Obsidian's Editor interface surface we use. */
function createMockEditor(lines: string[]) {
	return {
		lineCount: vi.fn(() => lines.length),
		getLine: vi.fn((n: number) => {
			if (n < 0 || n >= lines.length) {
				throw new RangeError(`getLine(${n}) out of bounds (0..${lines.length - 1})`);
			}
			return lines[n]!;
		}),
		setLine: vi.fn((n: number, text: string) => {
			lines[n] = text;
		}),
	};
}

describe('IndentationHandler', () => {
	const parser = new TaskParser(DEFAULT_INDENT_CONFIG);
	const idEngine = new IdEngine();

	describe('findParentTask', () => {
		it('returns null when the line is at root level', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Root task'];
			expect(handler.findParentTask(lines, 0)).toBeNull();
		});

		it('finds the immediate parent task above', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			expect(handler.findParentTask(lines, 1)).toBe(0);
		});

		it('skips non-task lines when searching upward', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'Some text',
				'\t- [ ] Child',
			];
			expect(handler.findParentTask(lines, 2)).toBe(0);
		});

		it('finds the correct parent at multiple indent levels', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Grandparent',
				'\t- [ ] Parent',
				'\t\t- [ ] Child',
			];
			expect(handler.findParentTask(lines, 2)).toBe(1);
		});

		it('returns null when no parent task exists above', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'Some text',
				'\t- [ ] Indented task',
			];
			expect(handler.findParentTask(lines, 1)).toBeNull();
		});

		it('returns null for a non-task line', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Task',
				'\tSome indented text',
			];
			expect(handler.findParentTask(lines, 1)).toBeNull();
		});

		it('skips tasks at the same indent level (siblings)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Sibling A',
				'\t- [ ] Sibling B',
			];
			expect(handler.findParentTask(lines, 2)).toBe(0);
		});

		it('returns null at line 0', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['\t- [ ] Indented at top'];
			expect(handler.findParentTask(lines, 0)).toBeNull();
		});

		it('returns null for root-level task even when tasks exist below', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Root',
				'\t- [ ] Child below',
			];
			// Root at indent 0 should never search for a parent
			expect(handler.findParentTask(lines, 0)).toBeNull();
		});

		it('returns null for a second root-level task after another root task', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] First root',
				'- [ ] Second root',
			];
			// Second root at indent 0: without the guard it would search
			// upward and find "First root" at the same level (not lower),
			// so the loop returns null anyway. But with lineIndex+1 mutation,
			// it would go out of bounds. We verify null is returned correctly.
			expect(handler.findParentTask(lines, 1)).toBeNull();
		});

		it('finds parent directly above, not below', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent above',
				'\t- [ ] Current child',
				'- [ ] Task below',
			];
			// Must find parent at index 0 (above), not index 2 (below)
			expect(handler.findParentTask(lines, 1)).toBe(0);
		});

		it('returns null when indented task is first line with a potential parent below', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'\t- [ ] Indented child',
				'- [ ] Would-be parent below',
			];
			// No parent exists above index 0 — must return null,
			// even though a lower-indent task exists below
			expect(handler.findParentTask(lines, 0)).toBeNull();
		});
	});

	describe('processLine', () => {
		it('adds ID to parent and dependency to child on indent', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set<string>();

			handler.processLine(editor, 1, existingIds);

			// Parent should now have an ID
			const parentLine = lines[0]!;
			expect(parentLine).toMatch(/🆔 [a-z0-9]{6}/);

			// Child should now have a dependency matching the parent's ID
			const parentId = parentLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[1]).toContain(`⛔ ${parentId}`);
		});

		it('reuses existing parent ID instead of generating a new one', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent \u{1F194} abc123',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			handler.processLine(editor, 1, existingIds);

			// Parent ID unchanged
			expect(lines[0]).toBe('- [ ] Parent \u{1F194} abc123');
			// Child gets dependency on existing parent ID
			expect(lines[1]).toContain('\u26D4 abc123');
		});

		it('does not modify a non-task line', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\tSome text',
			];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 1, new Set());

			expect(lines[0]).toBe('- [ ] Parent');
			expect(lines[1]).toBe('\tSome text');
		});

		it('does not modify a root-level task', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Root task'];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 0, new Set());

			expect(lines[0]).toBe('- [ ] Root task');
		});

		it('does not duplicate an existing dependency', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent \u{1F194} abc123',
				'\t- [ ] Child \u26D4 abc123',
			];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toBe('\t- [ ] Child \u26D4 abc123');
		});

		it('adds the new ID to existingIds set', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set<string>();

			handler.processLine(editor, 1, existingIds);

			expect(existingIds.size).toBe(1);
		});

		it('does not call setLine for a line beyond lineCount', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);

			// Process a line index that's out of bounds
			handler.processLine(editor, 5, new Set());

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('does not modify lines when processing an empty editor', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines: string[] = [];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 0, new Set());

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('handles child with existing dep on different parent gracefully', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] New Parent',
				'\t- [ ] Child \u26D4 oldid1',
			];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 1, new Set(['oldid1']));

			// Should add new parent's ID + dependency, keeping old dep
			const parentLine = lines[0]!;
			expect(parentLine).toMatch(/🆔 [a-z0-9]{6}/);
			const newParentId = parentLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[1]).toContain(`\u26D4 ${newParentId}`);
			// Old dep preserved
			expect(lines[1]).toContain('\u26D4 oldid1');
		});
	});
});
