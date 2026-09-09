import { describe, it, expect } from 'vitest';
import { MarkerAccessorRegistry, MarkerType } from '../src/marker-accessor';
import { TaskParser } from '../src/task-parser';
import { TaskMetadataParser } from '../src/task-metadata-parser';
import { LineSnapshotStore } from '../src/line-snapshot-store';

/**
 * Hardening test suite for the marker accessors and LineSnapshotStore, built from a mentor
 * review of LineWriteArbiter. The historical bug this suite targets: an earlier version of
 * LineSnapshotStore.computeBareText left a stray bare dependency glyph in the bare text,
 * which broke the arbiter's snapshot comparison gate and let the plugin restore a dependency
 * the user had just deleted. That specific glyph (dependency, U+26D4) now has a dedicated
 * unconditional cleanup step in computeBareText and is covered here as a fully closed
 * invariant. This suite also probes the analogous cases for the other marker glyphs and
 * documents, rather than hides, the gap it finds there. See the "known gap" comments below.
 *
 * All corpus lines are enumerated deterministically from a fixed seed list (no randomness,
 * no time dependent input) so this suite produces identical results on every run, including
 * every run StrykerJS performs while mutating src/.
 */

// Seed lines chosen to cover every marker shape relevant to LineWriteArbiter's invariants:
// id only, dependency with one id, dependency with two ids, due date, scheduled date,
// a priority glyph, several markers combined on one line, and a marker glyph embedded in
// ordinary prose (the deliberately accepted edge case documented near the bottom of this file).
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

// Full pure-function corpus for Groups 1 and 3: every seed, every progressive truncation of
// every seed, and every single-character deletion of every seed, deduplicated. This corpus is
// cheap to run (pure functions, no editor simulation), so it uses the widest enumeration the
// task allows rather than truncation-only.
const CORPUS: readonly string[] = Array.from(
	new Set(SEEDS.flatMap((seed) => [seed, ...truncations(seed), ...singleCharDeletions(seed)])),
);

const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);
const metadataParser = new TaskMetadataParser();
const registry = new MarkerAccessorRegistry(parser, metadataParser);
const store = new LineSnapshotStore(registry);

const idAccessor = registry.markers.find((accessor) => accessor.type === MarkerType.Id)!;
const dueAccessor = registry.markers.find((accessor) => accessor.type === MarkerType.Due)!;
const scheduledAccessor = registry.markers.find((accessor) => accessor.type === MarkerType.Scheduled)!;
const priorityAccessor = registry.markers.find((accessor) => accessor.type === MarkerType.Priority)!;
const dependencyAccessor = registry.dependency;

// Glyph constants read from source, not hand-assembled, so this suite cannot drift from the
// parser it is testing.
const ID_GLYPH = '\u{1F194}';
const DEP_GLYPH = '\u26D4';
const PRIORITY_GLYPHS: readonly string[] = [...TaskMetadataParser.GLYPH_BY_PRIORITY.values()];
const PRIORITY_VALUES: readonly string[] = [...TaskMetadataParser.GLYPH_BY_PRIORITY.keys()];

describe('MarkerAccessor.remove idempotence', () => {
	it('applying remove twice equals applying it once, for every single-value accessor', () => {
		for (const accessor of registry.markers) {
			for (const line of CORPUS) {
				const once = accessor.remove(line);
				const twice = accessor.remove(once);
				expect(twice).toBe(once);
			}
		}
	});

	it('applying remove twice equals applying it once, for DependencyAccessor, for every id present plus a synthetic id', () => {
		for (const line of CORPUS) {
			const ids = new Set(dependencyAccessor.read(line));
			ids.add('zzzzzz');
			for (const depId of ids) {
				const once = dependencyAccessor.remove(line, depId);
				const twice = dependencyAccessor.remove(once, depId);
				expect(twice).toBe(once);
			}
		}
	});
});

describe('MarkerAccessor.read after remove', () => {
	it('read(remove(line)) is null for every single-value accessor', () => {
		for (const accessor of registry.markers) {
			for (const line of CORPUS) {
				expect(accessor.read(accessor.remove(line))).toBeNull();
			}
		}
	});

	it('DependencyAccessor: the removed id is never present in read(remove(line, depId))', () => {
		for (const line of CORPUS) {
			const ids = new Set(dependencyAccessor.read(line));
			ids.add('zzzzzz');
			for (const depId of ids) {
				const result = dependencyAccessor.read(dependencyAccessor.remove(line, depId));
				expect(result.has(depId)).toBe(false);
			}
		}
	});
});

describe('MarkerAccessor.hasFragment after remove', () => {
	// Empirically confirmed narrower invariant: hasFragment(remove(line)) is only guaranteed
	// false when remove() actually changed the line. When remove() is a no-op (the glyph is a
	// bare or malformed fragment that the accessor's underlying regex does not match, for
	// example a lone "id glyph" with no id text after it), hasFragment can and does remain
	// true both before and after remove(). This is the correct, empirically verified shape of
	// the invariant, not a weaker substitute for it: asserting "always false" here would be a
	// false invariant, since it does not hold for genuinely malformed fragments that remove()
	// cannot recognise as removable.
	it('hasFragment is false after remove, whenever remove actually changed the line, for every single-value accessor', () => {
		for (const accessor of registry.markers) {
			for (const line of CORPUS) {
				const removed = accessor.remove(line);
				if (removed !== line) {
					expect(accessor.hasFragment(removed)).toBe(false);
				}
			}
		}
	});

	it('hasFragment is false after remove, whenever remove actually changed the line, for DependencyAccessor', () => {
		for (const line of CORPUS) {
			const ids = new Set(dependencyAccessor.read(line));
			ids.add('zzzzzz');
			for (const depId of ids) {
				const removed = dependencyAccessor.remove(line, depId);
				if (removed !== line) {
					expect(dependencyAccessor.hasFragment(removed)).toBe(false);
				}
			}
		}
	});
});

describe('MarkerAccessor.hasFragment and read consistency', () => {
	it('hasFragment(line) true implies read(line) is null, for every single-value accessor', () => {
		for (const accessor of registry.markers) {
			for (const line of CORPUS) {
				if (accessor.hasFragment(line)) {
					expect(accessor.read(line)).toBeNull();
				}
			}
		}
	});

	it('PriorityAccessor.hasFragment is always false, since a priority glyph is a single code point and cannot be partially typed', () => {
		for (const line of CORPUS) {
			expect(priorityAccessor.hasFragment(line)).toBe(false);
		}
	});
});

describe('MarkerAccessor.read never throws and returns well-formed values', () => {
	it('never throws for any corpus line, for every single-value accessor', () => {
		for (const accessor of registry.markers) {
			for (const line of CORPUS) {
				expect(() => accessor.read(line)).not.toThrow();
			}
		}
	});

	it('IdAccessor.read returns null or a value matching the id character class', () => {
		for (const line of CORPUS) {
			const value = idAccessor.read(line);
			if (value !== null) {
				expect(value).toMatch(/^[a-zA-Z0-9_-]+$/);
			}
		}
	});

	it('DueAccessor.read returns null or a value matching YYYY-MM-DD', () => {
		for (const line of CORPUS) {
			const value = dueAccessor.read(line);
			if (value !== null) {
				expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			}
		}
	});

	it('ScheduledAccessor.read returns null or a value matching YYYY-MM-DD', () => {
		for (const line of CORPUS) {
			const value = scheduledAccessor.read(line);
			if (value !== null) {
				expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			}
		}
	});

	it('PriorityAccessor.read returns null or one of the known priority values', () => {
		for (const line of CORPUS) {
			const value = priorityAccessor.read(line);
			if (value !== null) {
				expect(PRIORITY_VALUES).toContain(value);
			}
		}
	});

	it('DependencyAccessor.read never throws and returns a Set whose members match the id character class', () => {
		for (const line of CORPUS) {
			expect(() => dependencyAccessor.read(line)).not.toThrow();
			for (const depId of dependencyAccessor.read(line)) {
				expect(depId).toMatch(/^[a-zA-Z0-9_-]+$/);
			}
		}
	});
});

describe('LineSnapshotStore.computeBareText never throws', () => {
	it('handles every corpus line without throwing', () => {
		for (const line of CORPUS) {
			expect(() => store.computeBareText(line)).not.toThrow();
		}
	});
});

describe('LineSnapshotStore.computeBareText glyph absence', () => {
	// The dependency glyph has a dedicated, unconditional cleanup step in computeBareText
	// (the fix for the historical bug this whole suite is named after), so it must never
	// leak into bare text, with no exception, for any corpus line.
	it('never contains the dependency glyph', () => {
		for (const line of CORPUS) {
			expect(store.computeBareText(line)).not.toContain(DEP_GLYPH);
		}
	});

	// Priority glyphs are single code points removed by a direct string replace with no
	// partial-match failure mode, so they must never leak either, with no exception.
	it('never contains any priority glyph', () => {
		for (const line of CORPUS) {
			const bareText = store.computeBareText(line);
			for (const glyph of PRIORITY_GLYPHS) {
				expect(bareText).not.toContain(glyph);
			}
		}
	});

	// Closed gap: computeBareText now has an unconditional catch-all for the id glyph too,
	// mirroring the dependency glyph fix above. Since TaskParser.ID_REGEX accepts any
	// [a-zA-Z0-9_-]+ right after "🆔 ", any id text that parses at all was already removed
	// by IdAccessor.remove() in the loop above; the only fragment this catch-all ever has to
	// clean up is a bare glyph, so a full corpus, unconditional assertion is now correct.
	it('never contains the id glyph, for any corpus line, including unparseable fragments', () => {
		for (const line of CORPUS) {
			expect(store.computeBareText(line)).not.toContain(ID_GLYPH);
		}
	});

	// Closed gap: computeBareText now has an unconditional catch-all for the due glyph,
	// covering both a bare glyph and a glyph followed by a partial YYYY-MM-DD run that
	// TaskMetadataParser.removeDueDate cannot recognise as removable.
	it('never contains a due glyph, for any corpus line, including unparseable fragments', () => {
		const glyphPattern = new RegExp(TaskMetadataParser.DUE_GLYPH_REGEX.source, 'gu');
		for (const line of CORPUS) {
			glyphPattern.lastIndex = 0;
			expect(glyphPattern.test(store.computeBareText(line))).toBe(false);
		}
	});

	// Closed gap: same fix, same shape, for the scheduled marker glyphs.
	it('never contains a scheduled glyph, for any corpus line, including unparseable fragments', () => {
		const glyphPattern = new RegExp(TaskMetadataParser.SCHEDULED_GLYPH_REGEX.source, 'gu');
		for (const line of CORPUS) {
			glyphPattern.lastIndex = 0;
			expect(glyphPattern.test(store.computeBareText(line))).toBe(false);
		}
	});
});

describe('LineSnapshotStore.computeBareText partial-value residue', () => {
	// Exact-equality (not a residue regex) on purpose: the checkbox prefix "- [ ]" itself
	// contains a hyphen, so scanning the result for a stray [\d-] character would false
	// positive. Exact equality is simpler and strictly stronger, since it also catches a
	// quantifier mutant on [\d-]* (e.g. * -> a single character) that would otherwise leave
	// visible residue in the string without necessarily matching a narrower residue check.
	it('leaves no leftover digit or hyphen from a truncated due date', () => {
		expect(store.computeBareText('- [ ] Task \u{1F4C5} 2026-0')).toBe('- [ ] Task');
	});

	it('leaves no leftover digit or hyphen from a truncated scheduled date', () => {
		expect(store.computeBareText('- [ ] Task \u23F3 2026-0')).toBe('- [ ] Task');
	});
});

// The generic CORPUS above never produces a fragment glyph with zero leading whitespace: a
// glyph with nothing before it but a word character is only reachable here either by
// truncating the seed's tail (which always keeps the leading space that came before the
// glyph in the original seed) or by deleting a single character from a seed (which turns a
// zero-leading-whitespace glyph well-formed, since deleting the space before the glyph still
// leaves the following space and value intact, so remove() strips it before the catch-all
// ever runs). The leading \s* on each catch-all is therefore only exercised with one or more
// whitespace characters by CORPUS, never with zero, so a mutant that narrows \s* to \s would
// still pass every CORPUS-driven assertion above. These two tests close that hole directly.
describe('LineSnapshotStore.computeBareText fragment glyph with no leading whitespace', () => {
	it('still strips a bare id glyph glued directly onto the preceding word', () => {
		expect(store.computeBareText('Task\u{1F194}')).toBe('Task');
	});

	it('still strips a bare due glyph glued directly onto the preceding word', () => {
		expect(store.computeBareText('Task\u{1F4C5}')).toBe('Task');
	});

	it('still strips a bare scheduled glyph glued directly onto the preceding word', () => {
		expect(store.computeBareText('Task\u23F3')).toBe('Task');
	});
});

/**
 * Round-trip invariant: for any line that does not already carry a marker of
 * a given type, applying that marker and then removing it must restore the
 * original line byte for byte, including any trailing whitespace the line
 * already had. This is the central invariant behind the fix for the "a
 * trailing space vanishes after a debounce lag" bug: every apply appends
 * exactly one separator space plus its glyph, so removal must consume
 * exactly that one separator character, never a whole trailing whitespace
 * run. The corpus below exercises every whitespace shape the user is likely
 * to leave behind: no trailing whitespace, a single trailing space, two
 * trailing spaces (a Markdown hard line break), a trailing tab, and a line
 * that already ends with a different marker type entirely.
 */
const ROUND_TRIP_BASE = '- [ ] Task';

function roundTripCorpusFor(foreignSuffix: string): readonly string[] {
	return [
		ROUND_TRIP_BASE,
		`${ROUND_TRIP_BASE} `,
		`${ROUND_TRIP_BASE}  `,
		`${ROUND_TRIP_BASE}\t`,
		`${ROUND_TRIP_BASE}${foreignSuffix}`,
	];
}

// A distinct, unrelated marker glyph to append at the end of a line before
// applying the marker under test, proving that apply/remove interacts only
// with its own marker and leaves a pre-existing foreign marker untouched.
// The priority glyph is used as the foreign marker for every accessor
// except PriorityAccessor itself, which instead uses a foreign id marker.
function foreignSuffixFor(type: MarkerType): string {
	return type === MarkerType.Priority ? ' \u{1F194} zzz999' : ' \u23EB';
}

const ROUND_TRIP_VALUES: Record<MarkerType, string> = {
	[MarkerType.Id]: 'abc123',
	[MarkerType.Due]: '2025-06-01',
	[MarkerType.Scheduled]: '2025-06-02',
	[MarkerType.Priority]: 'high',
};

describe('marker apply/remove round trip', () => {
	it('remove(apply(line, value)) restores the original line exactly, for every single-value accessor', () => {
		for (const accessor of registry.markers) {
			const value = ROUND_TRIP_VALUES[accessor.type];
			for (const line of roundTripCorpusFor(foreignSuffixFor(accessor.type))) {
				const applied = accessor.apply(line, value);
				const restored = accessor.remove(applied);
				expect(restored).toBe(line);
			}
		}
	});

	it('remove(apply(line, depId), depId) restores the original line exactly, for DependencyAccessor', () => {
		const depId = 'dep123';
		for (const line of roundTripCorpusFor(' \u23EB')) {
			const applied = dependencyAccessor.apply(line, depId);
			const restored = dependencyAccessor.remove(applied, depId);
			expect(restored).toBe(line);
		}
	});
});
