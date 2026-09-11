import { describe, it, expect } from 'vitest';
import type { MarkerAccessorRegistry } from '../../src/parsing/marker-accessor';
import { LineSnapshotStore } from '../../src/editing/line-snapshot-store';

/**
 * Property suite for LineSnapshotStore.computeBareText, built from a design
 * review of LineWriteArbiter. The historical bug this suite targets: an
 * earlier version of computeBareText left a stray bare dependency glyph in
 * the bare text, which broke the arbiter's snapshot comparison gate and let
 * the plugin restore a dependency the user had just deleted. That specific
 * glyph (dependency, U+26D4) now has a dedicated unconditional cleanup step
 * in computeBareText and is covered here as a fully closed invariant. This
 * suite also probes the analogous cases for the other marker glyphs.
 *
 * LineSnapshotStore is the subject here, so the registry it depends on is a
 * stub, not the real MarkerAccessorRegistry. computeBareText's own catch-all
 * regexes are what these properties exercise: the stub's single-value
 * accessors are passthroughs (remove returns its input unchanged), except
 * for the priority accessor, since computeBareText has no catch-all fallback
 * for the priority glyph (a priority glyph is a single code point and can
 * never be left as a partial fragment, so remove() alone is always
 * responsible for it). The stub dependency accessor never reports an id, so
 * every property below is driven purely by computeBareText's own glyph
 * catch-alls, not by any reimplementation of the accessors' marker regexes.
 * Basic well-formed-marker stripping (real registry, real removal) is
 * already covered by tests/unit/line-snapshot-store.test.ts.
 *
 * All corpus lines are enumerated deterministically from a fixed seed list
 * (no randomness, no time dependent input) so this suite produces identical
 * results on every run, including every run StrykerJS performs while
 * mutating src/.
 *
 * This file was split out of the former tests/unit/marker-invariants.test.ts,
 * which mixed registry-law and LineSnapshotStore-law properties in one file.
 * The registry properties now live in
 * tests/unit/marker-accessor.invariants.test.ts, driven directly (no stub).
 */

// Seed lines chosen to cover every marker shape relevant to LineWriteArbiter's invariants:
// id only, dependency with one id, dependency with two ids, due date, scheduled date,
// a priority glyph, several markers combined on one line, and a marker glyph embedded in
// ordinary prose (the deliberately accepted edge case).
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

// Every glyph this suite looks for is written out here as a literal, never read
// back from TaskMetadataParser. Deriving them from the production class made
// this suite kill 7 mutants inside task-metadata-parser.ts, which is the
// leakage the section 4.5 probe exists to catch: a change to the parser's glyph
// table would have failed a LineSnapshotStore test. If the parser ever grows a
// glyph, the integration suite is what catches the divergence.
const ID_GLYPH = '\u{1F194}';
const DEP_GLYPH = '\u26D4';
const DUE_GLYPHS = '[\\u{1F4C5}\\u{1F4C6}\\u{1F5D3}]';
const SCHEDULED_GLYPHS = '[\\u{23F3}\\u{231B}]';
const PRIORITY_GLYPHS: readonly string[] = [
	'\u{1F53A}',
	'\u{23EB}',
	'\u{1F53C}',
	'\u{1F53D}',
	'\u{23EC}',
];

/**
 * Removes every occurrence of every known priority glyph via a plain
 * substring split/join, not a regex. This is the one marker family whose
 * removal the stub must perform for real, since computeBareText has no
 * catch-all fallback for a fragment the marker's own remove() failed to
 * strip. Using literal substring removal (rather than a regex derived from
 * the same character class the production PriorityAccessor uses) keeps this
 * a fake collaborator answer, not a reimplementation of the marker regex.
 */
function stripPriorityGlyphs(line: string): string {
	let result = line;
	for (const glyph of PRIORITY_GLYPHS) {
		result = result.split(glyph).join('');
	}
	return result;
}

/**
 * Builds a stubbed MarkerAccessorRegistry for LineSnapshotStore.
 * computeBareText only ever calls `remove` on each entry of `markers`, and
 * `read`/`remove` on `dependency`, so those are the only members this double
 * needs to answer. The id, due and scheduled stand-ins are passthroughs:
 * whatever computeBareText leaves behind after the passthrough loop is
 * exactly the malformed-fragment case its own catch-all regexes exist to
 * handle, so a passthrough exercises that store logic directly instead of
 * depending on a correct accessor implementation. The dependency stand-in
 * never reports an id present, so the dependency catch-all is exercised the
 * same way.
 */
function stubRegistry(): MarkerAccessorRegistry {
	const passthrough = { remove: (line: string) => line };
	const priority = { remove: stripPriorityGlyphs };
	const dependency = {
		read: () => new Set<string>(),
		remove: (line: string) => line,
	};
	return {
		markers: [passthrough, passthrough, passthrough, priority],
		dependency,
	} as unknown as MarkerAccessorRegistry;
}

const store = new LineSnapshotStore(stubRegistry());

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

	// Priority glyphs are single code points removed by the stub's direct string
	// replace with no partial-match failure mode, so they must never leak either,
	// with no exception.
	it('never contains any priority glyph', () => {
		for (const line of CORPUS) {
			const bareText = store.computeBareText(line);
			for (const glyph of PRIORITY_GLYPHS) {
				expect(bareText).not.toContain(glyph);
			}
		}
	});

	// Closed gap: computeBareText has an unconditional catch-all for the id glyph too,
	// mirroring the dependency glyph fix above. This catch-all only ever has to clean
	// up a bare glyph left over by the (stubbed, passthrough) marker loop, so a full
	// corpus, unconditional assertion is correct.
	it('never contains the id glyph, for any corpus line, including unparseable fragments', () => {
		for (const line of CORPUS) {
			expect(store.computeBareText(line)).not.toContain(ID_GLYPH);
		}
	});

	// Closed gap: computeBareText has an unconditional catch-all for the due glyph,
	// covering both a bare glyph and a glyph followed by a digit-and-hyphen run left
	// behind by the passthrough stub.
	it('never contains a due glyph, for any corpus line, including unparseable fragments', () => {
		const glyphPattern = new RegExp(DUE_GLYPHS, 'gu');
		for (const line of CORPUS) {
			glyphPattern.lastIndex = 0;
			expect(glyphPattern.test(store.computeBareText(line))).toBe(false);
		}
	});

	// Closed gap: same fix, same shape, for the scheduled marker glyphs.
	it('never contains a scheduled glyph, for any corpus line, including unparseable fragments', () => {
		const glyphPattern = new RegExp(SCHEDULED_GLYPHS, 'gu');
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
// leaves the following space and value intact, so it is stripped before the catch-all ever
// runs). The leading \s* on each catch-all is therefore only exercised with one or more
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
