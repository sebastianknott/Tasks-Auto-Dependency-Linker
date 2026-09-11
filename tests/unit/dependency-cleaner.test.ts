import { describe, it, expect } from 'vitest';
import { DependencyCleaner } from '../../src/linking/dependency-cleaner';
import { TaskParser } from '../../src/parsing/task-parser';

describe('DependencyCleaner', () => {
	const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);

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
			const cleaner = new DependencyCleaner(parser);
			expect(cleaner.removeStaleDeps(line, desiredSet)).toBe(expected);
		});
	});

	describe('removeStaleDeps with managedIds', () => {
		it.each<[string, string, Set<string>, Set<string> | undefined, string]>([
			[
				'removes a dep that is in managedIds and not desired',
				'- [ ] Parent ⛔ abc123',
				new Set(),
				new Set(['abc123']),
				'- [ ] Parent',
			],
			[
				'leaves a dep untouched when managedIds does not include it, even though it is not desired',
				'- [ ] Parent ⛔ abc123',
				new Set(),
				new Set(['other999']),
				'- [ ] Parent ⛔ abc123',
			],
		])('%s', (_description, line, desiredSet, managedIds, expected) => {
			const cleaner = new DependencyCleaner(parser);
			expect(cleaner.removeStaleDeps(line, desiredSet, managedIds)).toBe(expected);
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
			const cleaner = new DependencyCleaner(parser);
			expect(cleaner.isIdReferencedAsDep(lines, id)).toBe(expected);
		});
	});

	describe('removeDanglingDeps', () => {
		it.each<[string, string, Set<string>, string]>([
			[
				'keeps a dep whose id is known',
				'- [ ] Parent ⛔ abc123',
				new Set(['abc123']),
				'- [ ] Parent ⛔ abc123',
			],
			[
				'removes a dep whose id is not known',
				'- [ ] Parent ⛔ abc123',
				new Set(),
				'- [ ] Parent',
			],
			[
				'removes only the unknown id from a mixed list, keeping the known one',
				'- [ ] Parent ⛔ abc123,def456',
				new Set(['abc123']),
				'- [ ] Parent ⛔ abc123',
			],
			[
				'returns line unchanged when no deps exist',
				'- [ ] Parent',
				new Set(),
				'- [ ] Parent',
			],
		])('%s', (_description, line, knownIds, expected) => {
			const cleaner = new DependencyCleaner(parser);
			expect(cleaner.removeDanglingDeps(line, knownIds)).toBe(expected);
		});
	});
});
