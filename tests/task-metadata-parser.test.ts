import { describe, it, expect } from 'vitest';
import { TaskMetadataParser, type Priority } from '../src/task-metadata-parser';

describe('TaskMetadataParser', () => {
	const parser = new TaskMetadataParser();

	describe('getDueDate', () => {
		it.each([
			['extracts a due date', '- [ ] Task \u{1F4C5} 2025-01-15', '2025-01-15'],
			['extracts due date mid-line before other metadata', '- [ ] Task \u{1F4C5} 2025-01-15 \u{1F194} abc123', '2025-01-15'],
			['tolerates the tear-off calendar glyph', '- [ ] Task \u{1F4C6} 2025-02-20', '2025-02-20'],
			['tolerates the spiral calendar glyph', '- [ ] Task \u{1F5D3} 2025-03-25', '2025-03-25'],
		])('%s', (_desc, input, expected) => {
			expect(parser.getDueDate(input)).toBe(expected);
		});

		it.each([
			['returns null when no due date', '- [ ] Task with no date'],
			['returns null for scheduled marker only', '- [ ] Task \u{23F3} 2025-01-15'],
		])('%s', (_desc, input) => {
			expect(parser.getDueDate(input)).toBeNull();
		});
	});

	describe('getScheduledDate', () => {
		it.each([
			['extracts a scheduled date', '- [ ] Task \u{23F3} 2025-04-10', '2025-04-10'],
			['extracts scheduled date mid-line before other metadata', '- [ ] Task \u{23F3} 2025-04-10 \u{1F194} abc123', '2025-04-10'],
			['tolerates the hourglass-done glyph', '- [ ] Task \u{231B} 2025-05-11', '2025-05-11'],
		])('%s', (_desc, input, expected) => {
			expect(parser.getScheduledDate(input)).toBe(expected);
		});

		it.each([
			['returns null when no scheduled date', '- [ ] Task with no date'],
			['returns null for due marker only', '- [ ] Task \u{1F4C5} 2025-04-10'],
		])('%s', (_desc, input) => {
			expect(parser.getScheduledDate(input)).toBeNull();
		});
	});

	describe('getPriority', () => {
		it.each<[string, string, Priority]>([
			['extracts highest priority', '- [ ] Task \u{1F53A}', 'highest'],
			['extracts high priority', '- [ ] Task \u{23EB}', 'high'],
			['extracts medium priority', '- [ ] Task \u{1F53C}', 'medium'],
			['extracts low priority', '- [ ] Task \u{1F53D}', 'low'],
			['extracts lowest priority', '- [ ] Task \u{23EC}', 'lowest'],
			['extracts priority mid-line before other metadata', '- [ ] Task \u{23EB} \u{1F194} abc123', 'high'],
		])('%s', (_desc, input, expected) => {
			expect(parser.getPriority(input)).toBe(expected);
		});

		it.each([
			['returns null when no priority', '- [ ] Task with no priority'],
			['returns null for a date marker only', '- [ ] Task \u{1F4C5} 2025-04-10'],
		])('%s', (_desc, input) => {
			expect(parser.getPriority(input)).toBeNull();
		});
	});

	describe('applyDueDate', () => {
		it('appends a canonical due marker when absent', () => {
			expect(parser.applyDueDate('- [ ] Task', '2025-06-01')).toBe(
				'- [ ] Task \u{1F4C5} 2025-06-01',
			);
		});

		it('returns the line unchanged when a due date is already present', () => {
			const line = '- [ ] Task \u{1F4C5} 2025-01-01';
			expect(parser.applyDueDate(line, '2025-06-01')).toBe(line);
		});

		it('returns unchanged when a tolerated alternate due glyph is present', () => {
			const line = '- [ ] Task \u{1F4C6} 2025-01-01';
			expect(parser.applyDueDate(line, '2025-06-01')).toBe(line);
		});
	});

	describe('applyScheduledDate', () => {
		it('appends a canonical scheduled marker when absent', () => {
			expect(parser.applyScheduledDate('- [ ] Task', '2025-06-02')).toBe(
				'- [ ] Task \u{23F3} 2025-06-02',
			);
		});

		it('returns the line unchanged when a scheduled date is already present', () => {
			const line = '- [ ] Task \u{23F3} 2025-01-02';
			expect(parser.applyScheduledDate(line, '2025-06-02')).toBe(line);
		});

		it('returns unchanged when a tolerated alternate scheduled glyph is present', () => {
			const line = '- [ ] Task \u{231B} 2025-01-02';
			expect(parser.applyScheduledDate(line, '2025-06-02')).toBe(line);
		});
	});

	describe('applyPriority', () => {
		it.each<[string, Priority, string]>([
			['appends highest glyph', 'highest', '- [ ] Task \u{1F53A}'],
			['appends high glyph', 'high', '- [ ] Task \u{23EB}'],
			['appends medium glyph', 'medium', '- [ ] Task \u{1F53C}'],
			['appends low glyph', 'low', '- [ ] Task \u{1F53D}'],
			['appends lowest glyph', 'lowest', '- [ ] Task \u{23EC}'],
		])('%s when absent', (_desc, priority, expected) => {
			expect(parser.applyPriority('- [ ] Task', priority)).toBe(expected);
		});

		it('returns the line unchanged when a priority is already present', () => {
			const line = '- [ ] Task \u{1F53D}';
			expect(parser.applyPriority(line, 'highest')).toBe(line);
		});
	});

	describe('setDueDate', () => {
		it('appends a canonical due marker when absent', () => {
			expect(parser.setDueDate('- [ ] Task', '2025-06-01')).toBe(
				'- [ ] Task \u{1F4C5} 2025-06-01',
			);
		});

		it('replaces an existing due date value in place', () => {
			expect(parser.setDueDate('- [ ] Task \u{1F4C5} 2025-01-01', '2025-06-01')).toBe(
				'- [ ] Task \u{1F4C5} 2025-06-01',
			);
		});

		it('replaces a tolerated alternate due glyph with the canonical one', () => {
			expect(parser.setDueDate('- [ ] Task \u{1F4C6} 2025-01-01', '2025-06-01')).toBe(
				'- [ ] Task \u{1F4C5} 2025-06-01',
			);
		});

		it('preserves surrounding metadata when replacing', () => {
			expect(
				parser.setDueDate('- [ ] Task \u{1F4C5} 2025-01-01 \u{1F194} abc123', '2025-06-01'),
			).toBe('- [ ] Task \u{1F4C5} 2025-06-01 \u{1F194} abc123');
		});
	});

	describe('setScheduledDate', () => {
		it('appends a canonical scheduled marker when absent', () => {
			expect(parser.setScheduledDate('- [ ] Task', '2025-06-01')).toBe(
				'- [ ] Task \u{23F3} 2025-06-01',
			);
		});

		it('replaces an existing scheduled date value in place', () => {
			expect(
				parser.setScheduledDate('- [ ] Task \u{23F3} 2025-01-01', '2025-06-01'),
			).toBe('- [ ] Task \u{23F3} 2025-06-01');
		});

		it('replaces a tolerated alternate scheduled glyph with the canonical one', () => {
			expect(
				parser.setScheduledDate('- [ ] Task \u{231B} 2025-01-01', '2025-06-01'),
			).toBe('- [ ] Task \u{23F3} 2025-06-01');
		});
	});

	describe('removeDueDate', () => {
		it('strips a canonical due marker mid-line without a double space', () => {
			expect(
				parser.removeDueDate('- [ ] Task \u{1F4C5} 2025-01-01 \u{1F194} abc123'),
			).toBe('- [ ] Task \u{1F194} abc123');
		});

		it('strips a due marker at the end of the line', () => {
			expect(parser.removeDueDate('- [ ] Task \u{1F4C5} 2025-01-01')).toBe(
				'- [ ] Task',
			);
		});

		it('tolerates the tear-off calendar glyph', () => {
			expect(parser.removeDueDate('- [ ] Task \u{1F4C6} 2025-02-20')).toBe(
				'- [ ] Task',
			);
		});

		it('tolerates the spiral calendar glyph', () => {
			expect(parser.removeDueDate('- [ ] Task \u{1F5D3} 2025-03-25')).toBe(
				'- [ ] Task',
			);
		});

		it('returns the line unchanged when no due date is present', () => {
			const line = '- [ ] Task with no date';
			expect(parser.removeDueDate(line)).toBe(line);
		});

		it('does not strip a trailing space when there is no due marker to remove', () => {
			expect(parser.removeDueDate('- [ ] Task ')).toBe('- [ ] Task ');
		});

		it('strips a due marker with nothing at all before it on the line', () => {
			expect(parser.removeDueDate('\u{1F4C5} 2025-01-01')).toBe('');
		});

		it('consumes only the one separator its own match captured, not the whole preceding whitespace run', () => {
			// Three spaces precede the marker. The pattern's leading \s?
			// captures exactly one of them as the marker's own separator;
			// the other two are unrelated whitespace the user typed (e.g.
			// a Markdown hard line break in progress) and must survive.
			// This was previously asserted to collapse to zero spaces,
			// which encoded the bug this fix corrects: a full trimEnd()
			// consumed whitespace far beyond the single separator the
			// marker's own regex matched.
			expect(parser.removeDueDate('- [ ] Task   \u{1F4C5} 2025-01-01')).toBe(
				'- [ ] Task  ',
			);
		});

		it('REGRESSION: preserves an unrelated trailing space left after the marker by an earlier, separate edit', () => {
			// The trailing space is content the user left behind for a
			// reason unrelated to the due date; removal must not reach
			// past its own match and eat it.
			expect(
				parser.removeDueDate('- [ ] Task \u{1F4C5} 2025-01-01 \u23EB '),
			).toBe('- [ ] Task \u23EB ');
		});

		it('does not consume a non-whitespace character directly preceding the marker when there is no separator', () => {
			// The leading `\s?` in the pattern must only ever match an
			// actual whitespace separator, never a character of the text
			// that happens to sit right up against the glyph.
			expect(parser.removeDueDate('X\u{1F4C5} 2025-01-01')).toBe('X');
		});
	});

	describe('removeScheduledDate', () => {
		it('strips a canonical scheduled marker mid-line without a double space', () => {
			expect(
				parser.removeScheduledDate('- [ ] Task \u{23F3} 2025-04-10 \u{1F194} abc123'),
			).toBe('- [ ] Task \u{1F194} abc123');
		});

		it('strips a scheduled marker at the end of the line', () => {
			expect(parser.removeScheduledDate('- [ ] Task \u{23F3} 2025-04-10')).toBe(
				'- [ ] Task',
			);
		});

		it('tolerates the hourglass-done glyph', () => {
			expect(parser.removeScheduledDate('- [ ] Task \u{231B} 2025-05-11')).toBe(
				'- [ ] Task',
			);
		});

		it('returns the line unchanged when no scheduled date is present', () => {
			const line = '- [ ] Task with no date';
			expect(parser.removeScheduledDate(line)).toBe(line);
		});

		it('does not strip a trailing space when there is no scheduled marker to remove', () => {
			expect(parser.removeScheduledDate('- [ ] Task ')).toBe('- [ ] Task ');
		});

		it('strips a scheduled marker with nothing at all before it on the line', () => {
			expect(parser.removeScheduledDate('\u{23F3} 2025-01-01')).toBe('');
		});

		it('consumes only the one separator its own match captured, not the whole preceding whitespace run', () => {
			// Three spaces precede the marker. The pattern's leading \s?
			// captures exactly one of them as the marker's own separator;
			// the other two are unrelated whitespace the user typed (e.g.
			// a Markdown hard line break in progress) and must survive.
			// This was previously asserted to collapse to zero spaces,
			// which encoded the bug this fix corrects: a full trimEnd()
			// consumed whitespace far beyond the single separator the
			// marker's own regex matched.
			expect(parser.removeScheduledDate('- [ ] Task   \u{23F3} 2025-01-01')).toBe(
				'- [ ] Task  ',
			);
		});

		it('REGRESSION: preserves an unrelated trailing space left after the marker by an earlier, separate edit', () => {
			// The trailing space is content the user left behind for a
			// reason unrelated to the scheduled date; removal must not
			// reach past its own match and eat it.
			expect(
				parser.removeScheduledDate('- [ ] Task \u{23F3} 2025-04-10 \u23EB '),
			).toBe('- [ ] Task \u23EB ');
		});

		it('does not consume a non-whitespace character directly preceding the marker when there is no separator', () => {
			// The leading `\s?` in the pattern must only ever match an
			// actual whitespace separator, never a character of the text
			// that happens to sit right up against the glyph.
			expect(parser.removeScheduledDate('X\u{23F3} 2025-04-10')).toBe('X');
		});
	});

	describe('removePriority', () => {
		it.each<[string, Priority]>([
			['strips the highest priority glyph', 'highest'],
			['strips the high priority glyph', 'high'],
			['strips the medium priority glyph', 'medium'],
			['strips the low priority glyph', 'low'],
			['strips the lowest priority glyph', 'lowest'],
		])('%s', (_desc, priority) => {
			const glyph = TaskMetadataParser.GLYPH_BY_PRIORITY.get(priority)!;
			expect(parser.removePriority(`- [ ] Task ${glyph}`)).toBe('- [ ] Task');
		});

		it('strips a priority glyph mid-line without a double space', () => {
			expect(
				parser.removePriority('- [ ] Task \u{23EB} \u{1F194} abc123'),
			).toBe('- [ ] Task \u{1F194} abc123');
		});

		it('returns the line unchanged when no priority is present', () => {
			const line = '- [ ] Task with no priority';
			expect(parser.removePriority(line)).toBe(line);
		});

		it('consumes only the one separator its own match captured, not the whole preceding whitespace run', () => {
			// Three spaces precede the marker. The pattern's leading \s?
			// captures exactly one of them as the marker's own separator;
			// the other two are unrelated whitespace the user typed (e.g.
			// a Markdown hard line break in progress) and must survive.
			// This was previously asserted to collapse to zero spaces,
			// which encoded the bug this fix corrects: a full trimEnd()
			// consumed whitespace far beyond the single separator the
			// marker's own regex matched. This is the exact class of bug
			// the user reported: a priority glyph's own removal eating a
			// trailing space it never touched.
			expect(parser.removePriority('- [ ] Task   \u{23EB}')).toBe('- [ ] Task  ');
		});

		it('REGRESSION: preserves an unrelated trailing space left after the marker by an earlier, separate edit', () => {
			// The trailing space is content the user left behind for a
			// reason unrelated to the priority glyph; removal must not
			// reach past its own match and eat it.
			expect(
				parser.removePriority('- [ ] Task \u23EB \u{1F194} abc123 '),
			).toBe('- [ ] Task \u{1F194} abc123 ');
		});
	});

	describe('setPriority', () => {
		it('appends a canonical priority glyph when absent', () => {
			expect(parser.setPriority('- [ ] Task', 'high')).toBe(
				'- [ ] Task \u{23EB}',
			);
		});

		it('replaces an existing priority glyph in place', () => {
			expect(parser.setPriority('- [ ] Task \u{1F53D}', 'highest')).toBe(
				'- [ ] Task \u{1F53A}',
			);
		});

		it('preserves surrounding metadata when replacing priority', () => {
			expect(
				parser.setPriority('- [ ] Task \u{1F53D} \u{1F194} abc123', 'highest'),
			).toBe('- [ ] Task \u{1F53A} \u{1F194} abc123');
		});
	});

	describe('priority apply/remove round trip (user-reported regression)', () => {
		// This is the exact case the user reported still broken after an
		// earlier partial fix: backspacing a priority glyph away and
		// stopping right after typing a trailing space. setPriority is
		// what LineWriteArbiter calls to re-apply an inherited value, and
		// removePriority is what it calls a moment later when it detects
		// the child suppressed that value. The user's trailing space must
		// survive that whole apply-then-suppress cycle.
		it('setPriority then removePriority restores a line that had a single trailing space', () => {
			const line = '- [ ] Task ';
			const withPriority = parser.setPriority(line, 'high');
			expect(parser.removePriority(withPriority)).toBe(line);
		});

		it('setPriority then removePriority restores a line that had a Markdown hard line break (two trailing spaces)', () => {
			const line = '- [ ] Task  ';
			const withPriority = parser.setPriority(line, 'high');
			expect(parser.removePriority(withPriority)).toBe(line);
		});

		it('setPriority then removePriority restores a line with no trailing whitespace', () => {
			const line = '- [ ] Task';
			const withPriority = parser.setPriority(line, 'high');
			expect(parser.removePriority(withPriority)).toBe(line);
		});
	});
});
