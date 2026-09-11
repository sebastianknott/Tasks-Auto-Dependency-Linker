import { describe, it, expect, vi, type Mock } from 'vitest';
import { CleanupPass } from '../../src/processing/cleanup-pass';
import type { DependencyCleaner } from '../../src/linking/dependency-cleaner';
import type { TaskParser } from '../../src/parsing/task-parser';
import type { RelationshipAnalyzer } from '../../src/parsing/relationship-analyzer';
import type { LineWriteArbiter } from '../../src/editing/line-write-arbiter';
import { createCorrectingEditor, createLineEditor } from '../fixtures/editor';

/**
 * Solitary unit test for CleanupPass.
 *
 * CleanupPass calls exactly these collaborator methods: DependencyCleaner's
 * removeStaleDeps / removeDanglingDeps / isIdReferencedAsDep,
 * TaskParser's getTaskId / removeIdFromLine, RelationshipAnalyzer's
 * identifyListBlocks / buildRelationshipMap / getDesiredDepsForParent,
 * two MarkerCacheLike instances (idCache, depCache) via getAll /
 * getAllExcluding, and LineWriteArbiter's getSuppressedDepIds /
 * getFrozenDepsForIndeterminateLine / getFrozenIdForCursorLine. Every one
 * of them is replaced below by a hand-rolled vi.fn() double driven by
 * explicit per-test data. No real DependencyCleaner, TaskParser,
 * RelationshipAnalyzer, MarkerCache or LineWriteArbiter is ever
 * constructed, so nothing else in the codebase can be pinned by this
 * file. The LineEditor doubles come from the shared fixtures, which hold
 * no production dependencies of their own.
 *
 * Several tests deliberately place the current block at a non-zero start
 * line (for example start: 3). CleanupPass converts between a
 * block-relative index and a document-relative index three separate
 * times (cleanStaleDeps passes a block-relative bi straight through,
 * cleanDanglingDeps and cleanOrphanedIds each compute i - start, and
 * applyCleanedLine adds currentBlock.start back), and every one of
 * those conversions is a no-op when the block happens to start at line 0.
 * A block that starts elsewhere is the only way to tell the arithmetic
 * apart from a mutant that drops or flips it.
 */

interface FakeCleaner {
	removeStaleDeps: Mock<(line: string, desiredDeps: Set<string>, managedIds?: Set<string>) => string>;
	removeDanglingDeps: Mock<(line: string, knownIds: Set<string>) => string>;
	isIdReferencedAsDep: Mock<(lines: string[], id: string) => boolean>;
}

function createFakeCleaner(overrides: Partial<FakeCleaner> = {}): FakeCleaner {
	return {
		removeStaleDeps: vi.fn((line: string) => line),
		removeDanglingDeps: vi.fn((line: string) => line),
		isIdReferencedAsDep: vi.fn(() => false),
		...overrides,
	};
}

interface FakeParser {
	getTaskId: Mock<(line: string) => string | null>;
	removeIdFromLine: Mock<(line: string) => string>;
}

function createFakeParser(overrides: Partial<FakeParser> = {}): FakeParser {
	return {
		getTaskId: vi.fn(() => null),
		removeIdFromLine: vi.fn((line: string) => line),
		...overrides,
	};
}

interface FakeRelAnalyzer {
	identifyListBlocks: Mock<(lines: string[]) => Array<{ start: number; end: number }>>;
	buildRelationshipMap: Mock<(lines: string[]) => Map<number, number>>;
	getDesiredDepsForParent: Mock<
		(lines: string[], parentIndex: number, relationships: Map<number, number>) => Set<string>
	>;
}

function createFakeRelAnalyzer(overrides: Partial<FakeRelAnalyzer> = {}): FakeRelAnalyzer {
	return {
		identifyListBlocks: vi.fn(() => []),
		buildRelationshipMap: vi.fn(() => new Map()),
		getDesiredDepsForParent: vi.fn(() => new Set()),
		...overrides,
	};
}

interface FakeMarkerCache {
	getAll: Mock<() => Set<string>>;
	getAllExcluding: Mock<(filePath: string) => Set<string>>;
}

function createFakeMarkerCache(overrides: Partial<FakeMarkerCache> = {}): FakeMarkerCache {
	return {
		getAll: vi.fn(() => new Set()),
		getAllExcluding: vi.fn(() => new Set()),
		...overrides,
	};
}

interface FakeArbiter {
	getSuppressedDepIds: Mock<() => Set<string>>;
	getFrozenDepsForIndeterminateLine: Mock<() => ReadonlySet<string>>;
	getFrozenIdForCursorLine: Mock<() => string | null>;
}

function createFakeArbiter(overrides: Partial<FakeArbiter> = {}): FakeArbiter {
	return {
		getSuppressedDepIds: vi.fn(() => new Set()),
		getFrozenDepsForIndeterminateLine: vi.fn(() => new Set()),
		getFrozenIdForCursorLine: vi.fn(() => null),
		...overrides,
	};
}

interface Fakes {
	cleaner?: FakeCleaner;
	parser?: FakeParser;
	relAnalyzer?: FakeRelAnalyzer;
	idCache?: FakeMarkerCache;
	depCache?: FakeMarkerCache;
	arbiter?: FakeArbiter;
}

/**
 * Wires a CleanupPass from the given fakes, filling in a harmless default
 * for any collaborator the test does not care about. The default
 * RelationshipAnalyzer reports no list blocks at all, so a test that
 * wants any sub-pass to run must supply its own identifyListBlocks.
 */
function buildCleanupPass(fakes: Fakes = {}): { pass: CleanupPass } {
	const cleaner = fakes.cleaner ?? createFakeCleaner();
	const parser = fakes.parser ?? createFakeParser();
	const relAnalyzer = fakes.relAnalyzer ?? createFakeRelAnalyzer();
	const idCache = fakes.idCache ?? createFakeMarkerCache();
	const depCache = fakes.depCache ?? createFakeMarkerCache();
	const arbiter = fakes.arbiter ?? createFakeArbiter();
	const pass = new CleanupPass(
		cleaner as unknown as DependencyCleaner,
		parser as unknown as TaskParser,
		relAnalyzer as unknown as RelationshipAnalyzer,
		idCache,
		depCache,
		arbiter as unknown as LineWriteArbiter,
	);
	return { pass };
}

describe('CleanupPass', () => {
	describe('run: orchestration', () => {
		it('does nothing to any line when identifyListBlocks reports no blocks', () => {
			const relAnalyzer = createFakeRelAnalyzer({ identifyListBlocks: vi.fn(() => []) });
			const cleaner = createFakeCleaner();
			const parser = createFakeParser();
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner, parser });
			const lines = ['ANY_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(relAnalyzer.buildRelationshipMap).not.toHaveBeenCalled();
			expect(cleaner.removeStaleDeps).not.toHaveBeenCalled();
			expect(cleaner.removeDanglingDeps).not.toHaveBeenCalled();
			expect(cleaner.isIdReferencedAsDep).not.toHaveBeenCalled();
			expect(parser.removeIdFromLine).not.toHaveBeenCalled();
			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('passes the given lines snapshot to identifyListBlocks', () => {
			const relAnalyzer = createFakeRelAnalyzer();
			const { pass } = buildCleanupPass({ relAnalyzer });
			const lines = ['A', 'B', 'C'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(relAnalyzer.identifyListBlocks).toHaveBeenCalledWith(lines);
		});

		it('processes blocks in report order, running the three sub-passes stale, dangling, orphan in that order for each block, and computes cross-block state only once', () => {
			const order: string[] = [];
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [
					{ start: 0, end: 1 },
					{ start: 2, end: 3 },
				]),
			});
			const cleaner = createFakeCleaner({
				removeStaleDeps: vi.fn((line: string) => {
					order.push(`stale:${line}`);
					return line;
				}),
				removeDanglingDeps: vi.fn((line: string) => {
					order.push(`dangling:${line}`);
					return line;
				}),
				isIdReferencedAsDep: vi.fn((_lines: string[], id: string) => {
					order.push(`orphan:${id}`);
					return true;
				}),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'id1') });
			const idCache = createFakeMarkerCache();
			const depCache = createFakeMarkerCache();
			const arbiter = createFakeArbiter();
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner, parser, idCache, depCache, arbiter });
			const lines = ['L0', 'SEP', 'L2'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(order).toEqual([
				'stale:L0', 'dangling:L0', 'orphan:id1',
				'stale:L2', 'dangling:L2', 'orphan:id1',
			]);
			expect(idCache.getAllExcluding).toHaveBeenCalledTimes(1);
			expect(depCache.getAll).toHaveBeenCalledTimes(1);
			expect(arbiter.getSuppressedDepIds).toHaveBeenCalledTimes(1);
			expect(arbiter.getFrozenDepsForIndeterminateLine).toHaveBeenCalledTimes(1);
			expect(arbiter.getFrozenIdForCursorLine).toHaveBeenCalledTimes(1);
		});
	});

	describe('run: building vaultDepIds for the orphaned-id pass', () => {
		it('treats an id present in depCache.getAll as a known vault dependency', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'id1') });
			const depCache = createFakeMarkerCache({ getAll: vi.fn(() => new Set(['id1'])) });
			const { pass } = buildCleanupPass({ relAnalyzer, parser, depCache });
			const lines = ['TASK_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(parser.removeIdFromLine).not.toHaveBeenCalled();
		});

		it('treats an id present in arbiter.getSuppressedDepIds as a known vault dependency', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'id1') });
			const arbiter = createFakeArbiter({ getSuppressedDepIds: vi.fn(() => new Set(['id1'])) });
			const { pass } = buildCleanupPass({ relAnalyzer, parser, arbiter });
			const lines = ['TASK_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(parser.removeIdFromLine).not.toHaveBeenCalled();
		});

		it('treats an id present in arbiter.getFrozenDepsForIndeterminateLine as a known vault dependency', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'id1') });
			const arbiter = createFakeArbiter({
				getFrozenDepsForIndeterminateLine: vi.fn(() => new Set(['id1'])),
			});
			const { pass } = buildCleanupPass({ relAnalyzer, parser, arbiter });
			const lines = ['TASK_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(parser.removeIdFromLine).not.toHaveBeenCalled();
		});
	});

	describe('collectKnownIds (observed through the knownIds passed to removeDanglingDeps)', () => {
		it('passes the file path given to run into idCache.getAllExcluding', () => {
			const idCache = createFakeMarkerCache();
			const { pass } = buildCleanupPass({ idCache });
			const lines: string[] = [];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'notes/project.md');

			expect(idCache.getAllExcluding).toHaveBeenCalledWith('notes/project.md');
		});

		it('includes ids from idCache.getAllExcluding in the knownIds set passed to removeDanglingDeps', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const idCache = createFakeMarkerCache({ getAllExcluding: vi.fn(() => new Set(['ext1'])) });
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, idCache, cleaner });
			const lines = ['LINE0'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			const knownIds = cleaner.removeDanglingDeps.mock.calls[0]![1];
			expect(knownIds.has('ext1')).toBe(true);
		});

		it('scans every line in the document, not just the block, for ids to add to knownIds', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 1, end: 2 }]),
			});
			const idMap = new Map<string, string | null>([
				['OUTSIDE_BLOCK', 'outsideId'],
				['INSIDE_BLOCK', null],
			]);
			const parser = createFakeParser({
				getTaskId: vi.fn((line: string) => idMap.get(line) ?? null),
			});
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['OUTSIDE_BLOCK', 'INSIDE_BLOCK'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			const knownIds = cleaner.removeDanglingDeps.mock.calls[0]![1];
			expect(knownIds.has('outsideId')).toBe(true);
		});

		it('adds the frozen cursor-line id from the arbiter to knownIds when present', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const arbiter = createFakeArbiter({ getFrozenIdForCursorLine: vi.fn(() => 'frozenId') });
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, arbiter, cleaner });
			const lines = ['LINE0'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			const knownIds = cleaner.removeDanglingDeps.mock.calls[0]![1];
			expect(knownIds.has('frozenId')).toBe(true);
		});
	});

	describe('collectIdsInRange (observed through blockIds passed to removeStaleDeps)', () => {
		it('collects only the ids of lines within the current block into blockIds', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 1, end: 2 }]),
			});
			const idMap = new Map([
				['BEFORE_BLOCK', 'outId'],
				['IN_BLOCK', 'inId'],
			]);
			const parser = createFakeParser({ getTaskId: vi.fn((line: string) => idMap.get(line) ?? null) });
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['BEFORE_BLOCK', 'IN_BLOCK'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			const managedIds = cleaner.removeStaleDeps.mock.calls[0]![2]!;
			expect(managedIds.has('inId')).toBe(true);
			expect(managedIds.has('outId')).toBe(false);
		});

		it('excludes the line at block.end from blockIds, since the block range is end-exclusive', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const idMap = new Map([
				['IN_BLOCK', 'inId'],
				['AFTER_BLOCK', 'afterId'],
			]);
			const parser = createFakeParser({ getTaskId: vi.fn((line: string) => idMap.get(line) ?? null) });
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['IN_BLOCK', 'AFTER_BLOCK'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			const managedIds = cleaner.removeStaleDeps.mock.calls[0]![2]!;
			expect(managedIds.has('afterId')).toBe(false);
		});
	});

	describe('cleanStaleDeps', () => {
		it('slices the document lines to the current block bounds before building the relationship map', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 1, end: 3 }]),
			});
			const { pass } = buildCleanupPass({ relAnalyzer });
			const lines = ['A', 'B', 'C', 'D'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(relAnalyzer.buildRelationshipMap).toHaveBeenCalledWith(['B', 'C']);
		});

		it('calls getDesiredDepsForParent once per line in the block with the block slice, the block-relative index, and the relationship map', () => {
			const relationships = new Map([[0, -1]]);
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 1, end: 3 }]),
				buildRelationshipMap: vi.fn(() => relationships),
			});
			const { pass } = buildCleanupPass({ relAnalyzer });
			const lines = ['A', 'B', 'C', 'D'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(relAnalyzer.getDesiredDepsForParent).toHaveBeenNthCalledWith(1, ['B', 'C'], 0, relationships);
			expect(relAnalyzer.getDesiredDepsForParent).toHaveBeenNthCalledWith(2, ['B', 'C'], 1, relationships);
		});

		it('calls getDesiredDepsForParent exactly once per line in the block, no more and no fewer', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 3 }]),
			});
			const { pass } = buildCleanupPass({ relAnalyzer });
			const lines = ['A', 'B', 'C'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(relAnalyzer.getDesiredDepsForParent).toHaveBeenCalledTimes(3);
		});

		it('calls removeStaleDeps with the line and the desiredDeps computed for that line', () => {
			const depsMap = new Map<number, Set<string>>([
				[0, new Set(['depForFirst'])],
				[1, new Set(['depForSecond'])],
			]);
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 2 }]),
				getDesiredDepsForParent: vi.fn((_lines: string[], bi: number) => depsMap.get(bi)!),
			});
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner });
			const lines = ['FIRST', 'SECOND'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(cleaner.removeStaleDeps).toHaveBeenNthCalledWith(1, 'FIRST', new Set(['depForFirst']), expect.any(Set));
			expect(cleaner.removeStaleDeps).toHaveBeenNthCalledWith(2, 'SECOND', new Set(['depForSecond']), expect.any(Set));
		});

		it('does not write back through the editor when removeStaleDeps returns the line unchanged', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const cleaner = createFakeCleaner({ removeStaleDeps: vi.fn((line: string) => line) });
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner });
			const lines = ['UNCHANGED_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('writes a stale-dep cleanup at the correct document index for a block that does not start at line 0', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 3, end: 5 }]),
			});
			const cleaner = createFakeCleaner({
				removeStaleDeps: vi.fn((line: string) =>
					line === 'CHILD_LINE' ? 'CHILD_LINE_CLEANED' : line,
				),
			});
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner });
			const lines = ['X0', 'X1', 'X2', 'PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(editor.setLine).toHaveBeenCalledWith(4, 'CHILD_LINE_CLEANED');
			expect(lines[4]).toBe('CHILD_LINE_CLEANED');
		});
	});

	describe('cleanDanglingDeps', () => {
		it('calls removeDanglingDeps once per line inside the block, with that line and the shared knownIds set, and none outside it', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 2, end: 4 }]),
			});
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner });
			const lines = ['X0', 'X1', 'L2', 'L3', 'X4'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(cleaner.removeDanglingDeps).toHaveBeenCalledTimes(2);
			expect(cleaner.removeDanglingDeps).toHaveBeenNthCalledWith(1, 'L2', expect.any(Set));
			expect(cleaner.removeDanglingDeps).toHaveBeenNthCalledWith(2, 'L3', expect.any(Set));
		});

		it('does not write back through the editor when removeDanglingDeps returns the line unchanged', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const cleaner = createFakeCleaner({ removeDanglingDeps: vi.fn((line: string) => line) });
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner });
			const lines = ['UNCHANGED_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('writes a dangling-dep cleanup at the correct document index for a block that does not start at line 0', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 3, end: 5 }]),
			});
			const cleaner = createFakeCleaner({
				removeDanglingDeps: vi.fn((line: string) =>
					line === 'SECOND_LINE' ? 'SECOND_LINE_CLEANED' : line,
				),
			});
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner });
			const lines = ['X0', 'X1', 'X2', 'FIRST_LINE', 'SECOND_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(editor.setLine).toHaveBeenCalledWith(4, 'SECOND_LINE_CLEANED');
			expect(lines[4]).toBe('SECOND_LINE_CLEANED');
		});
	});

	describe('cleanOrphanedIds', () => {
		it('does not remove or check anything for a line that has no id', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => null) });
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['NO_ID_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(cleaner.isIdReferencedAsDep).not.toHaveBeenCalled();
			expect(parser.removeIdFromLine).not.toHaveBeenCalled();
		});

		it('does not remove an id that is still referenced as a dependency somewhere in the document', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'id1') });
			const cleaner = createFakeCleaner({ isIdReferencedAsDep: vi.fn(() => true) });
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['TASK_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(parser.removeIdFromLine).not.toHaveBeenCalled();
		});

		it('passes the full document lines array, not just the block, to isIdReferencedAsDep', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 1, end: 2 }]),
			});
			const parser = createFakeParser({
				getTaskId: vi.fn((line: string) => (line === 'IN_BLOCK' ? 'id1' : null)),
			});
			const cleaner = createFakeCleaner();
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['OUTSIDE_BLOCK', 'IN_BLOCK'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(cleaner.isIdReferencedAsDep).toHaveBeenCalledWith(lines, 'id1');
		});

		it('removes an id that is unreferenced and absent from every vaultDepIds source, writing the result back', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'orphanId'),
				removeIdFromLine: vi.fn(() => 'CLEANED_LINE'),
			});
			const cleaner = createFakeCleaner({ isIdReferencedAsDep: vi.fn(() => false) });
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['ORIGINAL_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(parser.removeIdFromLine).toHaveBeenCalledWith('ORIGINAL_LINE');
			expect(editor.setLine).toHaveBeenCalledWith(0, 'CLEANED_LINE');
		});

		it('writes back through the editor even when removeIdFromLine happens to return the line unchanged, unlike the stale and dangling sub-passes', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'orphanId'),
				removeIdFromLine: vi.fn((line: string) => line),
			});
			const cleaner = createFakeCleaner({ isIdReferencedAsDep: vi.fn(() => false) });
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['SAME_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(editor.setLine).toHaveBeenCalledWith(0, 'SAME_LINE');
		});

		it('writes an orphaned-id removal at the correct document index for a block that does not start at line 0', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 3, end: 5 }]),
			});
			const parser = createFakeParser({
				getTaskId: vi.fn((line: string) => (line === 'SECOND_LINE' ? 'orphanId' : null)),
				removeIdFromLine: vi.fn(() => 'SECOND_LINE_CLEANED'),
			});
			const cleaner = createFakeCleaner({ isIdReferencedAsDep: vi.fn(() => false) });
			const { pass } = buildCleanupPass({ relAnalyzer, parser, cleaner });
			const lines = ['X0', 'X1', 'X2', 'FIRST_LINE', 'SECOND_LINE'];
			const editor = createLineEditor(lines);

			pass.run(editor, lines, 'file.md');

			expect(editor.setLine).toHaveBeenCalledWith(4, 'SECOND_LINE_CLEANED');
			expect(lines[4]).toBe('SECOND_LINE_CLEANED');
		});
	});

	describe('applyCleanedLine', () => {
		it('stores the value editor.setLine actually returns back into the line snapshot, so later sub-passes see the corrected value rather than the originally proposed one', () => {
			const relAnalyzer = createFakeRelAnalyzer({
				identifyListBlocks: vi.fn(() => [{ start: 0, end: 1 }]),
			});
			const cleaner = createFakeCleaner({
				removeStaleDeps: vi.fn((line: string) =>
					line === 'ORIGINAL_LINE' ? 'STALE_CLEANED' : line,
				),
			});
			const { pass } = buildCleanupPass({ relAnalyzer, cleaner });
			const lines = ['ORIGINAL_LINE'];
			const editor = createCorrectingEditor(lines, (_n, text) =>
				text === 'STALE_CLEANED' ? 'CORRECTED_BY_EDITOR' : text,
			);

			pass.run(editor, lines, 'file.md');

			expect(cleaner.removeDanglingDeps).toHaveBeenCalledWith('CORRECTED_BY_EDITOR', expect.any(Set));
			expect(lines[0]).toBe('CORRECTED_BY_EDITOR');
		});
	});
});
