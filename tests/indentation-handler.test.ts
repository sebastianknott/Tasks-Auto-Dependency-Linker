import { describe, it, expect, vi } from 'vitest';
import { IndentationHandler } from '../src/indentation-handler';
import { RelationshipAnalyzer } from '../src/relationship-analyzer';
import { TaskParser } from '../src/task-parser';
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
	const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);
	const idEngine = new IdEngine();
	const relAnalyzer = new RelationshipAnalyzer(parser);

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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			expect(handler.isIdReferencedAsDep(lines, id)).toBe(expected);
		});
	});

	describe('prepareForLinkPass', () => {
		it('stores the editor lines as a snapshot for processLine', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = ['- [ ] Parent', '\t- [ ] Child'];
			const editor = createMockEditor(lines);
			handler.prepareForLinkPass(editor);
			const existingIds = new Set<string>();
			handler.processLine(editor, 1, existingIds);
			expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
		});
	});

	describe('processLine', () => {
		it('adds ID to child and dependency to parent on indent', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set<string>();

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, existingIds);

			const childLine = lines[1]!;
			expect(childLine).toMatch(/🆔 [a-z0-9]{6}/);
			const childId = childLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[0]).toContain(`⛔ ${childId}`);
		});

		it('reuses existing child ID instead of generating a new one', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set(['abc123']);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, existingIds);

			expect(lines[1]).toBe('\t- [ ] Child \u{1F194} abc123');
			expect(lines[0]).toContain('\u26D4 abc123');
		});

		it('does not modify a non-task line', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = [
				'- [ ] Parent',
				'\tSome text',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set());

			expect(lines[0]).toBe('- [ ] Parent');
			expect(lines[1]).toBe('\tSome text');
		});

		it('does not modify a root-level task', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = ['- [ ] Root task'];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 0, new Set());

			expect(lines[0]).toBe('- [ ] Root task');
		});

		it('does not duplicate an existing dependency', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = [
				'- [ ] Parent \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');
		});

		it('adds the new ID to existingIds set', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);
			const existingIds = new Set<string>();

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, existingIds);

			expect(existingIds.size).toBe(1);
			const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(existingIds.has(childId)).toBe(true);
		});

		it('does not call setLine for a line beyond lineCount', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 5, new Set());

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('does not modify lines when processing an empty editor', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines: string[] = [];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 0, new Set());

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('handles parent with existing dep on different child gracefully', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
			const lines = [
				'- [ ] Parent ⛔ oldid1',
				'\t- [ ] New Child',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['oldid1']));

			const childLine = lines[1]!;
			expect(childLine).toMatch(/🆔 [a-z0-9]{6}/);
			const newChildId = childLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			const parentDeps = parser.getTaskDependencies(lines[0]!);
			expect(parentDeps).toContain('oldid1');
			expect(parentDeps).toContain(newChildId);
		});
	});
});

