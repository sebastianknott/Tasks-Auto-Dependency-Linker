import { describe, it, expect } from 'vitest';
import type { Priority } from '../../src/parsing/task-metadata-parser';
import { TaskMetadataParser } from '../../src/parsing/task-metadata-parser';

/**
 * Property suite for the due, scheduled and priority marker regexes owned
 * by TaskMetadataParser. TaskMetadataParser is driven directly here, with
 * no accessor facade in between, because a leakage probe run per section
 * 4.5 of docs/solitary-unit-coverage.md showed that the former
 * accessor-driven version of this suite killed mutants inside TaskParser
 * and TaskMetadataParser: every accessor method for due, scheduled and
 * priority is a one-line delegation to a TaskMetadataParser method, so laws
 * like "remove is idempotent" or "read(remove(line)) is null" are
 * properties of TaskMetadataParser's own regexes, merely observed through
 * that facade. Naming TaskMetadataParser as the subject and calling it
 * directly makes the pinning honest.
 *
 * The accessor-level behaviour these laws used to share a file with, the
 * hasFragment conjunction that combines a glyph check with a read() call,
 * is genuinely owned by the accessor rather than by TaskMetadataParser, and
 * stays covered by tests/unit/marker-accessor.test.ts, which already
 * exercises it to a full mutation score without this suite's help.
 *
 * All corpus lines are enumerated deterministically from a fixed seed list
 * (no randomness, no time dependent input) so this suite produces identical
 * results on every run, including every run StrykerJS performs while
 * mutating src/.
 *
 * This file was split out of the former
 * tests/unit/marker-accessor.invariants.test.ts. The id and dependency
 * properties now live in tests/unit/task-parser.invariants.test.ts, driven
 * directly against TaskParser.
 */

// Seed lines chosen to cover every marker shape relevant to due, scheduled
// and priority behavior: id only, dependency with one id, dependency with
// two ids, due date, scheduled date, a priority glyph, several markers
// combined on one line, and a marker glyph embedded in ordinary prose (the
// deliberately accepted edge case). The seeds carry every marker family,
// not only due, scheduled and priority, because a marker's regex must
// ignore fragments and full values of every other marker family sharing the
// same line.
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

const metadataParser = new TaskMetadataParser();

// Every glyph and value name this suite uses is written out as a literal
// below, never read back from TaskMetadataParser.GLYPH_BY_PRIORITY or any
// other production constant, so this suite cannot silently drift out of
// sync with a change to the parser it exists to pin.
const PRIORITY_VALUES: readonly string[] = ['highest', 'high', 'medium', 'low', 'lowest'];

interface ScalarMarkerOps {
	read: (line: string) => string | null;
	remove: (line: string) => string;
}

const DUE_OPS: ScalarMarkerOps = {
	read: (line) => metadataParser.getDueDate(line),
	remove: (line) => metadataParser.removeDueDate(line),
};

const SCHEDULED_OPS: ScalarMarkerOps = {
	read: (line) => metadataParser.getScheduledDate(line),
	remove: (line) => metadataParser.removeScheduledDate(line),
};

const PRIORITY_OPS: ScalarMarkerOps = {
	read: (line) => metadataParser.getPriority(line),
	remove: (line) => metadataParser.removePriority(line),
};

// The three ScalarMarkerOps entries stand in for "every single-value
// accessor" from the pre-split suite, narrowed to the two markers this file
// owns: due, scheduled, priority.
const SCALAR_MARKERS: readonly ScalarMarkerOps[] = [DUE_OPS, SCHEDULED_OPS, PRIORITY_OPS];

describe('TaskMetadataParser remove idempotence', () => {
	it('applying remove twice equals applying it once, for due, scheduled and priority, for every corpus line', () => {
		for (const ops of SCALAR_MARKERS) {
			for (const line of CORPUS) {
				const once = ops.remove(line);
				const twice = ops.remove(once);
				expect(twice).toBe(once);
			}
		}
	});
});

describe('TaskMetadataParser read after remove', () => {
	it('read(remove(line)) is null for due, scheduled and priority, for every corpus line', () => {
		for (const ops of SCALAR_MARKERS) {
			for (const line of CORPUS) {
				expect(ops.read(ops.remove(line))).toBeNull();
			}
		}
	});
});

describe('TaskMetadataParser read never throws', () => {
	it('never throws for any corpus line, for due, scheduled and priority', () => {
		for (const ops of SCALAR_MARKERS) {
			for (const line of CORPUS) {
				expect(() => ops.read(line)).not.toThrow();
			}
		}
	});
});

describe('TaskMetadataParser.getDueDate well-formed values', () => {
	it('returns null or a value matching YYYY-MM-DD', () => {
		for (const line of CORPUS) {
			const value = metadataParser.getDueDate(line);
			if (value !== null) {
				expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			}
		}
	});
});

describe('TaskMetadataParser.getScheduledDate well-formed values', () => {
	it('returns null or a value matching YYYY-MM-DD', () => {
		for (const line of CORPUS) {
			const value = metadataParser.getScheduledDate(line);
			if (value !== null) {
				expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			}
		}
	});
});

describe('TaskMetadataParser.getPriority well-formed values', () => {
	it('returns null or one of the known priority values', () => {
		for (const line of CORPUS) {
			const value = metadataParser.getPriority(line);
			if (value !== null) {
				expect(PRIORITY_VALUES).toContain(value);
			}
		}
	});
});

/**
 * Round-trip invariant: for any line that does not already carry a marker
 * of a given type, applying that marker and then removing it must restore
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
// The priority glyph is used as the foreign marker for due and scheduled;
// an id marker is used as the foreign marker for priority itself.
function roundTripCorpusFor(foreignSuffix: string): readonly string[] {
	return [
		ROUND_TRIP_BASE,
		`${ROUND_TRIP_BASE} `,
		`${ROUND_TRIP_BASE}  `,
		`${ROUND_TRIP_BASE}\t`,
		`${ROUND_TRIP_BASE}${foreignSuffix}`,
	];
}

interface RoundTripCase {
	apply: (line: string, value: string) => string;
	remove: (line: string) => string;
	value: string;
	foreignSuffix: string;
}

const ROUND_TRIP_CASES: readonly RoundTripCase[] = [
	{
		apply: (line, value) => metadataParser.setDueDate(line, value),
		remove: (line) => metadataParser.removeDueDate(line),
		value: '2025-06-01',
		foreignSuffix: ' \u23EB',
	},
	{
		apply: (line, value) => metadataParser.setScheduledDate(line, value),
		remove: (line) => metadataParser.removeScheduledDate(line),
		value: '2025-06-02',
		foreignSuffix: ' \u23EB',
	},
	{
		apply: (line, value) => metadataParser.setPriority(line, value as Priority),
		remove: (line) => metadataParser.removePriority(line),
		value: 'high',
		foreignSuffix: ' \u{1F194} zzz999',
	},
];

describe('TaskMetadataParser apply/remove round trip', () => {
	it('remove(apply(line, value)) restores the original line exactly, for due, scheduled and priority', () => {
		for (const roundTripCase of ROUND_TRIP_CASES) {
			for (const line of roundTripCorpusFor(roundTripCase.foreignSuffix)) {
				const applied = roundTripCase.apply(line, roundTripCase.value);
				const restored = roundTripCase.remove(applied);
				expect(restored).toBe(line);
			}
		}
	});
});
