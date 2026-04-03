import { describe, it, expect, vi } from 'vitest';
import { RelationshipAnalyzer } from '../src/relationship-analyzer';
import { TaskParser } from '../src/task-parser';

describe('RelationshipAnalyzer', () => {
	const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);

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
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, lineIndex)).toBe(expected);
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
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.buildRelationshipMap(lines)).toEqual(expectedMap);
		});

		it('maps child to parent based on indentation', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = ['- [ ] Parent', '\t- [ ] Child'];
			const map = analyzer.buildRelationshipMap(lines);
			expect(map.get(1)).toBe(0);
			expect(map.size).toBe(1);
		});

		it('maps multi-level hierarchy', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = [
				'- [ ] Grandparent',
				'\t- [ ] Parent',
				'\t\t- [ ] Child',
			];
			const map = analyzer.buildRelationshipMap(lines);
			expect(map.get(1)).toBe(0);
			expect(map.get(2)).toBe(1);
			expect(map.size).toBe(2);
		});

		it('calls findParentTask exactly once per line', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = ['- [ ] Parent', '\t- [ ] Child'];
			const spy = vi.spyOn(analyzer, 'findParentTask');
			analyzer.buildRelationshipMap(lines);
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
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.identifyListBlocks(lines)).toEqual(expectedBlocks);
		});

		it('does not access beyond the lines array bounds', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = ['- [ ] Task A', '- [ ] Task B'];
			const spy = vi.spyOn(parser, 'isListItem');
			analyzer.identifyListBlocks(lines);
			expect(spy).toHaveBeenCalledTimes(2);
			spy.mockRestore();
		});
	});

	describe('getDesiredDepsForParent', () => {
		it('returns empty set when parent has no children', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = ['- [ ] Lonely parent'];
			const relationships = new Map<number, number>();
			const deps = analyzer.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.size).toBe(0);
		});

		it('returns child IDs for a parent', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const relationships = new Map([[1, 0]]);
			const deps = analyzer.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.has('abc123')).toBe(true);
			expect(deps.size).toBe(1);
		});

		it('skips children without an ID', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child no ID',
			];
			const relationships = new Map([[1, 0]]);
			const deps = analyzer.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.size).toBe(0);
		});

		it('returns multiple child IDs', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child A \u{1F194} aaa111',
				'\t- [ ] Child B \u{1F194} bbb222',
			];
			const relationships = new Map([[1, 0], [2, 0]]);
			const deps = analyzer.getDesiredDepsForParent(lines, 0, relationships);
			expect(deps.has('aaa111')).toBe(true);
			expect(deps.has('bbb222')).toBe(true);
			expect(deps.size).toBe(2);
		});

		it('only returns children for the specified parent', () => {
			const analyzer = new RelationshipAnalyzer(parser);
			const lines = [
				'- [ ] Parent A',
				'\t- [ ] Child of A \u{1F194} aaa111',
				'- [ ] Parent B',
				'\t- [ ] Child of B \u{1F194} bbb222',
			];
			const relationships = new Map([[1, 0], [3, 2]]);
			const depsA = analyzer.getDesiredDepsForParent(lines, 0, relationships);
			expect(depsA.has('aaa111')).toBe(true);
			expect(depsA.size).toBe(1);
			const depsB = analyzer.getDesiredDepsForParent(lines, 2, relationships);
			expect(depsB.has('bbb222')).toBe(true);
			expect(depsB.size).toBe(1);
		});
	});
});
