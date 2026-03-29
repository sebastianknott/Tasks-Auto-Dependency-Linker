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

		it('stops at a list boundary (non-list text between tasks)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'Some text',
				'\t- [ ] Child',
			];
			// 'Some text' is not a list item — it's a list boundary
			expect(handler.findParentTask(lines, 2)).toBeNull();
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

		it('stops at a list boundary (blank line between lists)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent in list A',
				'',
				'\t- [ ] Child in list B',
			];
			// Blank line is a list boundary — child should NOT find parent
			expect(handler.findParentTask(lines, 2)).toBeNull();
		});

		it('stops at a list boundary (heading between lists)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent in list A',
				'## Section Two',
				'\t- [ ] Child in list B',
			];
			// Heading is a list boundary — child should NOT find parent
			expect(handler.findParentTask(lines, 2)).toBeNull();
		});

		it('allows non-task list items within the same list', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent task',
				'- plain bullet',
				'\t- [ ] Child task',
			];
			// '- plain bullet' is a list item (not a boundary), so the
			// search continues upward and finds the parent task at index 0
			expect(handler.findParentTask(lines, 2)).toBe(0);
		});

		it('stops at whitespace-only line (list boundary)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'   ',
				'\t- [ ] Child',
			];
			// Whitespace-only line is not a list item — it's a boundary
			expect(handler.findParentTask(lines, 2)).toBeNull();
		});
	});

	describe('buildRelationshipMap', () => {
		it('returns empty map for no lines', () => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.buildRelationshipMap([])).toEqual(new Map());
		});

		it('returns empty map for root-level tasks only', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] A', '- [ ] B'];
			expect(handler.buildRelationshipMap(lines)).toEqual(new Map());
		});

		it('maps child to parent based on indentation', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Parent', '\t- [ ] Child'];
			const map = handler.buildRelationshipMap(lines);
			expect(map.get(1)).toBe(0);
			expect(map.size).toBe(1);
		});

		it('maps multi-level hierarchy', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Grandparent',
				'\t- [ ] Parent',
				'\t\t- [ ] Child',
			];
			const map = handler.buildRelationshipMap(lines);
			expect(map.get(1)).toBe(0);
			expect(map.get(2)).toBe(1);
			expect(map.size).toBe(2);
		});

		it('does not link across a list boundary (non-list text)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'Some text',
				'\t- [ ] Child',
			];
			const map = handler.buildRelationshipMap(lines);
			// 'Some text' is a list boundary — child cannot find parent
			expect(map.size).toBe(0);
		});

		it('does not access beyond the lines array bounds', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const spy = vi.spyOn(handler, 'findParentTask');
			handler.buildRelationshipMap(lines);
			// Should be called exactly lines.length times (0 and 1), not 3
			expect(spy).toHaveBeenCalledTimes(2);
			spy.mockRestore();
		});
	});

	describe('identifyListBlocks', () => {
		it('returns empty array for no lines', () => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.identifyListBlocks([])).toEqual([]);
		});

		it('returns one block for a single list item', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Task'];
			expect(handler.identifyListBlocks(lines)).toEqual([{ start: 0, end: 1 }]);
		});

		it('returns one block for two consecutive list items', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Task A', '\t- [ ] Task B'];
			expect(handler.identifyListBlocks(lines)).toEqual([{ start: 0, end: 2 }]);
		});

		it('returns two blocks separated by a blank line', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Task A',
				'',
				'- [ ] Task B',
			];
			expect(handler.identifyListBlocks(lines)).toEqual([
				{ start: 0, end: 1 },
				{ start: 2, end: 3 },
			]);
		});

		it('returns two blocks separated by a heading', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Task A',
				'## Section',
				'- [ ] Task B',
			];
			expect(handler.identifyListBlocks(lines)).toEqual([
				{ start: 0, end: 1 },
				{ start: 2, end: 3 },
			]);
		});

		it('excludes non-list content at start and end', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'# Heading',
				'- [ ] Task A',
				'- [ ] Task B',
				'Some paragraph',
			];
			expect(handler.identifyListBlocks(lines)).toEqual([
				{ start: 1, end: 3 },
			]);
		});

		it('includes non-task list items in the same block', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Task A',
				'- plain bullet',
				'- [ ] Task B',
			];
			expect(handler.identifyListBlocks(lines)).toEqual([
				{ start: 0, end: 3 },
			]);
		});

		it('handles multiple blocks with non-list content between them', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] List 1 task A',
				'\t- [ ] List 1 task B',
				'',
				'# Heading',
				'- [ ] List 2 task A',
				'- [ ] List 2 task B',
			];
			expect(handler.identifyListBlocks(lines)).toEqual([
				{ start: 0, end: 2 },
				{ start: 4, end: 6 },
			]);
		});

		it('does not access beyond the lines array bounds', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Task A', '- [ ] Task B'];
			const spy = vi.spyOn(parser, 'isListItem');
			handler.identifyListBlocks(lines);
			// Should be called exactly lines.length times, not more
			expect(spy).toHaveBeenCalledTimes(2);
			spy.mockRestore();
		});
	});

	describe('getDesiredDepsForParent', () => {
		it('returns empty set when parent has no children', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Lonely parent'];
			const relationships = new Map<number, number>();
			const deps = handler.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.size).toBe(0);
		});

		it('returns child IDs for a parent', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child 🆔 abc123',
			];
			const relationships = new Map([[1, 0]]);
			const deps = handler.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.has('abc123')).toBe(true);
			expect(deps.size).toBe(1);
		});

		it('skips children without an ID', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child no ID',
			];
			const relationships = new Map([[1, 0]]);
			const deps = handler.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.size).toBe(0);
		});

		it('returns multiple child IDs', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child A 🆔 aaa111',
				'\t- [ ] Child B 🆔 bbb222',
			];
			const relationships = new Map([[1, 0], [2, 0]]);
			const deps = handler.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.has('aaa111')).toBe(true);
			expect(deps.has('bbb222')).toBe(true);
			expect(deps.size).toBe(2);
		});

		it('only returns children for the specified parent', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent A',
				'\t- [ ] Child of A 🆔 aaa111',
				'- [ ] Parent B',
				'\t- [ ] Child of B 🆔 bbb222',
			];
			const relationships = new Map([[1, 0], [3, 2]]);
			const depsA = handler.getDesiredDepsForParent(lines, 0, relationships);
			expect(depsA.has('aaa111')).toBe(true);
			expect(depsA.size).toBe(1);
			const depsB = handler.getDesiredDepsForParent(lines, 2, relationships);
			expect(depsB.has('bbb222')).toBe(true);
			expect(depsB.size).toBe(1);
		});
	});

	describe('removeStaleDeps', () => {
		it('returns line unchanged when all deps are desired', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const line = '- [ ] Parent ⛔ abc123';
			const result = handler.removeStaleDeps(line, new Set(['abc123']));
			expect(result).toBe(line);
		});

		it('removes deps not in desired set', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const line = '- [ ] Parent ⛔ abc123,def456';
			const result = handler.removeStaleDeps(line, new Set(['def456']));
			expect(result).toBe('- [ ] Parent ⛔ def456');
		});

		it('removes all deps when desired set is empty', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const line = '- [ ] Parent ⛔ abc123,def456';
			const result = handler.removeStaleDeps(line, new Set());
			expect(result).toBe('- [ ] Parent');
		});

		it('returns line unchanged when no deps exist', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const line = '- [ ] Parent';
			const result = handler.removeStaleDeps(line, new Set());
			expect(result).toBe(line);
		});
	});

	describe('isIdReferencedAsDep', () => {
		it('returns true when a line has ⛔ for the ID', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Parent ⛔ abc123'];
			expect(handler.isIdReferencedAsDep(lines, 'abc123')).toBe(true);
		});

		it('returns false when no line has ⛔ for the ID', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = ['- [ ] Parent ⛔ def456'];
			expect(handler.isIdReferencedAsDep(lines, 'abc123')).toBe(false);
		});

		it('returns false for empty lines array', () => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.isIdReferencedAsDep([], 'abc123')).toBe(false);
		});

		it('searches across multiple lines', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Task A',
				'- [ ] Task B ⛔ abc123',
			];
			expect(handler.isIdReferencedAsDep(lines, 'abc123')).toBe(true);
		});
	});

	describe('getTaskId', () => {
		it('delegates to TaskParser and returns the ID', () => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.getTaskId('- [ ] Task 🆔 abc123')).toBe('abc123');
		});

		it('returns null when no ID exists', () => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.getTaskId('- [ ] No ID')).toBeNull();
		});
	});

	describe('removeIdFromLine', () => {
		it('delegates to TaskParser and removes the ID', () => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.removeIdFromLine('- [ ] Task 🆔 abc123')).toBe('- [ ] Task');
		});

		it('returns line unchanged when no ID exists', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const line = '- [ ] No ID';
			expect(handler.removeIdFromLine(line)).toBe(line);
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
				'- [ ] Parent ⛔ oldid1',
				'\t- [ ] New Child',
			];
			const editor = createMockEditor(lines);

			handler.processLine(editor, 1, new Set(['oldid1']));

			// Should add new child's ID + dependency on parent, keeping old dep
			const childLine = lines[1]!;
			expect(childLine).toMatch(/🆔 [a-z0-9]{6}/);
			const newChildId = childLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			// New format: comma-separated deps after single ⛔
			const parentDeps = parser.getTaskDependencies(lines[0]!);
			expect(parentDeps).toContain('oldid1');
			expect(parentDeps).toContain(newChildId);
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

	describe('unindent cleanup', () => {
		it('removes stale ⛔ from former parent when child is unindented to root', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// Scenario: child was previously under parent and has 🆔, parent has ⛔.
			// Now the child is at root level (unindented).
			const lines = [
				'- [ ] Former parent ⛔ abc123',
				'- [ ] Former child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// The child is no longer indented under the parent.
			// Parent should have ⛔ abc123 removed.
			expect(lines[0]).toBe('- [ ] Former parent');
			// Child has no parent, and no line references its ID via ⛔,
			// so the 🆔 should be removed too.
			expect(lines[1]).toBe('- [ ] Former child');
		});

		it('moves ⛔ from old parent to new parent when child is re-indented', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// Child was under OldParent, now indented under NewParent instead
			const lines = [
				'- [ ] Old parent ⛔ abc123',
				'- [ ] New parent',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// Old parent should no longer have ⛔ abc123
			expect(lines[0]).not.toContain('⛔ abc123');
			// New parent should have ⛔ abc123
			expect(lines[1]).toContain('⛔ abc123');
			// Child keeps its 🆔
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('removes orphaned 🆔 when no line in document has ⛔ referencing it', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// A root-level task has an 🆔 but nobody has ⛔ for it
			const lines = [
				'- [ ] Task with orphaned ID 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// 🆔 should be removed since no ⛔ references it
			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('keeps 🆔 when another line still has ⛔ referencing it', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// 🆔 should be preserved — parent still depends on it
			expect(lines[1]).toContain('🆔 abc123');
			expect(lines[0]).toContain('⛔ abc123');
		});

		it('removes stale ⛔ but keeps valid ⛔ on the same parent', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// Parent has two deps. Child def456 is still indented under parent.
			// abc123 used to be a child but is now a separate root-level task.
			const lines = [
				'- [ ] Parent ⛔ abc123,def456',
				'\t- [ ] Current child 🆔 def456',
				'- [ ] Former child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123', 'def456']);

			processor.processAllLines(editor, existingIds);

			// Parent should no longer have ⛔ abc123 (child unindented)
			expect(lines[0]).not.toContain('⛔ abc123');
			// Parent should still have ⛔ def456 (child still indented)
			expect(lines[0]).toContain('⛔ def456');
			// Former child 🆔 removed (orphaned)
			expect(lines[2]).not.toContain('🆔 abc123');
		});

		it('handles child moved from one parent to another in multi-level hierarchy', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Parent A ⛔ child1',
				'- [ ] Parent B',
				'\t- [ ] Child 🆔 child1',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['child1']);

			processor.processAllLines(editor, existingIds);

			// Parent A should lose ⛔ child1
			expect(lines[0]).not.toContain('⛔ child1');
			// Parent B should gain ⛔ child1
			expect(lines[1]).toContain('⛔ child1');
			// Child keeps its 🆔
			expect(lines[2]).toContain('🆔 child1');
		});

		it('does not remove ⛔ that corresponds to a valid child', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// ⛔ is valid — child is still indented under parent
			expect(lines[0]).toContain('⛔ abc123');
			expect(lines[1]).toContain('🆔 abc123');
		});

		it('removes orphaned 🆔 from multiple tasks', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['aaa111', 'bbb222']);

			processor.processAllLines(editor, existingIds);

			// Neither has a parent with ⛔, so both 🆔 should be removed
			expect(lines[0]).toBe('- [ ] Task A');
			expect(lines[1]).toBe('- [ ] Task B');
		});

		it('does not call setLine during orphan cleanup when no 🆔 needs removal', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// Parent has ⛔ for child, child has 🆔 — all is correct, nothing to clean
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// setLine should have been called exactly 0 times in pass 2
			// (pass 1 also doesn't change anything since markers are correct)
			// The child already has 🆔 and parent already has ⛔
			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('README example: multi-level re-parent with spaces indentation', () => {
			// Uses 4-space indentation as shown in the README
			const spaceParser = new TaskParser({ useTab: false, tabSize: 4 });
			const handler = new IndentationHandler(spaceParser, idEngine);
			const processor = new EditorProcessor(handler);

			// "Before" state from README: Design API schema was under Build backend
			// User outdented Design API schema to be a sibling of Build backend
			// ⛔ appears before 🆔 (as it might from manual edits or other tools)
			const lines = [
				'- [ ] Write tests ⛔ abc444',
				'    - [ ] Build backend ⛔ abc123 🆔 abc444',
				'    - [ ] Design API schema 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc444', 'abc123']);

			processor.processAllLines(editor, existingIds);

			// Write tests should have ⛔ for both children: abc444 and abc123
			expect(lines[0]).toContain('⛔');
			const writeTestsDeps = spaceParser.getTaskDependencies(lines[0]!);
			expect(writeTestsDeps).toContain('abc444');
			expect(writeTestsDeps).toContain('abc123');
			// Build backend should lose ⛔ abc123 (Design API is no longer its child)
			expect(spaceParser.getTaskDependencies(lines[1]!)).not.toContain('abc123');
			// Build backend keeps 🆔 abc444 (Write tests still depends on it)
			expect(lines[1]).toContain('🆔 abc444');
			// Design API schema keeps 🆔 abc123 (Write tests now depends on it)
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('does not remove 🆔 from task in list A when only ⛔ reference is in list B', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// Task A in list 1 has 🆔 abc123, task B in list 2 has ⛔ abc123.
			// Cross-list reference: the plugin should NOT touch either marker.
			const lines = [
				'- [ ] Task A 🆔 abc123',
				'',
				'- [ ] Task B ⛔ abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// 🆔 on Task A must be preserved — it's in a different list from ⛔
			expect(lines[0]).toContain('🆔 abc123');
			// ⛔ on Task B must be preserved — it's in a different list
			expect(lines[2]).toContain('⛔ abc123');
		});

		it('does not remove ⛔ from task in list A when referenced 🆔 is in list B', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// Parent in list 1 has ⛔ abc123, child in list 2 has 🆔 abc123.
			// Cross-list: plugin should not touch either marker.
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'## Section Two',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds);

			// ⛔ on Parent must be preserved — cross-list reference
			expect(lines[0]).toContain('⛔ abc123');
			// 🆔 on Child must be preserved — cross-list reference
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('two separate lists each get independent dependency management', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Parent A',
				'\t- [ ] Child A',
				'',
				'- [ ] Parent B',
				'\t- [ ] Child B',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set<string>();

			processor.processAllLines(editor, existingIds);

			// List 1: Child A gets 🆔, Parent A gets ⛔
			expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
			const childAId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[0]).toContain(`⛔ ${childAId}`);

			// List 2: Child B gets 🆔, Parent B gets ⛔
			expect(lines[4]).toMatch(/🆔 [a-z0-9]{6}/);
			const childBId = lines[4]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[3]).toContain(`⛔ ${childBId}`);

			// Cross-list: Parent A should NOT have ⛔ for Child B
			expect(parser.getTaskDependencies(lines[0]!)).not.toContain(childBId);
			// Cross-list: Parent B should NOT have ⛔ for Child A
			expect(parser.getTaskDependencies(lines[3]!)).not.toContain(childAId);
		});

		it('task indented under heading does not get linked to parent in different list', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Parent in list A',
				'# Heading',
				'\t- [ ] Child in list B',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set<string>();

			processor.processAllLines(editor, existingIds);

			// Child should NOT get linked to Parent (different lists)
			expect(lines[0]).not.toContain('⛔');
			expect(lines[2]).not.toContain('🆔');
		});
	});

	describe('cross-file vault dep IDs', () => {
		it('does not remove 🆔 when the ID is in vaultDepIds (cross-file reference)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			// A root-level task has 🆔 abc123 but no ⛔ in this document.
			// However, abc123 IS referenced by ⛔ in another file (vaultDepIds).
			const lines = [
				'- [ ] Task with cross-file dep 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);
			const vaultDepIds = new Set(['abc123']);

			processor.processAllLines(editor, existingIds, vaultDepIds);

			// 🆔 should be preserved — it's referenced in another vault file
			expect(lines[0]).toContain('🆔 abc123');
		});

		it('removes 🆔 when the ID is NOT in vaultDepIds and no local ⛔ exists', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Task with orphaned ID 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);
			const vaultDepIds = new Set<string>(); // empty — no cross-file refs

			processor.processAllLines(editor, existingIds, vaultDepIds);

			// 🆔 should be removed — no local or vault-wide reference
			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('works correctly when vaultDepIds is undefined (backward compatible)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Task with orphaned ID 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			// No vaultDepIds passed — should behave as before (remove orphaned 🆔)
			processor.processAllLines(editor, existingIds);

			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('preserves 🆔 when local ⛔ exists even if vaultDepIds is empty', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);
			const vaultDepIds = new Set<string>(); // empty

			processor.processAllLines(editor, existingIds, vaultDepIds);

			// 🆔 preserved because local ⛔ references it
			expect(lines[1]).toContain('🆔 abc123');
		});

		it('preserves multiple 🆔 markers when their IDs are in vaultDepIds', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['aaa111', 'bbb222']);
			const vaultDepIds = new Set(['aaa111', 'bbb222']);

			processor.processAllLines(editor, existingIds, vaultDepIds);

			// Both 🆔 should be preserved — both referenced in vault
			expect(lines[0]).toContain('🆔 aaa111');
			expect(lines[1]).toContain('🆔 bbb222');
		});

		it('removes only the 🆔 not in vaultDepIds when multiple tasks exist', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const processor = new EditorProcessor(handler);
			const lines = [
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['aaa111', 'bbb222']);
			// Only aaa111 is referenced in another file
			const vaultDepIds = new Set(['aaa111']);

			processor.processAllLines(editor, existingIds, vaultDepIds);

			// aaa111 preserved (vault reference), bbb222 removed (orphaned)
			expect(lines[0]).toContain('🆔 aaa111');
			expect(lines[1]).toBe('- [ ] Task B');
		});
	});
});
