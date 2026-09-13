import { describe, it, expect } from 'vitest';
import { TaskParser } from '../../src/parsing/task-parser';

/**
 * Property suite for the id and dependency marker regexes owned by
 * TaskParser. TaskParser is driven directly here, with no accessor facade
 * in between: every accessor method for id and dependency is a one-line
 * delegation to a TaskParser method, so laws like "remove is idempotent" or
 * "read(remove(line)) is null" are properties of TaskParser's own regexes,
 * merely observed through that facade. Naming TaskParser as the subject and
 * calling it directly makes the pinning honest.
 *
 * The accessor-level behaviour these laws used to share a file with, the
 * hasFragment conjunction that combines a glyph check with a read() call,
 * is genuinely owned by the accessor rather than by TaskParser, and stays
 * covered by tests/unit/marker-accessor.test.ts.
 *
 * All corpus lines are enumerated deterministically from a fixed seed list
 * (no randomness, no time dependent input) so this suite produces identical
 * results on every run, including every run StrykerJS performs while
 * mutating src/.
 *
 * This file was split out of the former
 * tests/unit/marker-accessor.invariants.test.ts. The due, scheduled and
 * priority properties now live in
 * tests/unit/task-metadata-parser.invariants.test.ts, driven directly
 * against TaskMetadataParser.
 */

// Seed lines chosen to cover every marker shape relevant to id and dependency
// behavior: id only, dependency with one id, dependency with two ids, due
// date, scheduled date, a priority glyph, several markers combined on one
// line, and a marker glyph embedded in ordinary prose (the deliberately
// accepted edge case). The seeds carry every marker family, not only id and
// dependency, because a marker's regex must ignore fragments and full values
// of every other marker family sharing the same line.
const SEEDS: readonly string[] = [
	'- [ ] Task \u{1F194} abc123',
	'- [ ] Task \u26D4 abc123',
	'- [ ] Task \u26D4 abc123,def456',
	'- [ ] Task \u{1F4C5} 2025-11-15',
	'- [ ] Task \u23F3 2025-11-15',
	'- [ ] Task \u23EB',
	'- [ ] Task \u{1F194} abc123 \u26D4 def456,ghi789 \u{1F4C5} 2025-11-15 \u23F3 2025-11-20 \u23EB',
	'- [ ] call Bob \u{1F4C5} sometime',
];

function truncations(seed: string): string[] {
	const states: string[] = [];
	for (let i = seed.length; i >= 0; i -= 1) {
		states.push(seed.slice(0, i));
	}
	return states;
}

function singleCharDeletions(seed: string): string[] {
	const states: string[] = [];
	for (let i = 0; i < seed.length; i += 1) {
		states.push(seed.slice(0, i) + seed.slice(i + 1));
	}
	return states;
}

// Full pure-function corpus: every seed, every progressive truncation of every
// seed, and every single-character deletion of every seed, deduplicated. This
// corpus is cheap to run (pure functions, no editor simulation), so it uses
// the widest enumeration the task allows rather than truncation-only.
const CORPUS: readonly string[] = Array.from(
	new Set(SEEDS.flatMap((seed) => [seed, ...truncations(seed), ...singleCharDeletions(seed)])),
);

const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);

describe('TaskParser.removeIdFromLine idempotence', () => {
	it('applying removeIdFromLine twice equals applying it once, for every corpus line', () => {
		for (const line of CORPUS) {
			const once = parser.removeIdFromLine(line);
			const twice = parser.removeIdFromLine(once);
			expect(twice).toBe(once);
		}
	});
});

describe('TaskParser.removeDependencyFromLine idempotence', () => {
	it('applying removeDependencyFromLine twice equals applying it once, for every id present plus a synthetic id', () => {
		for (const line of CORPUS) {
			const ids = new Set(parser.getTaskDependencies(line));
			ids.add('zzzzzz');
			for (const depId of ids) {
				const once = parser.removeDependencyFromLine(line, depId);
				const twice = parser.removeDependencyFromLine(once, depId);
				expect(twice).toBe(once);
			}
		}
	});
});

describe('TaskParser.getTaskId after removeIdFromLine', () => {
	it('getTaskId(removeIdFromLine(line)) is null for every corpus line', () => {
		for (const line of CORPUS) {
			expect(parser.getTaskId(parser.removeIdFromLine(line))).toBeNull();
		}
	});
});

describe('TaskParser.getTaskDependencies after removeDependencyFromLine', () => {
	it('the removed id is never present in getTaskDependencies(removeDependencyFromLine(line, depId))', () => {
		for (const line of CORPUS) {
			const ids = new Set(parser.getTaskDependencies(line));
			ids.add('zzzzzz');
			for (const depId of ids) {
				const remaining = new Set(
					parser.getTaskDependencies(parser.removeDependencyFromLine(line, depId)),
				);
				expect(remaining.has(depId)).toBe(false);
			}
		}
	});
});

describe('TaskParser.getTaskId never throws', () => {
	it('never throws for any corpus line', () => {
		for (const line of CORPUS) {
			expect(() => parser.getTaskId(line)).not.toThrow();
		}
	});
});

describe('TaskParser.getTaskId well-formed values', () => {
	it('returns null or a value matching the id character class', () => {
		for (const line of CORPUS) {
			const value = parser.getTaskId(line);
			if (value !== null) {
				expect(value).toMatch(/^[a-zA-Z0-9_-]+$/);
			}
		}
	});
});

describe('TaskParser.getTaskDependencies never throws', () => {
	it('never throws and returns ids matching the id character class, for every corpus line', () => {
		for (const line of CORPUS) {
			expect(() => parser.getTaskDependencies(line)).not.toThrow();
			for (const depId of parser.getTaskDependencies(line)) {
				expect(depId).toMatch(/^[a-zA-Z0-9_-]+$/);
			}
		}
	});
});

/**
 * Round-trip invariant: for any line that does not already carry an id or
 * dependency marker, applying that marker and then removing it must restore
 * the original line byte for byte, including any trailing whitespace the
 * line already had. Every apply appends exactly one separator space plus
 * its glyph, so removal must consume exactly that one separator character,
 * never a whole trailing whitespace run. The corpus below exercises every
 * whitespace shape the user is likely to leave behind: no trailing
 * whitespace, a single trailing space, two trailing spaces (a Markdown hard
 * line break), a trailing tab, and a line that already ends with a
 * different marker type entirely.
 */
const ROUND_TRIP_BASE = '- [ ] Task';

// A distinct, unrelated marker glyph appended at the end of a line before
// applying the marker under test, proving that apply/remove interacts only
// with its own marker and leaves a pre-existing foreign marker untouched.
function roundTripCorpusFor(foreignSuffix: string): readonly string[] {
	return [
		ROUND_TRIP_BASE,
		`${ROUND_TRIP_BASE} `,
		`${ROUND_TRIP_BASE}  `,
		`${ROUND_TRIP_BASE}\t`,
		`${ROUND_TRIP_BASE}${foreignSuffix}`,
	];
}

describe('TaskParser id apply/remove round trip', () => {
	it('removeIdFromLine(addIdToLine(removeIdFromLine(line), value)) restores the original line exactly', () => {
		const value = 'abc123';
		for (const line of roundTripCorpusFor(' \u23EB')) {
			const applied = parser.addIdToLine(parser.removeIdFromLine(line), value);
			const restored = parser.removeIdFromLine(applied);
			expect(restored).toBe(line);
		}
	});
});

describe('TaskParser dependency apply/remove round trip', () => {
	it('removeDependencyFromLine(addDependencyToLine(line, depId), depId) restores the original line exactly', () => {
		const depId = 'dep123';
		for (const line of roundTripCorpusFor(' \u23EB')) {
			const applied = parser.addDependencyToLine(line, depId);
			const restored = parser.removeDependencyFromLine(applied, depId);
			expect(restored).toBe(line);
		}
	});
});
