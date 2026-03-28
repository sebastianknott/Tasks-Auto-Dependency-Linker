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

		it('skips non-task lines', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const lines = [
				'- [ ] Parent',
				'Some text',
				'\t- [ ] Child',
			];
			const map = handler.buildRelationshipMap(lines);
			expect(map.get(2)).toBe(0);
			expect(map.size).toBe(1);
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
	});
});
