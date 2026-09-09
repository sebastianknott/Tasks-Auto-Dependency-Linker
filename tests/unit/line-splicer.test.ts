import { describe, it, expect } from 'vitest';
import { LineSplicer } from '../../src/line-splicer';

/**
 * LineSplicer owns the single whitespace rule that keeps marker apply/remove
 * round trips lossless: every apply appends exactly one separator space
 * before its marker, without touching whatever whitespace the line already
 * had. Removal must consume exactly that one separator character, never a
 * whole run of trailing whitespace, or unrelated content (a Markdown hard
 * line break, the user's own trailing space mid-edit) is destroyed along
 * with the marker.
 */
describe('LineSplicer', () => {
	describe('spliceOut', () => {
		it('removes the text between start and end, joining what remains', () => {
			expect(LineSplicer.spliceOut('- [ ] Task \u{1F194} abc123', 10, 20)).toBe('- [ ] Task');
		});

		it('preserves everything after end untouched, including trailing whitespace', () => {
			expect(LineSplicer.spliceOut('- [ ] Task \u{1F194} abc123  ', 10, 20)).toBe('- [ ] Task  ');
		});

		it('preserves everything before start untouched, including extra whitespace beyond the match', () => {
			// Two spaces sit before the matched range; only the matched
			// range itself is removed, so one of those two spaces (the
			// one outside [start, end)) must survive.
			expect(LineSplicer.spliceOut('- [ ] Task  \u{1F194} abc123', 11, 21)).toBe('- [ ] Task ');
		});

		it('removes a match at the very start of the line', () => {
			expect(LineSplicer.spliceOut('\u{1F194} abc123', 0, 9)).toBe('');
		});

		it('removes a match at the very end of the line, leaving the prefix intact', () => {
			expect(LineSplicer.spliceOut('X\u{1F194}', 1, 3)).toBe('X');
		});

		it('returns the line unchanged when start equals end (an empty match)', () => {
			expect(LineSplicer.spliceOut('- [ ] Task', 4, 4)).toBe('- [ ] Task');
		});
	});

	describe('dropSeparatorBefore', () => {
		it('drops exactly one trailing whitespace character when present', () => {
			expect(LineSplicer.dropSeparatorBefore('- [ ] Task ')).toBe('- [ ] Task');
		});

		it('drops only one trailing whitespace character, preserving the rest of a run', () => {
			expect(LineSplicer.dropSeparatorBefore('- [ ] Task  ')).toBe('- [ ] Task ');
		});

		it('drops only one trailing whitespace character from a three-space run', () => {
			expect(LineSplicer.dropSeparatorBefore('- [ ] Task   ')).toBe('- [ ] Task  ');
		});

		it('drops a trailing tab as a single separator character', () => {
			expect(LineSplicer.dropSeparatorBefore('- [ ] Task\t')).toBe('- [ ] Task');
		});

		it('returns the text unchanged when it does not end in whitespace', () => {
			expect(LineSplicer.dropSeparatorBefore('- [ ] Task')).toBe('- [ ] Task');
		});

		it('returns an empty string unchanged', () => {
			expect(LineSplicer.dropSeparatorBefore('')).toBe('');
		});
	});
});
