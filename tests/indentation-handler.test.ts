import { describe, it, expect, vi } from 'vitest';
import { IndentationHandler, EditorProcessor } from '../src/indentation-handler';
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
		it('adds ID to child and dependency to parent on indent', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set<string>();

			handler.processLine(editor, 1, existingIds);

			// Child should now have an ID (it blocks the parent)
			const childLine = lines[1]!;
			expect(childLine).toMatch(/🆔 [a-z0-9]{6}/);

			// Parent should now have a dependency matching the child's ID
			const childId = childLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[0]).toContain(`⛔ ${childId}`);
		});

		it('reuses existing child ID instead of generating a new one', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			handler.processLine(editor, 1, existingIds);

			// Child ID unchanged
			expect(lines[1]).toBe('\t- [ ] Child \u{1F194} abc123');
			// Parent gets dependency on existing child ID
			expect(lines[0]).toContain('\u26D4 abc123');
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
				'- [ ] Parent \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');
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
			// The ID should be on the child line
			const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(existingIds.has(childId)).toBe(true);
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

		it('handles parent with existing dep on different child gracefully', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent \u26D4 oldid1',
				'\t- [ ] New Child',
			];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 1, new Set(['oldid1']));

			// Should add new child's ID + dependency on parent, keeping old dep
			const childLine = lines[1]!;
			expect(childLine).toMatch(/🆔 [a-z0-9]{6}/);
			const newChildId = childLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[0]).toContain(`\u26D4 ${newChildId}`);
			// Old dep preserved
			expect(lines[0]).toContain('\u26D4 oldid1');
		});
	});
});

describe('EditorProcessor', () => {
	const parser = new TaskParser(DEFAULT_INDENT_CONFIG);
	const idEngine = new IdEngine();

	it('processes all lines in the editor', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const processor = new EditorProcessor(handler);
		const lines = [
			'- [ ] Parent',
			'\t- [ ] Child',
		];
		const editor = createMockEditor(lines);
		const existingIds = new Set<string>();

		processor.processAllLines(editor, existingIds);

		// Child should have an ID (it blocks the parent)
		expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
		// Parent should have a dependency on the child
		const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
		expect(lines[0]).toContain(`⛔ ${childId}`);
	});

	it('does nothing for an empty editor', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const processor = new EditorProcessor(handler);
		const lines: string[] = [];
		const editor = createMockEditor(lines);
		const existingIds = new Set<string>();

		processor.processAllLines(editor, existingIds);

		expect(editor.setLine).not.toHaveBeenCalled();
	});

	it('processes a multi-level hierarchy', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const processor = new EditorProcessor(handler);
		const lines = [
			'- [ ] Grandparent',
			'\t- [ ] Parent',
			'\t\t- [ ] Child',
		];
		const editor = createMockEditor(lines);
		const existingIds = new Set<string>();

		processor.processAllLines(editor, existingIds);

		// Parent should have an ID (it blocks grandparent)
		expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
		// Grandparent should have a dep on parent
		const parentId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
		expect(lines[0]).toContain(`⛔ ${parentId}`);
		// Child should have an ID (it blocks parent)
		expect(lines[2]).toMatch(/🆔 [a-z0-9]{6}/);
		const childId = lines[2]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
		// Parent should have a dep on child
		expect(lines[1]).toContain(`⛔ ${childId}`);
	});

	it('calls processLine exactly lineCount times', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const spy = vi.spyOn(handler, 'processLine');
		const processor = new EditorProcessor(handler);
		const lines = [
			'- [ ] Task A',
			'- [ ] Task B',
			'\t- [ ] Task C',
		];
		const editor = createMockEditor(lines);

		processor.processAllLines(editor, new Set());

		expect(spy).toHaveBeenCalledTimes(3);
		spy.mockRestore();
	});

	it('skips non-task lines without modifying them', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const processor = new EditorProcessor(handler);
		const lines = [
			'# Heading',
			'- [ ] Root task',
			'Some text',
		];
		const editor = createMockEditor(lines);
		const existingIds = new Set<string>();

		processor.processAllLines(editor, existingIds);

		expect(lines[0]).toBe('# Heading');
		expect(lines[1]).toBe('- [ ] Root task');
		expect(lines[2]).toBe('Some text');
	});
});
