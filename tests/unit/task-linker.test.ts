import { describe, it, expect } from 'vitest';
import { TaskLinker } from '../../src/linking/task-linker';
import { RelationshipAnalyzer } from '../../src/parsing/relationship-analyzer';
import { TaskParser } from '../../src/parsing/task-parser';
import { IdGenerator } from '../../src/linking/id-generator';
import { TaskMetadataParser } from '../../src/parsing/task-metadata-parser';
import { MetadataSyncCache } from '../../src/cache/metadata-sync-cache';
import { MetadataInheritor } from '../../src/linking/metadata-inheritor';
import { MarkerAccessorRegistry } from '../../src/parsing/marker-accessor';
import {
	createCorrectingEditor,
	createLineEditor,
	createRefusingEditor,
} from '../fixtures/editor';

describe('TaskLinker', () => {
	const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);
	const idGenerator = new IdGenerator();
	const relAnalyzer = new RelationshipAnalyzer(parser);
	const metadataParser = new TaskMetadataParser();
	const syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
	const registry = new MarkerAccessorRegistry(parser, metadataParser);
	const inheritor = new MetadataInheritor(registry, syncCache);

	function createLinker(): TaskLinker {
		return new TaskLinker(parser, idGenerator, relAnalyzer, inheritor);
	}

	describe('prepareForLinkPass', () => {
		it('stores the editor lines as a snapshot for processLine', () => {
			const linker = createLinker();
			const lines = ['- [ ] Parent', '\t- [ ] Child'];
			const editor = createLineEditor(lines);
			linker.prepareForLinkPass(editor);
			const existingIds = new Set<string>();
			linker.processLine(editor, 1, existingIds);
			expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
		});
	});

	describe('processLine', () => {
		it('adds ID to child and dependency to parent on indent', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);
			const existingIds = new Set<string>();

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, existingIds);

			const childLine = lines[1]!;
			expect(childLine).toMatch(/🆔 [a-z0-9]{6}/);
			const childId = childLine.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[0]).toContain(`⛔ ${childId}`);
		});

		it('reuses existing child ID instead of generating a new one', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createLineEditor(lines);
			const existingIds = new Set(['abc123']);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, existingIds);

			expect(lines[1]).toBe('\t- [ ] Child \u{1F194} abc123');
			expect(lines[0]).toContain('\u26D4 abc123');
		});

		it('does not modify a non-task line', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent',
				'\tSome text',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(lines[0]).toBe('- [ ] Parent');
			expect(lines[1]).toBe('\tSome text');
		});

		it('does not modify a root-level task and returns null', () => {
			const linker = createLinker();
			const lines = ['- [ ] Root task'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 0, new Set());

			expect(lines[0]).toBe('- [ ] Root task');
			expect(result).toBeNull();
		});

		it('does not duplicate an existing dependency and returns null (child ID was reused)', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, new Set(['abc123']));

			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');
			expect(result).toBeNull();
		});

		it('returns the newly generated ID instead of mutating existingIds', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);
			const existingIds = new Set<string>();

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, existingIds);

			const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(result).toBe(childId);
		});

		it('does not mutate the existingIds set given to it', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);
			const existingIds = new Set<string>();

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, existingIds);

			expect(existingIds.size).toBe(0);
		});

		it('does not call setLine for a line beyond lineCount', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 5, new Set());

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('does not modify lines when processing an empty editor', () => {
			const linker = createLinker();
			const lines: string[] = [];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 0, new Set());

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('handles parent with existing dep on different child gracefully', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent ⛔ oldid1',
				'\t- [ ] New Child',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['oldid1']));

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
			const linker = createLinker();
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{23EB}',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(lines[1]).toContain('\u{1F4C5} 2025-01-01');
			expect(lines[1]).toContain('\u{23F3} 2025-02-02');
			expect(lines[1]).toContain('\u{23EB}');
		});

		it('does not inherit the start-date marker from the parent', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent \u{1F6EB} 2025-01-01',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(lines[1]).not.toContain('\u{1F6EB}');
		});

		it('inherits nothing when the parent has no metadata', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(lines[1]).not.toContain('\u{1F4C5}');
			expect(lines[1]).not.toContain('\u{23F3}');
			const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[1]).toBe(`\t- [ ] Child \u{1F194} ${childId}`);
		});

		it('does not overwrite metadata the user already set on the child', () => {
			const linker = createLinker();
			// Child already has its own due/scheduled/priority and an ID,
			// so this is NOT a first-creation pass.
			const childLine =
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2099-12-31 \u{23F3} 2099-11-30 \u{23EC}';
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{23EB}',
				childLine,
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

			// The child's own values survive untouched.
			expect(lines[1]).toBe(childLine);
			expect(lines[1]).not.toContain('2025-01-01');
			expect(lines[1]).not.toContain('2025-02-02');
		});

		it('does not re-add metadata on a second pass once the child has an ID', () => {
			const linker = createLinker();
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23EB}',
				'\t- [ ] Child',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());
			const afterFirstPass = lines[1]!;

			// Simulate a second processing pass over the now-linked child.
			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set([afterFirstPass.match(/🆔\s([a-z0-9]{6})/)![1]!]));

			expect(lines[1]).toBe(afterFirstPass);
		});

		it('inherits when an already-ID-bearing task is indented under a parent', () => {
			const linker = createLinker();
			// Child already carries an ID (e.g. it was a sibling that the
			// Tasks plugin had given an ID) but has no metadata of its own,
			// and the parent does not yet block it.
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{23EB}',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{1F4C5} 2025-01-01');
			expect(lines[1]).toContain('\u{23F3} 2025-02-02');
			expect(lines[1]).toContain('\u{23EB}');
			expect(lines[0]).toContain('\u26D4 abc123');
		});

		it('re-inherits from the new parent when a child switches parents', () => {
			const linker = createLinker();
			// Child is currently blocked by parent A (which already has its
			// dep marker) but the snapshot now places it under parent B.
			const lines = [
				'- [ ] Parent A \u{1F4C5} 2025-01-01',
				'- [ ] Parent B \u{1F4C5} 2030-09-09 \u{23EC}',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 2, new Set(['abc123']));

			// Parent B (the new parent at index 1) gains the dep and the
			// child inherits Parent B's metadata.
			expect(lines[1]).toContain('\u26D4 abc123');
			expect(lines[2]).toContain('\u{1F4C5} 2030-09-09');
			expect(lines[2]).toContain('\u{23EC}');
		});
	});

	describe('metadata change propagation', () => {
		/**
		 * Builds a linker whose sync cache has been seeded from a prior
		 * on-disk state (the parent's value before the user changed it).
		 */
		function seededLinker(priorContent: string): TaskLinker {
			const cache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
			cache.buildFromFiles([{ path: 'a.md', content: priorContent }]);
			return new TaskLinker(
				parser,
				idGenerator,
				relAnalyzer,
				new MetadataInheritor(registry, cache),
			);
		}

		// The child line is the same before and after in every row: only the
		// parent moved, so the question is whether the child follows it.
		const parentValueChangeCases = [
			{
				name: "updates the child when the parent's due date changes and the child still held the old value",
				child: '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
				priorParent: '- [ ] Parent \u{1F4C5} 2025-01-01',
				newParent: '- [ ] Parent \u{1F4C5} 2025-09-09 \u26D4 abc123',
				expectedContain: '\u{1F4C5} 2025-09-09',
				expectedNotContain: '2025-01-01',
			},
			{
				name: 'does not change the child when the user gave it a different value',
				child: '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2099-12-31',
				priorParent: '- [ ] Parent \u{1F4C5} 2025-01-01',
				newParent: '- [ ] Parent \u{1F4C5} 2025-09-09 \u26D4 abc123',
				expectedContain: '\u{1F4C5} 2099-12-31',
				expectedNotContain: '2025-09-09',
			},
			{
				name: 'propagates a changed parent priority onto a child that held the old priority',
				child: '\t- [ ] Child \u{1F194} abc123 \u{23EC}',
				priorParent: '- [ ] Parent \u{23EC}',
				newParent: '- [ ] Parent \u{1F53A} \u26D4 abc123',
				expectedContain: '\u{1F53A}',
				expectedNotContain: '\u{23EC}',
			},
			{
				name: 'propagates a changed parent scheduled date onto a child that held the old one',
				child: '\t- [ ] Child \u{1F194} abc123 \u{23F3} 2025-02-02',
				priorParent: '- [ ] Parent \u{23F3} 2025-02-02',
				newParent: '- [ ] Parent \u{23F3} 2025-08-08 \u26D4 abc123',
				expectedContain: '\u{23F3} 2025-08-08',
				expectedNotContain: '2025-02-02',
			},
		];

		it.each(parentValueChangeCases)('$name', ({ child, priorParent, newParent, expectedContain, expectedNotContain }) => {
			const linker = seededLinker([priorParent, child].join('\n'));
			const lines = [newParent, child];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain(expectedContain);
			expect(lines[1]).not.toContain(expectedNotContain);
		});

		it("leaves the child untouched when the parent clears its value", () => {
			const prior = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			].join('\n');
			const linker = seededLinker(prior);
			const lines = [
				'- [ ] Parent \u26D4 abc123',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('\u{1F4C5} 2025-01-01');
		});

		it("does not rewrite the child in steady state when nothing changed", () => {
			const prior = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			].join('\n');
			const linker = seededLinker(prior);
			const childLine = '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01';
			const lines = ['- [ ] Parent \u{1F4C5} 2025-01-01 \u26D4 abc123', childLine];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

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
			const linker = seededLinker(prior);
			const childLine = '\t- [ ] Child \u{1F194} abc123';
			const lines = ['- [ ] Parent \u{1F4C5} 2025-01-01 \u26D4 abc123', childLine];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toBe(childLine);
			expect(lines[1]).not.toContain('\u{1F4C5}');
		});

	});

	describe('sync cache confirmation', () => {
		it('does not record the sync in the cache when the write is refused', () => {
			const cache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
			const localInheritor = new MetadataInheritor(registry, cache);
			const linker = new TaskLinker(parser, idGenerator, relAnalyzer, localInheritor);
			const childLine = '\t- [ ] Child \u{1F194} abc123';
			const lines = ['- [ ] Parent \u{1F4C5} 2025-01-01', childLine];
			const editor = createRefusingEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toBe(childLine);
			expect(cache.get('abc123')?.due ?? null).toBeNull();
		});

		it('records the sync in the cache when the write succeeds normally', () => {
			const cache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
			const localInheritor = new MetadataInheritor(registry, cache);
			const linker = new TaskLinker(parser, idGenerator, relAnalyzer, localInheritor);
			const lines = [
				'- [ ] Parent \u{1F4C5} 2025-01-01',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set(['abc123']));

			expect(lines[1]).toContain('2025-01-01');
			expect(cache.get('abc123')?.due).toBe('2025-01-01');
		});
	});

	describe('Finding B: atomic parent-child linkage', () => {
		it('abandons a freshly minted id and writes nothing when the parent refuses the link', () => {
			const linker = new TaskLinker(parser, idGenerator, relAnalyzer, inheritor);
			const parentLine = '- [ ] Parent \u26D4 ,def456';
			const childLine = '\t- [ ] Child';
			const lines = [parentLine, childLine];
			const editor = createRefusingEditor(lines);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, new Set());

			expect(result).toBeNull();
			expect(lines[1]).toBe(childLine);
			expect(
				editor.setLine.mock.calls.some(([n]: [number, string]) => n === 1),
			).toBe(false);
		});

		it('stays a no-op across two consecutive passes while the parent stays indeterminate', () => {
			const linker = new TaskLinker(parser, idGenerator, relAnalyzer, inheritor);
			const parentLine = '- [ ] Parent \u26D4 ,def456';
			const childLine = '\t- [ ] Child';
			const lines = [parentLine, childLine];
			const editor = createRefusingEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());
			const afterFirstPass = [...lines];

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(lines).toEqual(afterFirstPass);
			expect(lines).toEqual([parentLine, childLine]);
		});

		it('CONTRAST: still runs metadata inheritance and writes the child when the child already had an id and the parent refuses', () => {
			const linker = new TaskLinker(parser, idGenerator, relAnalyzer, inheritor);
			const parentLine = '- [ ] Parent \u{1F4C5} 2025-01-01';
			const childLine = '\t- [ ] Child \u{1F194} abc123';
			const lines = [parentLine, childLine];
			const editor = createRefusingEditor(lines);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, new Set(['abc123']));

			// No id was minted (the child already had one), so the atomic
			// link check does not apply and today's behaviour is preserved:
			// inheritance still runs and the child is still written even
			// though the parent's own write was refused.
			expect(result).toBeNull();
			const childWriteCall = editor.setLine.mock.calls.find(
				([n]: [number, string]) => n === 1,
			);
			expect(childWriteCall).toBeDefined();
			expect(childWriteCall![1]).toContain('\u{1F4C5} 2025-01-01');
		});

		it('DISCRIMINATING: does not bail when the parent write lands the dependency but also carries an unrelated correction', () => {
			const linker = new TaskLinker(parser, idGenerator, relAnalyzer, inheritor);
			const parentLine = '- [ ] Parent \u{1F4C5} 2025-01-01';
			const childLine = '\t- [ ] Child';
			const lines = [parentLine, childLine];
			// Simulates an arbiter that accepts the new dependency but also
			// freezes an unrelated suppressed marker back to a different
			// value on the same write, so the written parent line differs
			// from the proposed line by more than just the dependency.
			const editor = createCorrectingEditor(lines, (n, text) =>
				n === 0 ? text.replace('2025-01-01', '2099-12-31') : text,
			);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, new Set());

			expect(result).not.toBeNull();
			const mintedId = result!;
			expect(lines[0]).toContain('2099-12-31');
			expect(lines[0]).toContain(`\u26D4 ${mintedId}`);
			expect(lines[1]).toContain(`\u{1F194} ${mintedId}`);
		});
	});
});
