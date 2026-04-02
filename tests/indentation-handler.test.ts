import { describe, it, expect, vi } from 'vitest';
import { IndentationHandler } from '../src/indentation-handler';
import { EditorProcessor, type MarkerCacheLike } from '../src/editor-processor';
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
		it.each<[string, string[], number, number | null]>([
			[
				'returns null when the line is at root level',
				['- [ ] Root task'],
				0,
				null,
			],
			[
				'finds the immediate parent task above',
				['- [ ] Parent', '\t- [ ] Child'],
				1,
				0,
			],
			[
				'stops at a list boundary (non-list text between tasks)',
				['- [ ] Parent', 'Some text', '\t- [ ] Child'],
				2,
				null,
			],
			[
				'finds the correct parent at multiple indent levels',
				['- [ ] Grandparent', '\t- [ ] Parent', '\t\t- [ ] Child'],
				2,
				1,
			],
			[
				'returns null when no parent task exists above',
				['Some text', '\t- [ ] Indented task'],
				1,
				null,
			],
			[
				'returns null for a non-task line',
				['- [ ] Task', '\tSome indented text'],
				1,
				null,
			],
			[
				'skips tasks at the same indent level (siblings)',
				['- [ ] Parent', '\t- [ ] Sibling A', '\t- [ ] Sibling B'],
				2,
				0,
			],
			[
				'returns null at line 0',
				['\t- [ ] Indented at top'],
				0,
				null,
			],
			[
				'returns null for root-level task even when tasks exist below',
				['- [ ] Root', '\t- [ ] Child below'],
				0,
				null,
			],
			[
				'returns null for a second root-level task after another root task',
				['- [ ] First root', '- [ ] Second root'],
				1,
				null,
			],
			[
				'finds parent directly above, not below',
				['- [ ] Parent above', '\t- [ ] Current child', '- [ ] Task below'],
				1,
				0,
			],
			[
				'returns null when indented task is first line with a potential parent below',
				['\t- [ ] Indented child', '- [ ] Would-be parent below'],
				0,
				null,
			],
			[
				'stops at a list boundary (blank line between lists)',
				['- [ ] Parent in list A', '', '\t- [ ] Child in list B'],
				2,
				null,
			],
			[
				'stops at a list boundary (heading between lists)',
				['- [ ] Parent in list A', '## Section Two', '\t- [ ] Child in list B'],
				2,
				null,
			],
			[
				'allows non-task list items within the same list',
				['- [ ] Parent task', '- plain bullet', '\t- [ ] Child task'],
				2,
				0,
			],
			[
				'stops at whitespace-only line (list boundary)',
				['- [ ] Parent', '   ', '\t- [ ] Child'],
				2,
				null,
			],
		])('%s', (_description, lines, lineIndex, expected) => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.findParentTask(lines, lineIndex)).toBe(expected);
		});
	});

	describe('buildRelationshipMap', () => {
		it.each<[string, string[], Map<number, number>]>([
			[
				'returns empty map for no lines',
				[],
				new Map(),
			],
			[
				'returns empty map for root-level tasks only',
				['- [ ] A', '- [ ] B'],
				new Map(),
			],
			[
				'does not link across a list boundary (non-list text)',
				['- [ ] Parent', 'Some text', '\t- [ ] Child'],
				new Map(),
			],
		])('%s', (_description, lines, expectedMap) => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.buildRelationshipMap(lines)).toEqual(expectedMap);
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
		it.each<[string, string[], Array<{ start: number; end: number }>]>([
			[
				'returns empty array for no lines',
				[],
				[],
			],
			[
				'returns one block for a single list item',
				['- [ ] Task'],
				[{ start: 0, end: 1 }],
			],
			[
				'returns one block for two consecutive list items',
				['- [ ] Task A', '\t- [ ] Task B'],
				[{ start: 0, end: 2 }],
			],
			[
				'returns two blocks separated by a blank line',
				['- [ ] Task A', '', '- [ ] Task B'],
				[{ start: 0, end: 1 }, { start: 2, end: 3 }],
			],
			[
				'returns two blocks separated by a heading',
				['- [ ] Task A', '## Section', '- [ ] Task B'],
				[{ start: 0, end: 1 }, { start: 2, end: 3 }],
			],
			[
				'excludes non-list content at start and end',
				['# Heading', '- [ ] Task A', '- [ ] Task B', 'Some paragraph'],
				[{ start: 1, end: 3 }],
			],
			[
				'includes non-task list items in the same block',
				['- [ ] Task A', '- plain bullet', '- [ ] Task B'],
				[{ start: 0, end: 3 }],
			],
			[
				'handles multiple blocks with non-list content between them',
				['- [ ] List 1 task A', '\t- [ ] List 1 task B', '', '# Heading', '- [ ] List 2 task A', '- [ ] List 2 task B'],
				[{ start: 0, end: 2 }, { start: 4, end: 6 }],
			],
		])('%s', (_description, lines, expectedBlocks) => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.identifyListBlocks(lines)).toEqual(expectedBlocks);
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
		it.each<[string, string, Set<string>, string]>([
			[
				'returns line unchanged when all deps are desired',
				'- [ ] Parent ⛔ abc123',
				new Set(['abc123']),
				'- [ ] Parent ⛔ abc123',
			],
			[
				'removes deps not in desired set',
				'- [ ] Parent ⛔ abc123,def456',
				new Set(['def456']),
				'- [ ] Parent ⛔ def456',
			],
			[
				'removes all deps when desired set is empty',
				'- [ ] Parent ⛔ abc123,def456',
				new Set(),
				'- [ ] Parent',
			],
			[
				'returns line unchanged when no deps exist',
				'- [ ] Parent',
				new Set(),
				'- [ ] Parent',
			],
		])('%s', (_description, line, desiredSet, expected) => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.removeStaleDeps(line, desiredSet)).toBe(expected);
		});
	});

	describe('isIdReferencedAsDep', () => {
		it.each<[string, string[], string, boolean]>([
			[
				'returns true when a line has ⛔ for the ID',
				['- [ ] Parent ⛔ abc123'],
				'abc123',
				true,
			],
			[
				'returns false when no line has ⛔ for the ID',
				['- [ ] Parent ⛔ def456'],
				'abc123',
				false,
			],
			[
				'returns false for empty lines array',
				[],
				'abc123',
				false,
			],
			[
				'searches across multiple lines',
				['- [ ] Task A', '- [ ] Task B ⛔ abc123'],
				'abc123',
				true,
			],
		])('%s', (_description, lines, id, expected) => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.isIdReferencedAsDep(lines, id)).toBe(expected);
		});
	});

	describe('getTaskId', () => {
		it.each<[string, string, string | null]>([
			['delegates to TaskParser and returns the ID', '- [ ] Task 🆔 abc123', 'abc123'],
			['returns null when no ID exists', '- [ ] No ID', null],
		])('%s', (_description, input, expected) => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.getTaskId(input)).toBe(expected);
		});
	});

	describe('removeIdFromLine', () => {
		it.each<[string, string, string]>([
			['delegates to TaskParser and removes the ID', '- [ ] Task 🆔 abc123', '- [ ] Task'],
			['returns line unchanged when no ID exists', '- [ ] No ID', '- [ ] No ID'],
		])('%s', (_description, input, expected) => {
			const handler = new IndentationHandler(parser, idEngine);
			expect(handler.removeIdFromLine(input)).toBe(expected);
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

function createIdCache(ids: Set<string>, excludedIds?: Set<string>): MarkerCacheLike {
	return {
		getAll: () => ids,
		getAllExcluding: () => excludedIds ?? new Set<string>(),
	};
}

function createDepCache(deps?: Set<string>): MarkerCacheLike {
	return {
		getAll: () => deps ?? new Set<string>(),
		getAllExcluding: () => new Set<string>(),
	};
}

describe('EditorProcessor', () => {
	const parser = new TaskParser(DEFAULT_INDENT_CONFIG);
	const idEngine = new IdEngine();

	it('processes all lines in the editor', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const existingIds = new Set<string>();
		const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
		const lines = [
			'- [ ] Parent',
			'\t- [ ] Child',
		];
		const editor = createMockEditor(lines);

		processor.processAllLines(editor, '');

		// Child should have an ID (it blocks the parent)
		expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
		// Parent should have a dependency on the child
		const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
		expect(lines[0]).toContain(`⛔ ${childId}`);
	});

	it('does nothing for an empty editor', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const existingIds = new Set<string>();
		const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
		const lines: string[] = [];
		const editor = createMockEditor(lines);

		processor.processAllLines(editor, '');

		expect(editor.setLine).not.toHaveBeenCalled();
	});

	it('processes a multi-level hierarchy', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const existingIds = new Set<string>();
		const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
		const lines = [
			'- [ ] Grandparent',
			'\t- [ ] Parent',
			'\t\t- [ ] Child',
		];
		const editor = createMockEditor(lines);

		processor.processAllLines(editor, '');

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
		const processor = new EditorProcessor(handler, createIdCache(new Set<string>()), createDepCache());
		const lines = [
			'- [ ] Task A',
			'- [ ] Task B',
			'\t- [ ] Task C',
		];
		const editor = createMockEditor(lines);

		processor.processAllLines(editor, '');

		expect(spy).toHaveBeenCalledTimes(3);
		spy.mockRestore();
	});

	it('skips non-task lines without modifying them', () => {
		const handler = new IndentationHandler(parser, idEngine);
		const existingIds = new Set<string>();
		const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
		const lines = [
			'# Heading',
			'- [ ] Root task',
			'Some text',
		];
		const editor = createMockEditor(lines);

		processor.processAllLines(editor, '');

		expect(lines[0]).toBe('# Heading');
		expect(lines[1]).toBe('- [ ] Root task');
		expect(lines[2]).toBe('Some text');
	});

	describe('unindent cleanup', () => {
		it('removes stale ⛔ from former parent when child is unindented to root', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Scenario: child was previously under parent and has 🆔, parent has ⛔.
			// Now the child is at root level (unindented).
			const lines = [
				'- [ ] Former parent ⛔ abc123',
				'- [ ] Former child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// The child is no longer indented under the parent.
			// Parent should have ⛔ abc123 removed.
			expect(lines[0]).toBe('- [ ] Former parent');
			// Child has no parent, and no line references its ID via ⛔,
			// so the 🆔 should be removed too.
			expect(lines[1]).toBe('- [ ] Former child');
		});

		it('moves ⛔ from old parent to new parent when child is re-indented', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Child was under OldParent, now indented under NewParent instead
			const lines = [
				'- [ ] Old parent ⛔ abc123',
				'- [ ] New parent',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// Old parent should no longer have ⛔ abc123
			expect(lines[0]).not.toContain('⛔ abc123');
			// New parent should have ⛔ abc123
			expect(lines[1]).toContain('⛔ abc123');
			// Child keeps its 🆔
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('removes orphaned 🆔 when no line in document has ⛔ referencing it', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// A root-level task has an 🆔 but nobody has ⛔ for it
			const lines = [
				'- [ ] Task with orphaned ID 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// 🆔 should be removed since no ⛔ references it
			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('keeps 🆔 when another line still has ⛔ referencing it', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// 🆔 should be preserved because the parent still depends on it
			expect(lines[1]).toContain('🆔 abc123');
			expect(lines[0]).toContain('⛔ abc123');
		});

		it('removes stale ⛔ but keeps valid ⛔ on the same parent', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123', 'def456']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Parent has two deps. Child def456 is still indented under parent.
			// abc123 used to be a child but is now a separate root-level task.
			const lines = [
				'- [ ] Parent ⛔ abc123,def456',
				'\t- [ ] Current child 🆔 def456',
				'- [ ] Former child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// Parent should no longer have ⛔ abc123 (child unindented)
			expect(lines[0]).not.toContain('⛔ abc123');
			// Parent should still have ⛔ def456 (child still indented)
			expect(lines[0]).toContain('⛔ def456');
			// Former child 🆔 removed (orphaned)
			expect(lines[2]).not.toContain('🆔 abc123');
		});

		it('handles child moved from one parent to another in multi-level hierarchy', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['child1']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Parent A ⛔ child1',
				'- [ ] Parent B',
				'\t- [ ] Child 🆔 child1',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// Parent A should lose ⛔ child1
			expect(lines[0]).not.toContain('⛔ child1');
			// Parent B should gain ⛔ child1
			expect(lines[1]).toContain('⛔ child1');
			// Child keeps its 🆔
			expect(lines[2]).toContain('🆔 child1');
		});

		it('does not remove ⛔ that corresponds to a valid child', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// ⛔ is valid because the child is still indented under parent
			expect(lines[0]).toContain('⛔ abc123');
			expect(lines[1]).toContain('🆔 abc123');
		});

		it('removes orphaned 🆔 from multiple tasks', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['aaa111', 'bbb222']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// Neither has a parent with ⛔, so both 🆔 should be removed
			expect(lines[0]).toBe('- [ ] Task A');
			expect(lines[1]).toBe('- [ ] Task B');
		});

		it('does not call setLine during orphan cleanup when no 🆔 needs removal', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Parent has ⛔ for child, child has 🆔. All is correct, nothing to clean
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// setLine should have been called exactly 0 times in pass 2
			// (pass 1 also doesn't change anything since markers are correct)
			// The child already has 🆔 and parent already has ⛔
			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('README example: multi-level re-parent with spaces indentation', () => {
			// Uses 4-space indentation as shown in the README
			const spaceParser = new TaskParser({ useTab: false, tabSize: 4 });
			const handler = new IndentationHandler(spaceParser, idEngine);
			const existingIds = new Set(['abc444', 'abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());

			// "Before" state from README: Design API schema was under Build backend
			// User outdented Design API schema to be a sibling of Build backend
			// ⛔ appears before 🆔 (as it might from manual edits or other tools)
			const lines = [
				'- [ ] Write tests ⛔ abc444',
				'    - [ ] Build backend ⛔ abc123 🆔 abc444',
				'    - [ ] Design API schema 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

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
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Task A in list 1 has 🆔 abc123, task B in list 2 has ⛔ abc123.
			// Cross-list reference: the plugin should NOT touch either marker.
			const lines = [
				'- [ ] Task A 🆔 abc123',
				'',
				'- [ ] Task B ⛔ abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// 🆔 on Task A must be preserved since it's in a different list from ⛔
			expect(lines[0]).toContain('🆔 abc123');
			// ⛔ on Task B must be preserved since it's in a different list
			expect(lines[2]).toContain('⛔ abc123');
		});

		it('does not remove ⛔ from task in list A when referenced 🆔 is in list B', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Parent in list 1 has ⛔ abc123, child in list 2 has 🆔 abc123.
			// Cross-list: plugin should not touch either marker.
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'## Section Two',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// ⛔ on Parent must be preserved (cross-list reference)
			expect(lines[0]).toContain('⛔ abc123');
			// 🆔 on Child must be preserved (cross-list reference)
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('two separate lists each get independent dependency management', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set<string>();
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Parent A',
				'\t- [ ] Child A',
				'',
				'- [ ] Parent B',
				'\t- [ ] Child B',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

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
			const existingIds = new Set<string>();
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Parent in list A',
				'# Heading',
				'\t- [ ] Child in list B',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// Child should NOT get linked to Parent (different lists)
			expect(lines[0]).not.toContain('⛔');
			expect(lines[2]).not.toContain('🆔');
		});
	});

	describe('deleted child cleanup', () => {
		it('removes ⛔ from parent when child task line was deleted', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set<string>();
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Scenario: child task was deleted, but parent still has ⛔ referencing
			// the deleted child's ID. No 🆔 abc123 exists anywhere in the document.
			const lines = [
				'- [ ] Parent ⛔ abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// ⛔ abc123 should be removed because no 🆔 abc123 exists in document
			expect(lines[0]).toBe('- [ ] Parent');
		});

		it('removes only the deleted child dep while keeping valid deps', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['def456']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Parent has two deps. Child def456 still exists, abc123 was deleted.
			const lines = [
				'- [ ] Parent ⛔ abc123,def456',
				'\t- [ ] Remaining child 🆔 def456',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// abc123 should be removed (no 🆔 exists), def456 should stay
			expect(lines[0]).toContain('⛔ def456');
			expect(lines[0]).not.toContain('abc123');
		});

		it('removes ⛔ for deleted child even when not in managedIds', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set<string>();
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// The deleted child's 🆔 is gone from the block, so its ID won't be
			// in blockIds (managedIds). The cleanup should still remove it.
			const lines = [
				'- [ ] Parent ⛔ deleted1',
				'\t- [ ] Child A',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// ⛔ deleted1 references a non-existent 🆔 and must be removed
			expect(lines[0]).not.toContain('deleted1');
		});

		it('preserves ⛔ when referenced 🆔 exists in another vault file (cross-file)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			// ⛔ abc123 has no local 🆔, but it exists in another vault file
			const existingIds = new Set(['abc123']); // exists in vault
			const otherVaultIds = new Set(['abc123']); // exists in another file
			const processor = new EditorProcessor(handler, createIdCache(existingIds, otherVaultIds), createDepCache());
			const lines = [
				'- [ ] Parent ⛔ abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, 'current.md');

			// ⛔ preserved because 🆔 exists in another vault file
			expect(lines[0]).toContain('⛔ abc123');
		});

		it('removes ⛔ when referenced 🆔 does not exist in vault either', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set<string>(); // ghost1 not in vault
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Parent ⛔ ghost1',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// ⛔ ghost1 references a completely non-existent 🆔, so remove it
			expect(lines[0]).toBe('- [ ] Parent');
		});

		it('preserves ⛔ when 🆔 exists in document but not in existingIds', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set<string>(); // not in vault cache
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// The ⛔ references an 🆔 that exists in the DOCUMENT (different block)
			// but is not in existingIds. The documentIds scan should find it.
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'',
				'- [ ] Other task 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// ⛔ preserved because 🆔 abc123 exists in the document
			expect(lines[0]).toContain('⛔ abc123');
		});

		it('removes dangling ⛔ from non-first line in a list block', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set<string>();
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			// Second line (bi=1) has a dangling ⛔ for a deleted child
			const lines = [
				'- [ ] Parent A',
				'\t- [ ] Parent B ⛔ deleted1',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// ⛔ deleted1 on second line should be removed (no 🆔 deleted1 exists)
			expect(lines[1]).not.toContain('deleted1');
		});
	});

	describe('cross-file vault dep IDs', () => {
		it('does not remove 🆔 when the ID is in vaultDepIds (cross-file reference)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			// A root-level task has 🆔 abc123 but no ⛔ in this document.
			// However, abc123 IS referenced by ⛔ in another file (vaultDepIds).
			const existingIds = new Set(['abc123']);
			const vaultDepIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache(vaultDepIds));
			const lines = [
				'- [ ] Task with cross-file dep 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// 🆔 should be preserved because it's referenced in another vault file
			expect(lines[0]).toContain('🆔 abc123');
		});

		it('removes 🆔 when the ID is NOT in vaultDepIds and no local ⛔ exists', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const vaultDepIds = new Set<string>(); // empty, no cross-file refs
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache(vaultDepIds));
			const lines = [
				'- [ ] Task with orphaned ID 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// 🆔 should be removed since there is no local or vault-wide reference
			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('works correctly when depCache returns empty set (no cross-file refs)', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache());
			const lines = [
				'- [ ] Task with orphaned ID 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			// depCache returns empty set, should behave as before (remove orphaned 🆔)
			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('preserves 🆔 when local ⛔ exists even if vaultDepIds is empty', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['abc123']);
			const vaultDepIds = new Set<string>(); // empty
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache(vaultDepIds));
			const lines = [
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// 🆔 preserved because local ⛔ references it
			expect(lines[1]).toContain('🆔 abc123');
		});

		it('preserves multiple 🆔 markers when their IDs are in vaultDepIds', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['aaa111', 'bbb222']);
			const vaultDepIds = new Set(['aaa111', 'bbb222']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache(vaultDepIds));
			const lines = [
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// Both 🆔 should be preserved because both are referenced in vault
			expect(lines[0]).toContain('🆔 aaa111');
			expect(lines[1]).toContain('🆔 bbb222');
		});

		it('removes only the 🆔 not in vaultDepIds when multiple tasks exist', () => {
			const handler = new IndentationHandler(parser, idEngine);
			const existingIds = new Set(['aaa111', 'bbb222']);
			// Only aaa111 is referenced in another file
			const vaultDepIds = new Set(['aaa111']);
			const processor = new EditorProcessor(handler, createIdCache(existingIds), createDepCache(vaultDepIds));
			const lines = [
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			];
			const editor = createMockEditor(lines);

			processor.processAllLines(editor, '');

			// aaa111 preserved (vault reference), bbb222 removed (orphaned)
			expect(lines[0]).toContain('🆔 aaa111');
			expect(lines[1]).toBe('- [ ] Task B');
		});
	});
});
