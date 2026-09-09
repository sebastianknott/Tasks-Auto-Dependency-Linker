import { describe, it, expect, vi } from 'vitest';
import { EditorProcessor } from '../../src/editor-processor';
import { IndentationHandler } from '../../src/indentation-handler';
import { RelationshipAnalyzer } from '../../src/relationship-analyzer';
import type { MarkerCacheLike } from '../../src/types';
import { TaskParser } from '../../src/task-parser';
import { IdEngine } from '../../src/id-engine';
import { TaskMetadataParser } from '../../src/task-metadata-parser';
import { MetadataSyncCache } from '../../src/metadata-sync-cache';
import { MetadataInheritor } from '../../src/metadata-inheritor';
import { LineWriteArbiter } from '../../src/line-write-arbiter';
import { MarkerAccessorRegistry } from '../../src/marker-accessor';
import { createEditor } from '../fixtures/editor';

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

/** Creates a standard test processor with handler, caches, and mock editor. */
function createTestProcessor(
	lines: string[],
	existingIds?: Set<string>,
	options?: { vaultDepIds?: Set<string>; excludedIds?: Set<string>; arbiter?: LineWriteArbiter },
) {
	const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);
	const idEngine = new IdEngine();
	const relAnalyzer = new RelationshipAnalyzer(parser);
	const metadataParser = new TaskMetadataParser();
	const registry = new MarkerAccessorRegistry(parser, metadataParser);
	const handler = new IndentationHandler(
		parser,
		idEngine,
		relAnalyzer,
		new MetadataInheritor(
			registry,
			new MetadataSyncCache(parser, metadataParser, relAnalyzer),
		),
	);
	const arbiter = options?.arbiter ?? new LineWriteArbiter(registry);
	const processor = new EditorProcessor(
		handler,
		parser,
		relAnalyzer,
		createIdCache(existingIds ?? new Set<string>(), options?.excludedIds),
		createDepCache(options?.vaultDepIds),
		arbiter,
	);
	const editor = createEditor(lines);
	return { parser, handler, processor, editor, lines, arbiter, idEngine };
}

describe('EditorProcessor', () => {
	it('processes all lines in the editor', () => {
		const { processor, editor, lines } = createTestProcessor([
			'- [ ] Parent',
			'\t- [ ] Child',
		]);

		processor.processAllLines(editor, '');

		expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
		const childId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
		expect(lines[0]).toContain(`⛔ ${childId}`);
	});

	it('does nothing for an empty editor', () => {
		const { processor, editor } = createTestProcessor([]);

		processor.processAllLines(editor, '');

		expect(editor.setLine).not.toHaveBeenCalled();
	});

	it('restores the cursor after editing so it does not jump to end of line', () => {
		const { processor } = createTestProcessor(['- [ ] Parent', '\t- [ ] Child']);
		const lines = ['- [ ] Parent', '\t- [ ] Child'];
		const cursor = { line: 1, ch: 6 };
		const editor = createEditor(lines, cursor);

		processor.processAllLines(editor, '');

		// A line changed, so the selection is restored to where it started.
		expect(editor.setSelection).toHaveBeenCalledWith(cursor, cursor);
	});

	it('does not touch the cursor when no line changes', () => {
		const { processor } = createTestProcessor([]);
		const editor = createEditor(['plain text, not a task'], { line: 0, ch: 4 });

		processor.processAllLines(editor, '');

		expect(editor.setSelection).not.toHaveBeenCalled();
	});

	it('processes a multi-level hierarchy', () => {
		const { processor, editor, lines } = createTestProcessor([
			'- [ ] Grandparent',
			'\t- [ ] Parent',
			'\t\t- [ ] Child',
		]);

		processor.processAllLines(editor, '');

		expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
		const parentId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
		expect(lines[0]).toContain(`⛔ ${parentId}`);
		expect(lines[2]).toMatch(/🆔 [a-z0-9]{6}/);
		const childId = lines[2]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
		expect(lines[1]).toContain(`⛔ ${childId}`);
	});

	it('mints a distinct 🆔 for each id-less sibling in a single link pass, and links all of them to the parent', () => {
		const { parser, processor, editor, lines } = createTestProcessor([
			'- [ ] Parent',
			'\t- [ ] Child A',
			'\t- [ ] Child B',
			'\t- [ ] Child C',
		]);

		processor.processAllLines(editor, '');

		const childIds = [lines[1]!, lines[2]!, lines[3]!].map(
			(line) => line.match(/🆔\s([a-z0-9]{6})/)![1]!,
		);
		expect(new Set(childIds).size).toBe(3);

		const parentDeps = parser.getTaskDependencies(lines[0]!);
		expect(parentDeps).toHaveLength(3);
		for (const id of childIds) {
			expect(parentDeps).toContain(id);
		}
	});

	it('adds a freshly minted id to the pass-local existingIds set so a colliding sibling retries instead of reusing it', () => {
		const { parser, processor, editor, lines, idEngine } = createTestProcessor([
			'- [ ] Parent',
			'\t- [ ] Child A',
			'\t- [ ] Child B',
		]);
		// Force generateId to hand out the same raw id for both siblings.
		// If the newly minted id for Child A is never recorded in the
		// pass-local existingIds set, generateUniqueId sees no collision
		// for Child B and both children end up with the identical id.
		const spy = vi.spyOn(idEngine, 'generateId');
		spy.mockReturnValueOnce('sameid');
		spy.mockReturnValueOnce('sameid');
		spy.mockReturnValueOnce('other1');

		processor.processAllLines(editor, '');

		expect(lines[1]).toContain('🆔 sameid');
		expect(lines[2]).toContain('🆔 other1');
		expect(spy).toHaveBeenCalledTimes(3);

		const parentDeps = parser.getTaskDependencies(lines[0]!);
		expect(parentDeps).toContain('sameid');
		expect(parentDeps).toContain('other1');

		spy.mockRestore();
	});

	it('calls processLine exactly lineCount times', () => {
		const { handler, processor, editor } = createTestProcessor([
			'- [ ] Task A',
			'- [ ] Task B',
			'\t- [ ] Task C',
		]);
		const spy = vi.spyOn(handler, 'processLine');

		processor.processAllLines(editor, '');

		expect(spy).toHaveBeenCalledTimes(3);
		spy.mockRestore();
	});

	it('skips non-task lines without modifying them', () => {
		const { processor, editor, lines } = createTestProcessor([
			'# Heading',
			'- [ ] Root task',
			'Some text',
		]);

		processor.processAllLines(editor, '');

		expect(lines[0]).toBe('# Heading');
		expect(lines[1]).toBe('- [ ] Root task');
		expect(lines[2]).toBe('Some text');
	});

	describe('unindent cleanup', () => {
		it('removes stale ⛔ from former parent when child is unindented to root', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Former parent ⛔ abc123',
				'- [ ] Former child 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Former parent');
			expect(lines[1]).toBe('- [ ] Former child');
		});

		it('moves ⛔ from old parent to new parent when child is re-indented', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Old parent ⛔ abc123',
				'- [ ] New parent',
				'\t- [ ] Child 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[0]).not.toContain('⛔ abc123');
			expect(lines[1]).toContain('⛔ abc123');
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('removes orphaned 🆔 when no line in document has ⛔ referencing it', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task with orphaned ID 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		// This was two tests with identical setup and identical assertions, one
		// titled from the child's side and one from the parent's side. Neither
		// could kill a mutant the other missed, so they are one test now.
		it('keeps a matching 🆔 and ⛔ pair intact on both the child and the parent', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('⛔ abc123');
			expect(lines[1]).toContain('🆔 abc123');
		});

		it('removes stale ⛔ but keeps valid ⛔ on the same parent', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123,def456',
				'\t- [ ] Current child 🆔 def456',
				'- [ ] Former child 🆔 abc123',
			], new Set(['abc123', 'def456']));

			processor.processAllLines(editor, '');

			expect(lines[0]).not.toContain('⛔ abc123');
			expect(lines[0]).toContain('⛔ def456');
			expect(lines[2]).not.toContain('🆔 abc123');
		});

		it('handles child moved from one parent to another in multi-level hierarchy', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent A ⛔ child1',
				'- [ ] Parent B',
				'\t- [ ] Child 🆔 child1',
			], new Set(['child1']));

			processor.processAllLines(editor, '');

			expect(lines[0]).not.toContain('⛔ child1');
			expect(lines[1]).toContain('⛔ child1');
			expect(lines[2]).toContain('🆔 child1');
		});

		it('removes orphaned 🆔 from multiple tasks', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			], new Set(['aaa111', 'bbb222']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Task A');
			expect(lines[1]).toBe('- [ ] Task B');
		});

		it('does not call setLine during orphan cleanup when no 🆔 needs removal', () => {
			const { processor, editor } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('README example: multi-level re-parent with spaces indentation', () => {
			const spaceParser = new TaskParser({ useTab: false, tabSize: 4 });
			const idEngine = new IdEngine();
			const spaceRelAnalyzer = new RelationshipAnalyzer(spaceParser);
			const spaceMetadataParser = new TaskMetadataParser();
			const spaceRegistry = new MarkerAccessorRegistry(spaceParser, spaceMetadataParser);
			const handler = new IndentationHandler(
				spaceParser,
				idEngine,
				spaceRelAnalyzer,
				new MetadataInheritor(
					spaceRegistry,
					new MetadataSyncCache(spaceParser, spaceMetadataParser, spaceRelAnalyzer),
				),
			);
			const existingIds = new Set(['abc444', 'abc123']);
			const spaceArbiter = new LineWriteArbiter(spaceRegistry);
			const processor = new EditorProcessor(
				handler, spaceParser, spaceRelAnalyzer, createIdCache(existingIds), createDepCache(),
				spaceArbiter,
			);

			const lines = [
				'- [ ] Write tests ⛔ abc444',
				'    - [ ] Build backend ⛔ abc123 🆔 abc444',
				'    - [ ] Design API schema 🆔 abc123',
			];
			const editor = createEditor(lines);

			processor.processAllLines(editor, '');

			const writeTestsDeps = spaceParser.getTaskDependencies(lines[0]!);
			expect(writeTestsDeps).toContain('abc444');
			expect(writeTestsDeps).toContain('abc123');
			expect(writeTestsDeps).toHaveLength(2);
			expect(spaceParser.getTaskDependencies(lines[1]!)).not.toContain('abc123');
			expect(lines[1]).toContain('🆔 abc444');
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('does not remove 🆔 from task in list A when only ⛔ reference is in list B', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task A 🆔 abc123',
				'',
				'- [ ] Task B ⛔ abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('🆔 abc123');
			expect(lines[2]).toContain('⛔ abc123');
		});

		it('does not remove ⛔ from task in list A when referenced 🆔 is in list B', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
				'## Section Two',
				'\t- [ ] Child 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('⛔ abc123');
			expect(lines[2]).toContain('🆔 abc123');
		});

		it('two separate lists each get independent dependency management', () => {
			const { parser, processor, editor, lines } = createTestProcessor([
				'- [ ] Parent A',
				'\t- [ ] Child A',
				'',
				'- [ ] Parent B',
				'\t- [ ] Child B',
			]);

			processor.processAllLines(editor, '');

			expect(lines[1]).toMatch(/🆔 [a-z0-9]{6}/);
			const childAId = lines[1]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[0]).toContain(`⛔ ${childAId}`);

			expect(lines[4]).toMatch(/🆔 [a-z0-9]{6}/);
			const childBId = lines[4]!.match(/🆔\s([a-z0-9]{6})/)![1]!;
			expect(lines[3]).toContain(`⛔ ${childBId}`);

			expect(parser.getTaskDependencies(lines[0]!)).not.toContain(childBId);
			expect(parser.getTaskDependencies(lines[3]!)).not.toContain(childAId);
		});

		it('task indented under heading does not get linked to parent in different list', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent in list A',
				'# Heading',
				'\t- [ ] Child in list B',
			]);

			processor.processAllLines(editor, '');

			expect(lines[0]).not.toContain('⛔');
			expect(lines[2]).not.toContain('🆔');
		});
	});

	describe('deleted child cleanup', () => {
		const strippedOnlyLineCases = [
			{ name: 'removes ⛔ from parent when child task line was deleted', lines: ['- [ ] Parent ⛔ abc123'] },
			{ name: 'removes ⛔ when referenced 🆔 does not exist in vault either', lines: ['- [ ] Parent ⛔ ghost1'] },
		];

		it.each(strippedOnlyLineCases)('$name', ({ lines: docLines }) => {
			const { processor, editor, lines } = createTestProcessor(docLines);

			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Parent');
		});

		it('removes only the deleted child dep while keeping valid deps', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123,def456',
				'\t- [ ] Remaining child 🆔 def456',
			], new Set(['def456']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('⛔ def456');
			expect(lines[0]).not.toContain('abc123');
		});

		const danglingDeletedIdCases = [
			{
				name: 'removes ⛔ for deleted child even when not in managedIds',
				lines: ['- [ ] Parent ⛔ deleted1', '\t- [ ] Child A'],
				assertIndex: 0,
			},
			{
				name: 'removes dangling ⛔ from non-first line in a list block',
				lines: ['- [ ] Parent A', '\t- [ ] Parent B ⛔ deleted1'],
				assertIndex: 1,
			},
		];

		it.each(danglingDeletedIdCases)('$name', ({ lines: docLines, assertIndex }) => {
			const { processor, editor, lines } = createTestProcessor(docLines);

			processor.processAllLines(editor, '');

			expect(lines[assertIndex]).not.toContain('deleted1');
		});

		it('preserves ⛔ when referenced 🆔 exists in another vault file (cross-file)', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
			], new Set(['abc123']), { excludedIds: new Set(['abc123']) });

			processor.processAllLines(editor, 'current.md');

			expect(lines[0]).toContain('⛔ abc123');
		});

		it('preserves ⛔ when 🆔 exists in document but not in existingIds', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
				'',
				'- [ ] Other task 🆔 abc123',
			]);

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('⛔ abc123');
		});

		it('removes dangling ⛔ from a task in the second list block', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task A',
				'',
				'- [ ] Task B \u26D4 ghost1',
			]);

			processor.processAllLines(editor, '');

			expect(lines[2]).toBe('- [ ] Task B');
			expect(lines[0]).toBe('- [ ] Task A');
		});
	});

	describe('cross-file vault dep IDs', () => {
		it('does not remove 🆔 when the ID is in vaultDepIds (cross-file reference)', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task with cross-file dep 🆔 abc123',
			], new Set(['abc123']), { vaultDepIds: new Set(['abc123']) });

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('🆔 abc123');
		});

		const emptyVaultDepIdsCases = [
			{ name: 'removes 🆔 when the ID is NOT in vaultDepIds and no local ⛔ exists', vaultDepIds: new Set<string>() },
			{ name: 'works correctly when depCache returns empty set (no cross-file refs)', vaultDepIds: undefined },
		];

		it.each(emptyVaultDepIdsCases)('$name', ({ vaultDepIds }) => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task with orphaned ID 🆔 abc123',
			], new Set(['abc123']), { vaultDepIds });

			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('preserves 🆔 when local ⛔ exists even if vaultDepIds is empty', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			], new Set(['abc123']), { vaultDepIds: new Set<string>() });

			processor.processAllLines(editor, '');

			expect(lines[1]).toContain('🆔 abc123');
		});

		it('preserves multiple 🆔 markers when their IDs are in vaultDepIds', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			], new Set(['aaa111', 'bbb222']), { vaultDepIds: new Set(['aaa111', 'bbb222']) });

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('🆔 aaa111');
			expect(lines[1]).toContain('🆔 bbb222');
		});

		it('removes only the 🆔 not in vaultDepIds when multiple tasks exist', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task A 🆔 aaa111',
				'- [ ] Task B 🆔 bbb222',
			], new Set(['aaa111', 'bbb222']), { vaultDepIds: new Set(['aaa111']) });

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('🆔 aaa111');
			expect(lines[1]).toBe('- [ ] Task B');
		});

		it('removes orphaned 🆔 from a task in the second list block', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task A',
				'',
				'- [ ] Task B \u{1F194} xyz999',
			], new Set(['xyz999']), { vaultDepIds: new Set<string>() });

			processor.processAllLines(editor, '');

			expect(lines[2]).toBe('- [ ] Task B');
			expect(lines[0]).toBe('- [ ] Task A');
		});
	});

	describe('line write arbiter integration', () => {
		it('skips the link pass for a line whose 🆔 is suppressed, so no fresh id is minted', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			// First pass: baseline snapshot captured via endPass inside processAllLines.
			processor.processAllLines(editor, '');
			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');
			expect(lines[1]).toBe('\t- [ ] Child \u{1F194} abc123');

			// The caret sits on the child line; the user deletes its id with
			// no editor event firing in between (arrow-key navigation). The
			// link is genuinely severed: the child stays untagged, and the
			// parent's now-dangling ⛔ is cleaned up by the ordinary pass 2b
			// cleanup, not silently re-linked under a freshly minted id
			// (which is what the old, unprotected code did).
			lines[1] = '\t- [ ] Child';
			const editor2 = createEditor(lines, { line: 1, ch: 6 });
			processor.processAllLines(editor2, '');

			expect(lines[1]).toBe('\t- [ ] Child');
			expect(lines[1]).not.toMatch(/🆔 [a-z0-9]{6}/);
			expect(lines[0]).toBe('- [ ] Parent');
		});

		it('does not call processLine at all for a line whose id is missing and suppressed', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, handler, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, '');

			lines[1] = '\t- [ ] Child';
			const editor2 = createEditor(lines, { line: 1, ch: 6 });
			const spy = vi.spyOn(handler, 'processLine');
			processor.processAllLines(editor2, '');

			expect(spy).not.toHaveBeenCalledWith(expect.anything(), 1, expect.anything());
		});

		it('leaves the child 🆔 intact when the parent ⛔ is deleted on the cursor line', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, '');

			// The caret sits on the parent line; the user deletes the ⛔
			// dependency with no event firing in between.
			lines[0] = '- [ ] Parent';
			const editor2 = createEditor(lines, { line: 0, ch: 8 });
			processor.processAllLines(editor2, '');

			expect(lines[0]).toBe('- [ ] Parent');
			expect(lines[1]).toContain('\u{1F194} abc123');
		});

		it('keeps this.lines synchronized with a correction the arbiter applied', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Task \u{1F4C5} 2025-01-01 \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter, vaultDepIds: new Set(['abc123']) },
			);
			processor.processAllLines(editor, '');

			// User deletes the due date on the cursor line; the plugin has
			// nothing that would try to re-add it, but the correction path
			// must still leave this.lines (used by the cleanup passes) in
			// sync so a subsequent cleanup decision is not made against a
			// stale snapshot.
			lines[0] = '- [ ] Task \u{1F194} abc123';
			const editor2 = createEditor(lines, { line: 0, ch: 5 });
			processor.processAllLines(editor2, '');

			expect(lines[0]).toBe('- [ ] Task \u{1F194} abc123');
			expect(lines[0]).not.toContain('\u{1F4C5}');
		});

		it('REGRESSION: preserves a trailing space left by a due-date deletion when an unrelated dangling dependency is cleaned up in the same pass', () => {
			// This reproduces the reported bug end to end: the user
			// backspaces a due date down to a single trailing space and
			// parks the caret there. In the same edit, the child task the
			// parent's dependency pointed at is gone too, so the ⛔ is now
			// legitimately dangling and the cleanup pass rewrites the
			// line for that unrelated reason. The rewrite must not reach
			// past the ⛔ removal and eat the user's trailing space.
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = [
				'- [ ] Parent \u26D4 abc123 \u{1F4C5} 2026-01-05',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, 'test.md');

			// The child task is deleted, severing the dependency, and the
			// due date on the parent line is backspaced down to a single
			// trailing space, with the caret parked at the end of it.
			lines.splice(1, 1);
			lines[0] = '- [ ] Parent \u26D4 abc123 ';
			const editor2 = createEditor(lines, { line: 0, ch: lines[0].length });
			processor.processAllLines(editor2, 'test.md');

			expect(lines[0]).toBe('- [ ] Parent ');
		});

		it('REGRESSION: preserves a trailing space left by a priority deletion when inheritance re-applies the value in the same pass', () => {
			// This reproduces the user's exact reported sequence: the
			// child had inherited its parent's priority; the user
			// backspaces that priority glyph away and parks the caret
			// right after the trailing space that is left behind.
			// MetadataInheritor proposes re-applying the parent's
			// priority in the very same pass (since the parent's value
			// has not changed), producing a double-space intermediate
			// state; LineWriteArbiter then detects the priority was
			// suppressed and corrects the proposal by removing it again.
			// That correction must not reach past its own removal and
			// eat the user's original trailing space.
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = [
				'- [ ] Parent \u26D4 abc123 \u23EB',
				'\t- [ ] Child \u{1F194} abc123 \u23EB',
			];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, 'test.md');

			// The user backspaces the child's own priority glyph away,
			// leaving a single trailing space, with the caret parked at
			// the end of the line.
			lines[1] = '\t- [ ] Child \u{1F194} abc123 ';
			const editor2 = createEditor(lines, { line: 1, ch: lines[1].length });
			processor.processAllLines(editor2, 'test.md');

			expect(lines[1]).toBe('\t- [ ] Child \u{1F194} abc123 ');
		});

		it('REGRESSION: renaming a child 🆔 by hand still moves the parent ⛔ to the new id', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123', 'myid']), { arbiter },
			);
			processor.processAllLines(editor, '');

			// The user hand-edits the child's id; the caret sits on the
			// child line while doing so.
			lines[1] = '\t- [ ] Child \u{1F194} myid';
			const editor2 = createEditor(lines, { line: 1, ch: 10 });
			processor.processAllLines(editor2, '');

			expect(lines[1]).toContain('\u{1F194} myid');
			expect(lines[0]).toContain('\u26D4 myid');
			expect(lines[0]).not.toContain('abc123');
		});

		it('REGRESSION: does not mint a fresh id when the cursor line\'s 🆔 is bare (mid-deletion), on the very first pass that sees it', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, handler, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, '');

			// Backspacing through the child's id one character at a time
			// passes through this state: the glyph itself is still there,
			// but every id character has been deleted. This is the very
			// FIRST pass to see the fragment, before any suppression has
			// ever been recorded for this line, so the fix cannot rely on
			// a prior snapshot at all: it has to recognize the fragment
			// from the line's own content.
			lines[1] = '\t- [ ] Child \u{1F194}';
			const editor2 = createEditor(lines, { line: 1, ch: 14 });
			const spy = vi.spyOn(handler, 'processLine');
			processor.processAllLines(editor2, '');

			expect(spy).not.toHaveBeenCalledWith(expect.anything(), 1, expect.anything());
			expect(lines[1]).toBe('\t- [ ] Child \u{1F194}');
		});

		it('REGRESSION: does not duplicate the ⛔ glyph when a dependency list loses its first id mid-edit', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = [
				'- [ ] Parent \u26D4 abc123,def456',
				'\t- [ ] Child A \u{1F194} abc123',
				'\t- [ ] Child B \u{1F194} def456',
			];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123', 'def456']), { arbiter },
			);
			processor.processAllLines(editor, '');
			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123,def456');

			// The caret sits on the parent line; the user deletes the
			// first id in the list, leaving a leading comma mid-edit.
			lines[0] = '- [ ] Parent \u26D4 ,def456';
			const editor2 = createEditor(lines, { line: 0, ch: 15 });
			processor.processAllLines(editor2, '');

			expect(lines[0]).toBe('- [ ] Parent \u26D4 ,def456');
			expect(lines[0].split('\u26D4').length - 1).toBeLessThanOrEqual(1);

			// REGRESSION: neither child was touched by the user, and the
			// parent's dependency list is only *transiently* malformed
			// while it's mid-edit. Both children's ids must survive the
			// cleanup passes even though the raw parent text can't
			// currently prove they're referenced.
			expect(lines[1]).toBe('\t- [ ] Child A \u{1F194} abc123');
			expect(lines[2]).toBe('\t- [ ] Child B \u{1F194} def456');
		});

		it('REGRESSION: a ⛔ referencing another vault file\'s 🆔 survives cleanup with the arbiter wired in', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter, excludedIds: new Set(['abc123']) },
			);

			processor.processAllLines(editor, 'current.md');

			expect(lines[0]).toContain('\u26D4 abc123');
		});

		it('REGRESSION (Finding C): does not strip the parent\'s \u26D4 when the child\'s \u{1F194} is bare mid-deletion on the cursor line', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, '');
			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');

			// The caret sits on the child line; the id is deleted down to a
			// bare glyph, mid-edit. The parent line is untouched text-wise
			// and is not the cursor line, so it carries no write protection
			// of its own; only the arbiter's frozen-id union protects it.
			lines[1] = '\t- [ ] Child \u{1F194}';
			const editor2 = createEditor(lines, { line: 1, ch: 14 });
			processor.processAllLines(editor2, '');

			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');
		});

		it('REGRESSION (Finding C): the parent\'s \u26D4 survives across two consecutive passes while the child stays mid-edit', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, '');

			lines[1] = '\t- [ ] Child \u{1F194}';
			const editor2 = createEditor(lines, { line: 1, ch: 14 });
			processor.processAllLines(editor2, '');
			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');

			// A second pass runs with the caret still on the same in-flux
			// line (e.g. the debounce fires again before the user resumes
			// typing). The endPass snapshot rebuild at the end of pass 1
			// must not have evaporated the protection.
			const editor3 = createEditor(lines, { line: 1, ch: 14 });
			processor.processAllLines(editor3, '');

			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');
		});

		it('REGRESSION (Finding C): once the id fragment is completed back into a well-formed id, the next pass cascades normally again', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123', 'xyz789']), { arbiter },
			);
			processor.processAllLines(editor, '');

			lines[1] = '\t- [ ] Child \u{1F194}';
			const editor2 = createEditor(lines, { line: 1, ch: 14 });
			processor.processAllLines(editor2, '');
			expect(lines[0]).toBe('- [ ] Parent \u26D4 abc123');

			// The fragment is completed back into a different, well-formed
			// id (a hand-typed rename, not a deletion). Normal cascading
			// must resume: the parent's \u26D4 must move to the new id, proving
			// no leftover freeze pins the old one in place.
			lines[1] = '\t- [ ] Child \u{1F194} xyz789';
			const editor3 = createEditor(lines, { line: 1, ch: 18 });
			processor.processAllLines(editor3, '');

			expect(lines[0]).toContain('\u26D4 xyz789');
			expect(lines[0]).not.toContain('abc123');
		});

		it('REGRESSION (Finding C): orphan cleanup (pass 2c) leaves the in-flux child\'s own line untouched', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, '');

			lines[1] = '\t- [ ] Child \u{1F194}';
			const editor2 = createEditor(lines, { line: 1, ch: 14 });
			processor.processAllLines(editor2, '');

			// Pass 2c (orphan-id cleanup) only ever considers a line whose
			// own \u{1F194} currently parses; a bare fragment does not, so it is
			// skipped outright. Pinning this proves the frozen-id union
			// added to pass 2b for the parent's benefit does not leak into
			// pass 2c and touch the child's own in-flux line.
			expect(lines[1]).toBe('\t- [ ] Child \u{1F194}');
		});

		it('REGRESSION (Finding C): a \u26D4 pointing at another vault file\'s \u{1F194} still survives while an unrelated child on the cursor line is mid-edit', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			// Two independent facts protect two different deps: 'other-file-id'
			// is a real id living in a different vault file (surfaced via
			// idCache.getAllExcluding), and 'abc123' is the cursor-line
			// child's committed id, frozen because its own \u{1F194} is mid-edit.
			// Both must survive cleanup at once, proving the frozen-id union
			// is strictly additive to the existing cross-file knownIds set.
			const lines = [
				'- [ ] Parent \u26D4 abc123,other-file-id',
				'\t- [ ] Child \u{1F194} abc123',
			];
			const { parser, processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter, excludedIds: new Set(['other-file-id']) },
			);
			processor.processAllLines(editor, 'current.md');

			lines[1] = '\t- [ ] Child \u{1F194}';
			const editor2 = createEditor(lines, { line: 1, ch: 14 });
			processor.processAllLines(editor2, 'current.md');

			const parentDeps = parser.getTaskDependencies(lines[0]!);
			expect(parentDeps).toContain('abc123');
			expect(parentDeps).toContain('other-file-id');
		});

		it('REGRESSION (Finding C): still removes a genuinely dangling \u26D4 that is not the frozen id, while the cursor-line child stays mid-edit', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 abc123', '\t- [ ] Child \u{1F194} abc123'];
			const { parser, processor, editor } = createTestProcessor(
				lines, new Set(['abc123']), { arbiter },
			);
			processor.processAllLines(editor, '');

			// The child's id is deleted down to a bare glyph, mid-edit, and a
			// separate, genuinely stale \u26D4 has also crept onto the parent
			// (an id that was never a real child of this parent). A fix that
			// disabled pass 2b entirely for this cursor state would let
			// 'ghost1' survive too; it must still be stripped.
			lines[0] = '- [ ] Parent \u26D4 abc123,ghost1';
			lines[1] = '\t- [ ] Child \u{1F194}';
			const editor2 = createEditor(lines, { line: 1, ch: 14 });
			processor.processAllLines(editor2, '');

			const parentDeps = parser.getTaskDependencies(lines[0]);
			expect(parentDeps).toContain('abc123');
			expect(parentDeps).not.toContain('ghost1');
		});

		it('REGRESSION (C3): does not duplicate a due-date glyph when the child holds a fragmentary date and the sync cache has no confirmed value for that field', () => {
			// Reproduces the full autosave-reseed scenario end to end: the
			// child already inherited the parent's due date once, then the
			// user started retyping it and left it half-typed. The sync
			// cache's lastSynced for 'due' is null here (fresh cache, never
			// confirmed), matching the state MetadataSyncCache.seedFile
			// leaves behind after an autosave with an unparseable child
			// fragment. The cursor sits on the parent line, not the
			// child's, so the arbiter grants the fragment no protection of
			// its own; only the fragment guard in MetadataInheritor can
			// prevent setDueDate from appending a second \u{1F4C5}.
			const lines = [
				'- [ ] Parent \u{1F4C5} 2026-01-15',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2026-0',
			];
			const { processor } = createTestProcessor(lines, new Set(['abc123']));
			const editor = createEditor(lines, { line: 0, ch: 0 });
			processor.processAllLines(editor, '');

			expect(lines[1]).toBe('\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2026-0');
			expect((lines[1]!.match(/\u{1F4C5}/gu) ?? []).length).toBe(1);
		});

		it('REGRESSION (Finding B): does not churn an id-less child while the parent\'s \u26D4 is a mid-edit fragment on the cursor line', () => {
			const arbiter = new LineWriteArbiter(
				new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser()),
			);
			const lines = ['- [ ] Parent \u26D4 ,def456', '\t- [ ] Child'];
			const { processor } = createTestProcessor(lines, new Set(['def456']), {
				arbiter,
				excludedIds: new Set(['def456']),
			});
			const editor = createEditor(lines, { line: 0, ch: 14 });

			processor.processAllLines(editor, '');

			// First pass: the parent is indeterminate, so nothing at all is
			// written, not even a discarded id on the child. Checking the
			// setLine call log (not just the final content) is essential:
			// without the atomic-link fix the child line is written twice
			// (id added, then removed again by orphan cleanup) for a net
			// content change of zero, which content-only assertions would
			// miss entirely.
			expect(lines).toEqual(['- [ ] Parent \u26D4 ,def456', '\t- [ ] Child']);
			expect(editor.setLine.mock.calls.some(([n]) => n === 1)).toBe(false);

			const editor2 = createEditor(lines, { line: 0, ch: 14 });
			processor.processAllLines(editor2, '');

			// Second pass: still a genuine no-op, including at the setLine
			// call level.
			expect(lines).toEqual(['- [ ] Parent \u26D4 ,def456', '\t- [ ] Child']);
			expect(editor2.setLine.mock.calls.some(([n]) => n === 1)).toBe(false);

			// The parent's fragment resolves into a well-formed dependency.
			lines[0] = '- [ ] Parent \u26D4 def456';
			const editor3 = createEditor(lines, { line: -1, ch: 0 });
			processor.processAllLines(editor3, '');

			expect(lines[1]).toMatch(/\u{1F194} [a-z0-9]{6}/u);
			const childId = lines[1]!.match(/\u{1F194}\s([a-z0-9]{6})/u)![1]!;
			expect(lines[0]).toContain(`\u26D4 def456,${childId}`);
		});
	});
});

// Hardening suite from a mentor review of LineWriteArbiter. This is the higher-value
// integration counterpart to the pure-function invariants in tests/marker-invariants.test.ts:
// it runs a full EditorProcessor.processAllLines pass, with the cursor sitting on a line mid
// character-by-character deletion, and checks the exact class of corruption that the
// historical computeBareText bug produced (a restored dependency plus a corrupted document).
//
// The corpus here deliberately reuses the same seed lines as tests/marker-invariants.test.ts,
// duplicated locally rather than imported, since cross-test-file corpus sharing is not an
// existing pattern in this codebase and the corpus is small. Only progressive truncation is
// used here (not every single-character deletion), because this pass drives the full
// EditorProcessor pipeline instead of a pure function; truncation alone already produced zero
// runtime pressure in measurement, so the smaller corpus was a deliberate, documented choice
// rather than a necessity, kept to bound the corpus in case the processor pipeline changes
// later and becomes more expensive.
describe('EditorProcessor.processAllLines deletion fuzz (LineWriteArbiter hardening)', () => {
	const FUZZ_SEEDS: readonly string[] = [
		'- [ ] Task \u{1F194} abc123',
		'- [ ] Task \u26D4 abc123',
		'- [ ] Task \u26D4 abc123,def456',
		'- [ ] Task \u{1F4C5} 2025-11-15',
		'- [ ] Task \u23F3 2025-11-15',
		'- [ ] Task \u23EB',
		'- [ ] Task \u{1F194} abc123 \u26D4 def456,ghi789 \u{1F4C5} 2025-11-15 \u23F3 2025-11-20 \u23EB',
		'- [ ] call Bob \u{1F4C5} sometime',
	];

	function fuzzTruncations(seed: string): string[] {
		const states: string[] = [];
		for (let i = seed.length; i >= 0; i -= 1) {
			states.push(seed.slice(0, i));
		}
		return states;
	}

	const UNRELATED_LINE = '- [ ] Unrelated sibling task';

	const FUZZ_CORPUS: readonly string[] = Array.from(
		new Set(FUZZ_SEEDS.flatMap((seed) => fuzzTruncations(seed))),
	);

	function countLiteralOccurrences(line: string, literal: string): number {
		return line.split(literal).length - 1;
	}

	function countGlobalMatches(line: string, pattern: RegExp): number {
		const globalPattern = new RegExp(pattern.source, 'gu');
		return [...line.matchAll(globalPattern)].length;
	}

	function assertNoDuplicatedMarkerGlyph(line: string): void {
		expect(countLiteralOccurrences(line, '\u{1F194}')).toBeLessThanOrEqual(1);
		expect(countLiteralOccurrences(line, '\u26D4')).toBeLessThanOrEqual(1);
		expect(countGlobalMatches(line, TaskMetadataParser.DUE_GLYPH_REGEX)).toBeLessThanOrEqual(1);
		expect(countGlobalMatches(line, TaskMetadataParser.SCHEDULED_GLYPH_REGEX)).toBeLessThanOrEqual(1);
	}

	it('is idempotent, does not duplicate marker glyphs, and does not corrupt an untouched sibling line, for every truncation state', () => {
		for (const mutatedLine of FUZZ_CORPUS) {
			const lines = [mutatedLine, UNRELATED_LINE];
			const { processor } = createTestProcessor(lines);

			// A cold arbiter deliberately keeps a dangling dependency reference on its very
			// first pass (it has not yet had a chance to verify the reference as genuinely
			// unchanged since the last snapshot), and only cleans it up starting on the
			// second pass. That is intended "verify before delete" behavior, not a bug, so
			// one warm-up pass runs here before the idempotence comparison to avoid a false
			// failure on that legitimate grace period.
			const warmupEditor = createEditor([...lines], { line: 0, ch: mutatedLine.length });
			processor.processAllLines(warmupEditor, 'fuzz.md');
			lines[0] = warmupEditor.getLine(0);
			lines[1] = warmupEditor.getLine(1);

			const firstEditor = createEditor([...lines], { line: 0, ch: lines[0].length });
			processor.processAllLines(firstEditor, 'fuzz.md');
			const firstMutated = firstEditor.getLine(0);
			const firstUnrelated = firstEditor.getLine(1);

			const secondEditor = createEditor([firstMutated, firstUnrelated], {
				line: 0,
				ch: firstMutated.length,
			});
			processor.processAllLines(secondEditor, 'fuzz.md');
			const secondMutated = secondEditor.getLine(0);
			const secondUnrelated = secondEditor.getLine(1);

			expect(secondMutated).toBe(firstMutated);
			expect(secondUnrelated).toBe(firstUnrelated);
			expect(firstUnrelated).toBe(UNRELATED_LINE);
			expect(secondUnrelated).toBe(UNRELATED_LINE);

			assertNoDuplicatedMarkerGlyph(firstMutated);
			assertNoDuplicatedMarkerGlyph(secondMutated);
		}
	});
});
