import { describe, it, expect, vi } from 'vitest';
import { EditorProcessor } from '../src/editor-processor';
import { IndentationHandler } from '../src/indentation-handler';
import { RelationshipAnalyzer } from '../src/relationship-analyzer';
import type { MarkerCacheLike } from '../src/types';
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
	options?: { vaultDepIds?: Set<string>; excludedIds?: Set<string> },
) {
	const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);
	const idEngine = new IdEngine();
	const relAnalyzer = new RelationshipAnalyzer(parser);
	const handler = new IndentationHandler(parser, idEngine, relAnalyzer);
	const processor = new EditorProcessor(
		handler,
		parser,
		relAnalyzer,
		createIdCache(existingIds ?? new Set<string>(), options?.excludedIds),
		createDepCache(options?.vaultDepIds),
	);
	const editor = createMockEditor(lines);
	return { parser, handler, processor, editor, lines };
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

		it('keeps 🆔 when another line still has ⛔ referencing it', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[1]).toContain('🆔 abc123');
			expect(lines[0]).toContain('⛔ abc123');
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

		it('does not remove ⛔ that corresponds to a valid child', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
				'\t- [ ] Child 🆔 abc123',
			], new Set(['abc123']));

			processor.processAllLines(editor, '');

			expect(lines[0]).toContain('⛔ abc123');
			expect(lines[1]).toContain('🆔 abc123');
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
			const handler = new IndentationHandler(spaceParser, idEngine, spaceRelAnalyzer);
			const existingIds = new Set(['abc444', 'abc123']);
			const processor = new EditorProcessor(
				handler, spaceParser, spaceRelAnalyzer, createIdCache(existingIds), createDepCache(),
			);

			const lines = [
				'- [ ] Write tests ⛔ abc444',
				'    - [ ] Build backend ⛔ abc123 🆔 abc444',
				'    - [ ] Design API schema 🆔 abc123',
			];
			const editor = createMockEditor(lines);

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
		it('removes ⛔ from parent when child task line was deleted', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
			]);

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

		it('removes ⛔ for deleted child even when not in managedIds', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ deleted1',
				'\t- [ ] Child A',
			]);

			processor.processAllLines(editor, '');

			expect(lines[0]).not.toContain('deleted1');
		});

		it('preserves ⛔ when referenced 🆔 exists in another vault file (cross-file)', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ abc123',
			], new Set(['abc123']), { excludedIds: new Set(['abc123']) });

			processor.processAllLines(editor, 'current.md');

			expect(lines[0]).toContain('⛔ abc123');
		});

		it('removes ⛔ when referenced 🆔 does not exist in vault either', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent ⛔ ghost1',
			]);

			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Parent');
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

		it('removes dangling ⛔ from non-first line in a list block', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Parent A',
				'\t- [ ] Parent B ⛔ deleted1',
			]);

			processor.processAllLines(editor, '');

			expect(lines[1]).not.toContain('deleted1');
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

		it('removes 🆔 when the ID is NOT in vaultDepIds and no local ⛔ exists', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task with orphaned ID 🆔 abc123',
			], new Set(['abc123']), { vaultDepIds: new Set<string>() });

			processor.processAllLines(editor, '');

			expect(lines[0]).toBe('- [ ] Task with orphaned ID');
		});

		it('works correctly when depCache returns empty set (no cross-file refs)', () => {
			const { processor, editor, lines } = createTestProcessor([
				'- [ ] Task with orphaned ID 🆔 abc123',
			], new Set(['abc123']));

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
});
