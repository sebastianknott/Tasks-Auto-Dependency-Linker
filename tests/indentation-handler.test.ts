import { describe, it, expect, vi } from 'vitest';
import { IndentationHandler } from '../src/indentation-handler';
import { RelationshipAnalyzer } from '../src/relationship-analyzer';
import { TaskParser } from '../src/task-parser';
import { IdEngine } from '../src/id-engine';
import { TaskMetadataParser } from '../src/task-metadata-parser';
import { MetadataSyncCache } from '../src/metadata-sync-cache';
import { MetadataInheritor } from '../src/metadata-inheritor';

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
	const metadataParser = new TaskMetadataParser();
	const syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
	const inheritor = new MetadataInheritor(metadataParser, syncCache);

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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			expect(handler.isIdReferencedAsDep(lines, id)).toBe(expected);
		});
	});

	describe('prepareForLinkPass', () => {
		it('stores the editor lines as a snapshot for processLine', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			const lines = ['- [ ] Root task'];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 0, new Set());

			expect(lines[0]).toBe('- [ ] Root task');
		});

		it('does not duplicate an existing dependency', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			const lines: string[] = [];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 0, new Set());

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('handles parent with existing dep on different child gracefully', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
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

	describe('metadata inheritance', () => {
		it('inherits due, scheduled, and priority from parent on first indent', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{23EB}',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set());

			expect(lines[1]).toContain('\u{1F4C5} 2025-01-01');
			expect(lines[1]).toContain('\u{23F3} 2025-02-02');
			expect(lines[1]).toContain('\u{23EB}');
		});

		it('does not inherit the start-date marker from the parent', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			const lines = [
				'- [ ] Parent \u{1F6EB} 2025-01-01',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set());

			expect(lines[1]).not.toContain('\u{1F6EB}');
		});

		it('inherits nothing when the parent has no metadata', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set());

			expect(lines[1]).not.toContain('\u{1F4C5}');
			expect(lines[1]).not.toContain('\u{23F3}');
			const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[1]).toBe(`\t- [ ] Child \u{1F194} ${childId}`);
		});

		it('does not overwrite metadata the user already set on the child', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			// Child already has its own due/scheduled/priority and an ID,
			// so this is NOT a first-creation pass.
			const childLine =
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2099-12-31 \u{23F3} 2099-11-30 \u{23EC}';
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{23EB}',
				childLine,
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			// The child's own values survive untouched.
			expect(lines[1]).toBe(childLine);
			expect(lines[1]).not.toContain('2025-01-01');
			expect(lines[1]).not.toContain('2025-02-02');
		});

		it('does not re-add metadata on a second pass once the child has an ID', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23EB}',
				'\t- [ ] Child',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set());
			const afterFirstPass = lines[1]!;

			// Simulate a second processing pass over the now-linked child.
			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set([afterFirstPass.match(/🆔\s([a-z0-9]{6})/)![1]!]));

			expect(lines[1]).toBe(afterFirstPass);
		});

		it('inherits when an already-ID-bearing task is indented under a parent', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			// Child already carries an ID (e.g. it was a sibling that the
			// Tasks plugin had given an ID) but has no metadata of its own,
			// and the parent does not yet block it.
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{23EB}',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{1F4C5} 2025-01-01');
			expect(lines[1]).toContain('\u{23F3} 2025-02-02');
			expect(lines[1]).toContain('\u{23EB}');
			expect(lines[0]).toContain('\u26D4 abc123');
		});

		it('re-inherits from the new parent when a child switches parents', () => {
			const handler = new IndentationHandler(parser, idEngine, relAnalyzer, inheritor);
			// Child is currently blocked by parent A (which already has its
			// dep marker) but the snapshot now places it under parent B.
			const lines = [
				'- [ ] Parent A \u{1F4C5} 2025-01-01',
				'- [ ] Parent B \u{1F4C5} 2030-09-09 \u{23EC}',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 2, new Set(['abc123']));

			// Parent B (the new parent at index 1) gains the dep and the
			// child inherits Parent B's metadata.
			expect(lines[1]).toContain('\u26D4 abc123');
			expect(lines[2]).toContain('\u{1F4C5} 2030-09-09');
			expect(lines[2]).toContain('\u{23EC}');
		});
	});

	describe('metadata change propagation', () => {
		/**
		 * Builds a handler whose sync cache has been seeded from a prior
		 * on-disk state (the parent's value before the user changed it).
		 */
		function seededHandler(priorContent: string): IndentationHandler {
			const cache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
			cache.buildFromFiles([{ path: 'a.md', content: priorContent }]);
			return new IndentationHandler(
				parser,
				idEngine,
				relAnalyzer,
				new MetadataInheritor(metadataParser, cache),
			);
		}

		it("updates the child when the parent's due date changes and the child still held the old value", () => {
			const prior = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			].join('\n');
			const handler = seededHandler(prior);
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-09-09 \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{1F4C5} 2025-09-09');
			expect(lines[1]).not.toContain('2025-01-01');
		});

		it("does not change the child when the user gave it a different value", () => {
			const prior = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2099-12-31',
			].join('\n');
			const handler = seededHandler(prior);
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-09-09 \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2099-12-31',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{1F4C5} 2099-12-31');
			expect(lines[1]).not.toContain('2025-09-09');
		});

		it("leaves the child untouched when the parent clears its value", () => {
			const prior = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			].join('\n');
			const handler = seededHandler(prior);
			const lines = [
				'- [ ] Parent \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{1F4C5} 2025-01-01');
		});

		it("does not rewrite the child in steady state when nothing changed", () => {
			const prior = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			].join('\n');
			const handler = seededHandler(prior);
			const childLine = '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01';
			const lines = ['- [ ] Parent \u{1F4C5} 2025-01-01 \u26D4 abc123', childLine];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toBe(childLine);
		});

		it("does not re-add a field the child cleared while the parent value is unchanged", () => {
			// Parent value still equals what the child last inherited, but the
			// user has since deleted the field on the child. Because the parent
			// did not change, the cleared field must stay cleared.
			const prior = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			].join('\n');
			const handler = seededHandler(prior);
			const childLine = '\t- [ ] Child \u{1F194} abc123';
			const lines = ['- [ ] Parent \u{1F4C5} 2025-01-01 \u26D4 abc123', childLine];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toBe(childLine);
			expect(lines[1]).not.toContain('\u{1F4C5}');
		});

		it("propagates a changed parent priority onto a child that held the old priority", () => {
			const prior = [
				'- [ ] Parent \u{23EC}',
				'\t- [ ] Child \u{1F194} abc123 \u{23EC}',
			].join('\n');
			const handler = seededHandler(prior);
			const lines = [
				'- [ ] Parent \u{1F53A} \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123 \u{23EC}',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{1F53A}');
			expect(lines[1]).not.toContain('\u{23EC}');
		});

		it("propagates a changed parent scheduled date onto a child that held the old one", () => {
			const prior = [
				'- [ ] Parent \u{23F3} 2025-02-02',
				'\t- [ ] Child \u{1F194} abc123 \u{23F3} 2025-02-02',
			].join('\n');
			const handler = seededHandler(prior);
			const lines = [
				'- [ ] Parent \u{23F3} 2025-08-08 \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123 \u{23F3} 2025-02-02',
			];
			const editor = createMockEditor(lines);

			handler.prepareForLinkPass(editor);
			handler.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{23F3} 2025-08-08');
			expect(lines[1]).not.toContain('2025-02-02');
		});
	});
});

