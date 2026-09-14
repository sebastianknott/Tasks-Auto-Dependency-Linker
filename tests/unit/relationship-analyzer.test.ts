import { describe, it, expect, vi } from 'vitest';
import { RelationshipAnalyzer } from '../../src/parsing/relationship-analyzer';
import type { TaskParser } from '../../src/parsing/task-parser';

interface FakeParser {
	isTaskLine: (line: string) => boolean;
	isListItem: (line: string) => boolean;
	getIndentLevel: (line: string) => number;
	getTaskId: (line: string) => string | null;
}

interface ParserStubConfig {
	taskLines?: readonly string[];
	listItems?: readonly string[];
	indentLevels?: Map<string, number>;
	taskIds?: Map<string, string | null>;
}

function createParser(config: ParserStubConfig): TaskParser {
	const taskLines = new Set(config.taskLines ?? []);
	const listItems = new Set(config.listItems ?? []);
	const indentLevels = config.indentLevels ?? new Map<string, number>();
	const taskIds = config.taskIds ?? new Map<string, string | null>();

	const fakeParser: FakeParser = {
		isTaskLine: vi.fn((line: string) => taskLines.has(line)),
		isListItem: vi.fn((line: string) => listItems.has(line)),
		getIndentLevel: vi.fn((line: string) => indentLevels.get(line) ?? 0),
		getTaskId: vi.fn((line: string) => taskIds.get(line) ?? null),
	};

	return fakeParser as unknown as TaskParser;
}

describe('RelationshipAnalyzer', () => {
	describe('findParentTask', () => {
		it('returns null when the line is at root level', () => {
			const line = '- [ ] Root task';
			const lines = [line];
			const parser = createParser({
				taskLines: [line],
				indentLevels: new Map([[line, 0]]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 0)).toBeNull();
		});

		it('finds the immediate parent task above', () => {
			const parent = '- [ ] Parent';
			const child = '\t- [ ] Child';
			const lines = [parent, child];
			const parser = createParser({
				taskLines: [parent, child],
				listItems: [parent, child],
				indentLevels: new Map([
					[parent, 0],
					[child, 1],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 1)).toBe(0);
		});

		it('stops at a list boundary formed by non-list text', () => {
			const parent = '- [ ] Parent';
			const text = 'Some text';
			const child = '\t- [ ] Child';
			const lines = [parent, text, child];
			const parser = createParser({
				taskLines: [child],
				listItems: [child],
				indentLevels: new Map([[child, 1]]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 2)).toBeNull();
		});

		it('finds the correct parent at multiple indent levels', () => {
			const grandparent = '- [ ] Grandparent';
			const parent = '\t- [ ] Parent';
			const child = '\t\t- [ ] Child';
			const lines = [grandparent, parent, child];
			const parser = createParser({
				taskLines: [grandparent, parent, child],
				listItems: [grandparent, parent, child],
				indentLevels: new Map([
					[grandparent, 0],
					[parent, 1],
					[child, 2],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 2)).toBe(1);
		});

		it('returns null when no parent task exists above', () => {
			const text = 'Some text';
			const indented = '\t- [ ] Indented task';
			const lines = [text, indented];
			const parser = createParser({
				taskLines: [indented],
				listItems: [indented],
				indentLevels: new Map([[indented, 1]]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 1)).toBeNull();
		});

		it('returns null for a non-task line', () => {
			const task = '- [ ] Task';
			const indentedText = '\tSome indented text';
			const lines = [task, indentedText];
			const parser = createParser({
				taskLines: [task],
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 1)).toBeNull();
		});

		it('skips tasks at the same indent level (siblings)', () => {
			const parent = '- [ ] Parent';
			const siblingA = '\t- [ ] Sibling A';
			const siblingB = '\t- [ ] Sibling B';
			const lines = [parent, siblingA, siblingB];
			const parser = createParser({
				taskLines: [parent, siblingA, siblingB],
				listItems: [parent, siblingA, siblingB],
				indentLevels: new Map([
					[parent, 0],
					[siblingA, 1],
					[siblingB, 1],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 2)).toBe(0);
		});

		it('returns null at line 0', () => {
			const indented = '\t- [ ] Indented at top';
			const lines = [indented];
			const parser = createParser({
				taskLines: [indented],
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 0)).toBeNull();
		});

		it('returns null for a root-level task even when tasks exist below', () => {
			const root = '- [ ] Root';
			const child = '\t- [ ] Child below';
			const lines = [root, child];
			const parser = createParser({
				taskLines: [root, child],
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 0)).toBeNull();
		});

		it('returns null for a second root-level task after another root task', () => {
			const first = '- [ ] First root';
			const second = '- [ ] Second root';
			const lines = [first, second];
			const parser = createParser({
				taskLines: [first, second],
				listItems: [first, second],
				indentLevels: new Map([
					[first, 0],
					[second, 0],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 1)).toBeNull();
		});

		it('finds the parent directly above, not a task below', () => {
			const parentAbove = '- [ ] Parent above';
			const currentChild = '\t- [ ] Current child';
			const taskBelow = '- [ ] Task below';
			const lines = [parentAbove, currentChild, taskBelow];
			const parser = createParser({
				taskLines: [parentAbove, currentChild, taskBelow],
				listItems: [parentAbove, currentChild, taskBelow],
				indentLevels: new Map([
					[parentAbove, 0],
					[currentChild, 1],
					[taskBelow, 0],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 1)).toBe(0);
		});

		it('returns null when the indented task is the first line', () => {
			const indentedChild = '\t- [ ] Indented child';
			const wouldBeParent = '- [ ] Would-be parent below';
			const lines = [indentedChild, wouldBeParent];
			const parser = createParser({
				taskLines: [indentedChild, wouldBeParent],
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 0)).toBeNull();
		});

		it('stops at a list boundary formed by a blank line', () => {
			const parent = '- [ ] Parent in list A';
			const blank = '';
			const child = '\t- [ ] Child in list B';
			const lines = [parent, blank, child];
			const parser = createParser({
				taskLines: [child],
				listItems: [child],
				indentLevels: new Map([[child, 1]]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 2)).toBeNull();
		});

		it('stops at a list boundary formed by a heading', () => {
			const parent = '- [ ] Parent in list A';
			const heading = '## Section Two';
			const child = '\t- [ ] Child in list B';
			const lines = [parent, heading, child];
			const parser = createParser({
				taskLines: [child],
				listItems: [child],
				indentLevels: new Map([[child, 1]]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 2)).toBeNull();
		});

		it('allows a non-task list item within the same list', () => {
			const parentTask = '- [ ] Parent task';
			const plainBullet = '- plain bullet';
			const childTask = '\t- [ ] Child task';
			const lines = [parentTask, plainBullet, childTask];
			const parser = createParser({
				taskLines: [parentTask, childTask],
				listItems: [parentTask, plainBullet, childTask],
				indentLevels: new Map([
					[parentTask, 0],
					[childTask, 1],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 2)).toBe(0);
		});

		it('stops at a whitespace-only line (list boundary)', () => {
			const parent = '- [ ] Parent';
			const whitespace = '   ';
			const child = '\t- [ ] Child';
			const lines = [parent, whitespace, child];
			const parser = createParser({
				taskLines: [child],
				listItems: [child],
				indentLevels: new Map([[child, 1]]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.findParentTask(lines, 2)).toBeNull();
		});
	});

	describe('buildRelationshipMap', () => {
		it('returns an empty map for no lines', () => {
			const parser = createParser({});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.buildRelationshipMap([])).toEqual(new Map());
		});

		it('returns an empty map for root-level tasks only', () => {
			const a = '- [ ] A';
			const b = '- [ ] B';
			const lines = [a, b];
			const parser = createParser({
				taskLines: [a, b],
				listItems: [a, b],
				indentLevels: new Map([
					[a, 0],
					[b, 0],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.buildRelationshipMap(lines)).toEqual(new Map());
		});

		it('does not link across a list boundary formed by non-list text', () => {
			const parent = '- [ ] Parent';
			const text = 'Some text';
			const child = '\t- [ ] Child';
			const lines = [parent, text, child];
			const parser = createParser({
				taskLines: [parent, child],
				listItems: [parent, child],
				indentLevels: new Map([
					[parent, 0],
					[child, 1],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.buildRelationshipMap(lines)).toEqual(new Map());
		});

		it('maps a child to its parent based on indentation', () => {
			const parent = '- [ ] Parent';
			const child = '\t- [ ] Child';
			const lines = [parent, child];
			const parser = createParser({
				taskLines: [parent, child],
				listItems: [parent, child],
				indentLevels: new Map([
					[parent, 0],
					[child, 1],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			const map = analyzer.buildRelationshipMap(lines);
			expect(map.get(1)).toBe(0);
			expect(map.size).toBe(1);
		});

		it('maps a multi-level hierarchy', () => {
			const grandparent = '- [ ] Grandparent';
			const parent = '\t- [ ] Parent';
			const child = '\t\t- [ ] Child';
			const lines = [grandparent, parent, child];
			const parser = createParser({
				taskLines: [grandparent, parent, child],
				listItems: [grandparent, parent, child],
				indentLevels: new Map([
					[grandparent, 0],
					[parent, 1],
					[child, 2],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			const map = analyzer.buildRelationshipMap(lines);
			expect(map.has(0)).toBe(false);
			expect(map.get(1)).toBe(0);
			expect(map.get(2)).toBe(1);
			expect(map.size).toBe(2);
		});

		it('calls findParentTask exactly once per line', () => {
			const parent = '- [ ] Parent';
			const child = '\t- [ ] Child';
			const lines = [parent, child];
			const parser = createParser({
				taskLines: [parent, child],
				listItems: [parent, child],
				indentLevels: new Map([
					[parent, 0],
					[child, 1],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			const spy = vi.spyOn(analyzer, 'findParentTask');
			analyzer.buildRelationshipMap(lines);
			expect(spy).toHaveBeenCalledTimes(2);
			spy.mockRestore();
		});
	});

	describe('identifyListBlocks', () => {
		it.each<[string, string[], string[], Array<{ start: number; end: number }>]>([
			['returns an empty array for no lines', [], [], []],
			[
				'returns one block for a single list item',
				['- [ ] Task'],
				['- [ ] Task'],
				[{ start: 0, end: 1 }],
			],
			[
				'returns one block for two consecutive list items',
				['- [ ] Task A', '\t- [ ] Task B'],
				['- [ ] Task A', '\t- [ ] Task B'],
				[{ start: 0, end: 2 }],
			],
			[
				'returns two blocks separated by a blank line',
				['- [ ] Task A', '', '- [ ] Task B'],
				['- [ ] Task A', '- [ ] Task B'],
				[
					{ start: 0, end: 1 },
					{ start: 2, end: 3 },
				],
			],
			[
				'returns two blocks separated by a heading',
				['- [ ] Task A', '## Section', '- [ ] Task B'],
				['- [ ] Task A', '- [ ] Task B'],
				[
					{ start: 0, end: 1 },
					{ start: 2, end: 3 },
				],
			],
			[
				'excludes non-list content at start and end',
				['# Heading', '- [ ] Task A', '- [ ] Task B', 'Some paragraph'],
				['- [ ] Task A', '- [ ] Task B'],
				[{ start: 1, end: 3 }],
			],
			[
				'includes a non-task list item in the same block',
				['- [ ] Task A', '- plain bullet', '- [ ] Task B'],
				['- [ ] Task A', '- plain bullet', '- [ ] Task B'],
				[{ start: 0, end: 3 }],
			],
			[
				'handles multiple blocks with non-list content between them',
				[
					'- [ ] List 1 task A',
					'\t- [ ] List 1 task B',
					'',
					'# Heading',
					'- [ ] List 2 task A',
					'- [ ] List 2 task B',
				],
				[
					'- [ ] List 1 task A',
					'\t- [ ] List 1 task B',
					'- [ ] List 2 task A',
					'- [ ] List 2 task B',
				],
				[
					{ start: 0, end: 2 },
					{ start: 4, end: 6 },
				],
			],
		])('%s', (_description, lines, listItems, expectedBlocks) => {
			const parser = createParser({ listItems });
			const analyzer = new RelationshipAnalyzer(parser);
			expect(analyzer.identifyListBlocks(lines)).toEqual(expectedBlocks);
		});

		it('does not access beyond the lines array bounds', () => {
			const taskA = '- [ ] Task A';
			const taskB = '- [ ] Task B';
			const lines = [taskA, taskB];
			const parser = createParser({ listItems: [taskA, taskB] });
			const analyzer = new RelationshipAnalyzer(parser);
			analyzer.identifyListBlocks(lines);
			expect(parser.isListItem).toHaveBeenCalledTimes(2);
		});
	});

	describe('getDesiredDepsForParent', () => {
		it.each<
			[string, string[], number, Map<number, number>, Map<string, string | null>, number]
		>([
			[
				'returns an empty set when the parent has no children',
				['- [ ] Lonely parent'],
				0,
				new Map<number, number>(),
				new Map<string, string | null>(),
				0,
			],
			[
				'skips children without an id',
				['- [ ] Parent', '\t- [ ] Child no ID'],
				0,
				new Map([[1, 0]]),
				new Map([['\t- [ ] Child no ID', null]]),
				0,
			],
		])('%s', (_description, lines, parentIndex, relationships, taskIds, expectedSize) => {
			const parser = createParser({ taskIds });
			const analyzer = new RelationshipAnalyzer(parser);
			const deps = analyzer.getDesiredDepsForParent(lines, parentIndex, relationships);
			expect(deps.size).toBe(expectedSize);
		});

		it('returns child ids for a parent', () => {
			const parent = '- [ ] Parent';
			const child = '\t- [ ] Child \u{1F194} abc123';
			const lines = [parent, child];
			const parser = createParser({
				taskIds: new Map([[child, 'abc123']]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			const deps = analyzer.getDesiredDepsForParent(lines, 0, new Map([[1, 0]]));
			expect(deps).toEqual(new Set(['abc123']));
		});

		it('returns multiple child ids', () => {
			const parent = '- [ ] Parent';
			const childA = '\t- [ ] Child A \u{1F194} aaa111';
			const childB = '\t- [ ] Child B \u{1F194} bbb222';
			const lines = [parent, childA, childB];
			const parser = createParser({
				taskIds: new Map([
					[childA, 'aaa111'],
					[childB, 'bbb222'],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			const deps = analyzer.getDesiredDepsForParent(
				lines,
				0,
				new Map([
					[1, 0],
					[2, 0],
				]),
			);
			expect(deps).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('only returns children for the specified parent', () => {
			const parentA = '- [ ] Parent A';
			const childOfA = '\t- [ ] Child of A \u{1F194} aaa111';
			const parentB = '- [ ] Parent B';
			const childOfB = '\t- [ ] Child of B \u{1F194} bbb222';
			const lines = [parentA, childOfA, parentB, childOfB];
			const parser = createParser({
				taskIds: new Map([
					[childOfA, 'aaa111'],
					[childOfB, 'bbb222'],
				]),
			});
			const analyzer = new RelationshipAnalyzer(parser);
			const relationships = new Map([
				[1, 0],
				[3, 2],
			]);
			expect(analyzer.getDesiredDepsForParent(lines, 0, relationships)).toEqual(
				new Set(['aaa111']),
			);
			expect(analyzer.getDesiredDepsForParent(lines, 2, relationships)).toEqual(
				new Set(['bbb222']),
			);
		});
	});
});
