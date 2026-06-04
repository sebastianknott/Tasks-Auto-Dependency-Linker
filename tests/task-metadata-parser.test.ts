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
});
