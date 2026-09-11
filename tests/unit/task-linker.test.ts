import { describe, it, expect, vi, type Mock } from 'vitest';
import { TaskLinker } from '../../src/linking/task-linker';
import type { TaskParser } from '../../src/parsing/task-parser';
import type { IdGenerator } from '../../src/linking/id-generator';
import type { RelationshipAnalyzer } from '../../src/parsing/relationship-analyzer';
import type { MetadataInheritor } from '../../src/linking/metadata-inheritor';
import {
	createCorrectingEditor,
	createLineEditor,
	createRefusingEditor,
} from '../fixtures/editor';

/**
 * Solitary unit test for TaskLinker.
 *
 * TaskLinker calls exactly these collaborator methods:
 * RelationshipAnalyzer.findParentTask, TaskParser.getTaskId /
 * addIdToLine / addDependencyToLine / getTaskDependencies,
 * IdGenerator.generateUniqueId, and MetadataInheritor.syncFromParent /
 * confirmWrite. Every one of them is replaced below by a hand-rolled
 * vi.fn() double, driven by explicit per-test data. No real
 * RelationshipAnalyzer, TaskParser, IdGenerator or MetadataInheritor is
 * ever constructed, so nothing else in the codebase can be pinned by
 * this file. The LineEditor double comes from the shared fixtures,
 * which hold no production dependencies of their own.
 */

interface FakeParser {
	getTaskId: Mock<(line: string) => string | null>;
	addIdToLine: Mock<(line: string, id: string) => string>;
	addDependencyToLine: Mock<(line: string, depId: string) => string>;
	getTaskDependencies: Mock<(line: string) => string[]>;
}

function createFakeParser(overrides: Partial<FakeParser> = {}): FakeParser {
	return {
		getTaskId: vi.fn(() => null),
		addIdToLine: vi.fn((line: string) => line),
		addDependencyToLine: vi.fn((line: string) => line),
		getTaskDependencies: vi.fn(() => []),
		...overrides,
	};
}

interface FakeRelAnalyzer {
	findParentTask: Mock<(lines: string[], lineIndex: number) => number | null>;
}

function createFakeRelAnalyzer(
	impl: (lines: string[], lineIndex: number) => number | null,
): FakeRelAnalyzer {
	return { findParentTask: vi.fn(impl) };
}

interface FakeIdGenerator {
	generateUniqueId: Mock<(existingIds: ReadonlySet<string>) => string>;
}

function createFakeIdGenerator(id: string): FakeIdGenerator {
	return { generateUniqueId: vi.fn(() => id) };
}

interface FakeInheritor {
	syncFromParent: Mock<(childId: string, childLine: string, parentLine: string) => string>;
	confirmWrite: Mock<(writtenLine: string) => void>;
}

function createFakeInheritor(overrides: Partial<FakeInheritor> = {}): FakeInheritor {
	return {
		syncFromParent: vi.fn((_childId: string, childLine: string) => childLine),
		confirmWrite: vi.fn(),
		...overrides,
	};
}

interface Fakes {
	parser?: FakeParser;
	idGenerator?: FakeIdGenerator;
	relAnalyzer?: FakeRelAnalyzer;
	inheritor?: FakeInheritor;
}

interface Built {
	linker: TaskLinker;
	parser: FakeParser;
	idGenerator: FakeIdGenerator;
	relAnalyzer: FakeRelAnalyzer;
	inheritor: FakeInheritor;
}

/**
 * Wires a TaskLinker from the given fakes, filling in a harmless default
 * for any collaborator the test does not care about. The default
 * RelationshipAnalyzer reports line 0 as the parent, the default
 * TaskParser reports no existing id and passes lines through unchanged,
 * the default IdGenerator always mints 'minted1', and the default
 * MetadataInheritor proposes no change and confirms without side effects.
 */
function buildLinker(fakes: Fakes = {}): Built {
	const parser = fakes.parser ?? createFakeParser();
	const idGenerator = fakes.idGenerator ?? createFakeIdGenerator('minted1');
	const relAnalyzer = fakes.relAnalyzer ?? createFakeRelAnalyzer(() => 0);
	const inheritor = fakes.inheritor ?? createFakeInheritor();
	const linker = new TaskLinker(
		parser as unknown as TaskParser,
		idGenerator as unknown as IdGenerator,
		relAnalyzer as unknown as RelationshipAnalyzer,
		inheritor as unknown as MetadataInheritor,
	);
	return { linker, parser, idGenerator, relAnalyzer, inheritor };
}

describe('TaskLinker', () => {
	describe('prepareForLinkPass', () => {
		it('builds an empty snapshot when the editor has no lines', () => {
			const relAnalyzer = createFakeRelAnalyzer(() => null);
			const { linker } = buildLinker({ relAnalyzer });
			const editor = createLineEditor([]);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 0, new Set());

			expect(relAnalyzer.findParentTask).toHaveBeenCalledWith([], 0);
		});

		it('snapshots the editor lines once and reuses that snapshot on later processLine calls', () => {
			const relAnalyzer = createFakeRelAnalyzer(() => null);
			const { linker } = buildLinker({ relAnalyzer });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			// Mutate the backing array directly, bypassing editor.setLine,
			// to prove processLine consults the stored snapshot rather than
			// re-reading the editor on every call.
			lines[1] = 'CHANGED_AFTER_SNAPSHOT';
			linker.processLine(editor, 1, new Set());

			expect(relAnalyzer.findParentTask).toHaveBeenCalledWith(
				['PARENT_LINE', 'CHILD_LINE'],
				1,
			);
		});
	});

	describe('processLine: locating the parent', () => {
		it('returns null and touches no other collaborator when there is no parent', () => {
			const parser = createFakeParser();
			const idGenerator = createFakeIdGenerator('minted1');
			const inheritor = createFakeInheritor();
			const relAnalyzer = createFakeRelAnalyzer(() => null);
			const { linker } = buildLinker({ parser, idGenerator, inheritor, relAnalyzer });
			const editor = createLineEditor(['ROOT_LINE']);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 0, new Set());

			expect(result).toBeNull();
			expect(parser.getTaskId).not.toHaveBeenCalled();
			expect(idGenerator.generateUniqueId).not.toHaveBeenCalled();
			expect(inheritor.syncFromParent).not.toHaveBeenCalled();
			expect(inheritor.confirmWrite).not.toHaveBeenCalled();
			expect(editor.setLine).not.toHaveBeenCalled();
		});

		it('passes the current snapshot and the given line index to findParentTask', () => {
			const relAnalyzer = createFakeRelAnalyzer(() => null);
			const { linker } = buildLinker({ relAnalyzer });
			const lines = ['A_LINE', 'B_LINE', 'C_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 2, new Set());

			expect(relAnalyzer.findParentTask).toHaveBeenCalledWith(lines, 2);
		});
	});

	describe('processLine: minting a child id', () => {
		it('does not mint or add an id when the child parser already reports one', () => {
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'existing1') });
			const idGenerator = createFakeIdGenerator('minted1');
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const { linker } = buildLinker({ parser, idGenerator, relAnalyzer });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(idGenerator.generateUniqueId).not.toHaveBeenCalled();
			expect(parser.addIdToLine).not.toHaveBeenCalled();
			expect(parser.addDependencyToLine).toHaveBeenCalledWith('PARENT_LINE', 'existing1');
		});

		it('mints an id via idGenerator when the child parser reports none, passing the given existingIds set through untouched', () => {
			const parser = createFakeParser();
			const idGenerator = createFakeIdGenerator('minted1');
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const { linker } = buildLinker({ parser, idGenerator, relAnalyzer });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);
			const existingIds = new Set(['other1']);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, existingIds);

			expect(idGenerator.generateUniqueId).toHaveBeenCalledWith(existingIds);
			expect(parser.addIdToLine).toHaveBeenCalledWith('CHILD_LINE', 'minted1');
			expect(parser.addDependencyToLine).toHaveBeenCalledWith('PARENT_LINE', 'minted1');
			expect(result).toBe('minted1');
		});

		it('uses the id-augmented line returned by addIdToLine as the child line for the rest of the call', () => {
			const parser = createFakeParser({
				addIdToLine: vi.fn(() => 'CHILD_LINE_WITH_ID'),
			});
			const idGenerator = createFakeIdGenerator('minted1');
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor();
			const { linker } = buildLinker({ parser, idGenerator, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			// Default addDependencyToLine passes the parent line through
			// unchanged, so no parent write happens and the flow reaches
			// syncFromParent directly with the id-augmented child line.
			expect(inheritor.syncFromParent).toHaveBeenCalledWith(
				'minted1',
				'CHILD_LINE_WITH_ID',
				'PARENT_LINE',
			);
		});
	});

	describe('processLine: writing the dependency onto the parent', () => {
		it('does not write the parent line when addDependencyToLine reports no change', () => {
			// The parent already carries the dependency, so
			// addDependencyToLine returns the parent line unchanged. The
			// child line does change (the inheritor proposes a new value),
			// so exactly one write happens. If the parent guard were
			// replaced by an unconditional write, a second setLine call
			// for the parent index would appear alongside it.
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'existing1'),
				addDependencyToLine: vi.fn((line: string) => line),
			});
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor({
				syncFromParent: vi.fn(() => 'CHILD_LINE_CHANGED'),
			});
			const { linker } = buildLinker({ parser, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(editor.setLine).toHaveBeenCalledTimes(1);
			expect(editor.setLine).toHaveBeenCalledWith(1, 'CHILD_LINE_CHANGED');
		});

		it('writes the updated parent line when addDependencyToLine proposes a different line', () => {
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'existing1'),
				addDependencyToLine: vi.fn(() => 'PARENT_LINE_WITH_DEP'),
			});
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const { linker } = buildLinker({ parser, relAnalyzer });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(editor.setLine).toHaveBeenCalledWith(0, 'PARENT_LINE_WITH_DEP');
		});
	});

	describe('processLine: the atomic mint-and-link check', () => {
		it('never calls getTaskDependencies when no id was minted, even if the parent line changed', () => {
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'existing1'),
				addDependencyToLine: vi.fn(() => 'PARENT_LINE_WITH_DEP'),
			});
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const { linker, parser: fakeParser } = buildLinker({ parser, relAnalyzer });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(fakeParser.getTaskDependencies).not.toHaveBeenCalled();
		});

		it('checks the dependencies of the line the editor actually stored, not the one that was proposed', () => {
			const parser = createFakeParser({
				addDependencyToLine: vi.fn(() => 'PROPOSED_PARENT_LINE'),
				getTaskDependencies: vi.fn(() => ['minted1']),
			});
			const idGenerator = createFakeIdGenerator('minted1');
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const { linker } = buildLinker({ parser, idGenerator, relAnalyzer });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createCorrectingEditor(lines, (n, text) =>
				n === 0 ? 'CORRECTED_PARENT_LINE' : text,
			);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(parser.getTaskDependencies).toHaveBeenCalledWith('CORRECTED_PARENT_LINE');
		});

		it('abandons the mint and never touches the child when the written parent line lacks the minted id', () => {
			const parser = createFakeParser({
				addDependencyToLine: vi.fn(() => 'PARENT_LINE_WITH_DEP'),
				getTaskDependencies: vi.fn(() => []),
			});
			const idGenerator = createFakeIdGenerator('minted1');
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor();
			const { linker } = buildLinker({ parser, idGenerator, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createRefusingEditor(lines);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, new Set());

			expect(result).toBeNull();
			expect(inheritor.syncFromParent).not.toHaveBeenCalled();
			expect(inheritor.confirmWrite).not.toHaveBeenCalled();
			expect(lines[1]).toBe('CHILD_LINE');
			expect(
				editor.setLine.mock.calls.some(([n]: [number, string]) => n === 1),
			).toBe(false);
		});

		it('keeps the mint and proceeds normally when the written parent line does contain the minted id', () => {
			const parser = createFakeParser({
				addDependencyToLine: vi.fn(() => 'PARENT_LINE_WITH_DEP'),
				getTaskDependencies: vi.fn(() => ['minted1', 'other']),
			});
			const idGenerator = createFakeIdGenerator('minted1');
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor();
			const { linker } = buildLinker({ parser, idGenerator, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createCorrectingEditor(lines, (n, text) =>
				n === 0 ? 'CORRECTED_PARENT_LINE_WITH_DEP' : text,
			);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, new Set());

			expect(result).toBe('minted1');
			expect(inheritor.syncFromParent).toHaveBeenCalled();
			expect(inheritor.confirmWrite).toHaveBeenCalled();
		});
	});

	describe('processLine: metadata inheritance hookup', () => {
		it('passes the pre-write parent line to syncFromParent, not the line the editor actually stored', () => {
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'existing1'),
				addDependencyToLine: vi.fn(() => 'PARENT_LINE_WITH_DEP'),
			});
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor();
			const { linker } = buildLinker({ parser, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createCorrectingEditor(lines, (n, text) =>
				n === 0 ? 'CORRECTED_PARENT_LINE' : text,
			);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(inheritor.syncFromParent).toHaveBeenCalledWith(
				'existing1',
				'CHILD_LINE',
				'PARENT_LINE',
			);
		});

		it('does not write the child line back when syncFromParent reports no change', () => {
			// The parent line does change (addDependencyToLine proposes a
			// new value), so exactly one write happens. If the child guard
			// were replaced by an unconditional write, a second setLine
			// call for the child index would appear alongside it.
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'existing1'),
				addDependencyToLine: vi.fn(() => 'PARENT_LINE_WITH_DEP'),
			});
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor({
				syncFromParent: vi.fn((_id: string, childLine: string) => childLine),
			});
			const { linker } = buildLinker({ parser, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(editor.setLine).toHaveBeenCalledTimes(1);
			expect(editor.setLine).toHaveBeenCalledWith(0, 'PARENT_LINE_WITH_DEP');
		});

		it('writes the synced child line back when syncFromParent proposes a change', () => {
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'existing1') });
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor({
				syncFromParent: vi.fn(() => 'CHILD_LINE_WITH_METADATA'),
			});
			const { linker } = buildLinker({ parser, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(editor.setLine).toHaveBeenCalledWith(1, 'CHILD_LINE_WITH_METADATA');
		});
	});

	describe('processLine: confirming the write', () => {
		it('confirms with the line the editor actually holds after the child write, not the proposed one', () => {
			const parser = createFakeParser({ getTaskId: vi.fn(() => 'existing1') });
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor({
				syncFromParent: vi.fn(() => 'PROPOSED_CHILD_LINE'),
			});
			const { linker } = buildLinker({ parser, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createCorrectingEditor(lines, (n, text) =>
				n === 1 ? 'CORRECTED_CHILD_LINE' : text,
			);

			linker.prepareForLinkPass(editor);
			linker.processLine(editor, 1, new Set());

			expect(inheritor.confirmWrite).toHaveBeenCalledWith('CORRECTED_CHILD_LINE');
		});

		it('confirms with the original untouched line and writes nothing when nothing changed', () => {
			const parser = createFakeParser({
				getTaskId: vi.fn(() => 'existing1'),
				addDependencyToLine: vi.fn((line: string) => line),
			});
			const relAnalyzer = createFakeRelAnalyzer(() => 0);
			const inheritor = createFakeInheritor();
			const { linker } = buildLinker({ parser, relAnalyzer, inheritor });
			const lines = ['PARENT_LINE', 'CHILD_LINE'];
			const editor = createLineEditor(lines);

			linker.prepareForLinkPass(editor);
			const result = linker.processLine(editor, 1, new Set());

			expect(inheritor.confirmWrite).toHaveBeenCalledWith('CHILD_LINE');
			expect(editor.setLine).not.toHaveBeenCalled();
			expect(result).toBeNull();
		});
	});
});
