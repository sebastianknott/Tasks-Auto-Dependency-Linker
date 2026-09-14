import { describe, it, expect, vi, type Mock } from 'vitest';
import { DependencyCleaner } from '../../src/linking/dependency-cleaner';
import type { TaskParser } from '../../src/parsing/task-parser';

interface FakeParser {
	getTaskDependencies: Mock<(line: string) => string[]>;
	removeDependencyFromLine: Mock<(line: string, depId: string) => string>;
}

function fakeParser(overrides: Partial<FakeParser> = {}): FakeParser {
	return {
		getTaskDependencies: vi.fn(() => []),
		removeDependencyFromLine: vi.fn((line: string) => line),
		...overrides,
	};
}

function buildCleaner(parser: FakeParser): DependencyCleaner {
	return new DependencyCleaner(parser as unknown as TaskParser);
}

describe('DependencyCleaner', () => {
	describe('removeStaleDeps', () => {
		it('returns the line unchanged and never removes when there are no deps', () => {
			const parser = fakeParser({ getTaskDependencies: vi.fn(() => []) });
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeStaleDeps('LINE', new Set(['abc123']));

			expect(result).toBe('LINE');
			expect(parser.removeDependencyFromLine).not.toHaveBeenCalled();
		});

		it('leaves a dep untouched when it is in the desired set', () => {
			const parser = fakeParser({ getTaskDependencies: vi.fn(() => ['abc123']) });
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeStaleDeps('LINE', new Set(['abc123']));

			expect(result).toBe('LINE');
			expect(parser.removeDependencyFromLine).not.toHaveBeenCalled();
		});

		it('removes only the dep that is not in the desired set, keeping the other', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn(() => ['keep1', 'remove1']),
				removeDependencyFromLine: vi.fn(() => 'AFTER_REMOVE1'),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeStaleDeps('LINE', new Set(['keep1']));

			expect(result).toBe('AFTER_REMOVE1');
			expect(parser.removeDependencyFromLine).toHaveBeenCalledTimes(1);
			expect(parser.removeDependencyFromLine).toHaveBeenCalledWith('LINE', 'remove1');
		});

		it('threads the accumulator through successive removals: the second call receives the first result, not the original line', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn(() => ['dep1', 'dep2']),
				removeDependencyFromLine: vi
					.fn<(line: string, depId: string) => string>()
					.mockReturnValueOnce('AFTER_DEP1')
					.mockReturnValueOnce('AFTER_DEP2'),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeStaleDeps('ORIGINAL_LINE', new Set());

			expect(result).toBe('AFTER_DEP2');
			expect(parser.getTaskDependencies).toHaveBeenCalledTimes(1);
			expect(parser.getTaskDependencies).toHaveBeenCalledWith('ORIGINAL_LINE');
			expect(parser.removeDependencyFromLine).toHaveBeenNthCalledWith(1, 'ORIGINAL_LINE', 'dep1');
			expect(parser.removeDependencyFromLine).toHaveBeenNthCalledWith(2, 'AFTER_DEP1', 'dep2');
		});
	});

	describe('removeStaleDeps with managedIds', () => {
		it('removes a dep that is in managedIds and not desired', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn(() => ['abc123']),
				removeDependencyFromLine: vi.fn(() => 'LINE_WITHOUT_abc123'),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeStaleDeps('LINE', new Set(), new Set(['abc123']));

			expect(result).toBe('LINE_WITHOUT_abc123');
			expect(parser.removeDependencyFromLine).toHaveBeenCalledWith('LINE', 'abc123');
		});

		it('leaves a dep untouched when managedIds does not include it, even though it is not desired', () => {
			const parser = fakeParser({ getTaskDependencies: vi.fn(() => ['abc123']) });
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeStaleDeps('LINE', new Set(), new Set(['other999']));

			expect(result).toBe('LINE');
			expect(parser.removeDependencyFromLine).not.toHaveBeenCalled();
		});
	});

	describe('isIdReferencedAsDep', () => {
		it('returns true and stops looking once the id is found on the first line', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn((line: string) => (line === 'LINE_A' ? ['abc123'] : ['should-not-be-read'])),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.isIdReferencedAsDep(['LINE_A', 'LINE_B'], 'abc123');

			expect(result).toBe(true);
			expect(parser.getTaskDependencies).toHaveBeenCalledTimes(1);
			expect(parser.getTaskDependencies).toHaveBeenCalledWith('LINE_A');
		});

		it('returns true when the id is found on a later line', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn((line: string) => (line === 'LINE_B' ? ['abc123'] : [])),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.isIdReferencedAsDep(['LINE_A', 'LINE_B'], 'abc123');

			expect(result).toBe(true);
			expect(parser.getTaskDependencies).toHaveBeenCalledTimes(2);
			expect(parser.getTaskDependencies).toHaveBeenNthCalledWith(1, 'LINE_A');
			expect(parser.getTaskDependencies).toHaveBeenNthCalledWith(2, 'LINE_B');
		});

		it('returns false when no line references the id', () => {
			const parser = fakeParser({ getTaskDependencies: vi.fn(() => ['def456']) });
			const cleaner = buildCleaner(parser);

			const result = cleaner.isIdReferencedAsDep(['LINE_A', 'LINE_B'], 'abc123');

			expect(result).toBe(false);
			expect(parser.getTaskDependencies).toHaveBeenCalledTimes(2);
		});

		it('returns false for an empty lines array without consulting the parser', () => {
			const parser = fakeParser();
			const cleaner = buildCleaner(parser);

			const result = cleaner.isIdReferencedAsDep([], 'abc123');

			expect(result).toBe(false);
			expect(parser.getTaskDependencies).not.toHaveBeenCalled();
		});
	});

	describe('removeDanglingDeps', () => {
		it('keeps a dep whose id is known', () => {
			const parser = fakeParser({ getTaskDependencies: vi.fn(() => ['abc123']) });
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeDanglingDeps('LINE', new Set(['abc123']));

			expect(result).toBe('LINE');
			expect(parser.removeDependencyFromLine).not.toHaveBeenCalled();
		});

		it('removes a dep whose id is not known', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn(() => ['abc123']),
				removeDependencyFromLine: vi.fn(() => 'LINE_WITHOUT_abc123'),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeDanglingDeps('LINE', new Set());

			expect(result).toBe('LINE_WITHOUT_abc123');
			expect(parser.removeDependencyFromLine).toHaveBeenCalledTimes(1);
			expect(parser.removeDependencyFromLine).toHaveBeenCalledWith('LINE', 'abc123');
		});

		it('removes only the unknown id from a mixed list, keeping the known one', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn(() => ['abc123', 'def456']),
				removeDependencyFromLine: vi.fn(() => 'LINE_WITHOUT_def456'),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeDanglingDeps('LINE', new Set(['abc123']));

			expect(result).toBe('LINE_WITHOUT_def456');
			expect(parser.removeDependencyFromLine).toHaveBeenCalledTimes(1);
			expect(parser.removeDependencyFromLine).toHaveBeenCalledWith('LINE', 'def456');
		});

		it('threads the accumulator through successive removals: the second call receives the first result, not the original line', () => {
			const parser = fakeParser({
				getTaskDependencies: vi.fn(() => ['dep1', 'dep2']),
				removeDependencyFromLine: vi
					.fn<(line: string, depId: string) => string>()
					.mockReturnValueOnce('AFTER_DEP1')
					.mockReturnValueOnce('AFTER_DEP2'),
			});
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeDanglingDeps('ORIGINAL_LINE', new Set());

			expect(result).toBe('AFTER_DEP2');
			expect(parser.removeDependencyFromLine).toHaveBeenNthCalledWith(1, 'ORIGINAL_LINE', 'dep1');
			expect(parser.removeDependencyFromLine).toHaveBeenNthCalledWith(2, 'AFTER_DEP1', 'dep2');
		});

		it('returns the line unchanged when there are no deps', () => {
			const parser = fakeParser({ getTaskDependencies: vi.fn(() => []) });
			const cleaner = buildCleaner(parser);

			const result = cleaner.removeDanglingDeps('LINE', new Set());

			expect(result).toBe('LINE');
			expect(parser.removeDependencyFromLine).not.toHaveBeenCalled();
		});
	});
});
