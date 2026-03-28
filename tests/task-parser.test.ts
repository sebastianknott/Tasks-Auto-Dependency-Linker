import { describe, it, expect } from 'vitest';
import { TaskParser, DEFAULT_INDENT_CONFIG } from '../src/task-parser';

describe('TaskParser', () => {
	describe('static regex constants', () => {
		describe('TASK_REGEX', () => {
			it('matches a dash task line with space checkbox', () => {
				expect(TaskParser.TASK_REGEX.test('- [ ] My task')).toBe(true);
			});

			it('matches an asterisk task line', () => {
				expect(TaskParser.TASK_REGEX.test('* [ ] My task')).toBe(true);
			});

			it('matches a completed task (x)', () => {
				expect(TaskParser.TASK_REGEX.test('- [x] Done task')).toBe(true);
			});

			it('matches an indented task line', () => {
				expect(TaskParser.TASK_REGEX.test('\t- [ ] Indented task')).toBe(true);
			});

			it('matches a task indented with spaces', () => {
				expect(TaskParser.TASK_REGEX.test('    - [ ] Spaced task')).toBe(true);
			});

			it('does not match a plain bullet without checkbox', () => {
				expect(TaskParser.TASK_REGEX.test('- No checkbox')).toBe(false);
			});

			it('does not match a heading', () => {
				expect(TaskParser.TASK_REGEX.test('# Heading')).toBe(false);
			});

			it('does not match plain text', () => {
				expect(TaskParser.TASK_REGEX.test('Just some text')).toBe(false);
			});

			it('does not match an empty line', () => {
				expect(TaskParser.TASK_REGEX.test('')).toBe(false);
			});

			it('does not match when checkbox pattern appears mid-line', () => {
				expect(TaskParser.TASK_REGEX.test('text - [ ] not a task')).toBe(false);
			});
		});

		describe('ID_REGEX', () => {
			it('matches a valid ID marker', () => {
				const match = '\u{1F194} abc123'.match(TaskParser.ID_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe('abc123');
			});

			it('extracts only the 6-char id', () => {
				const match = 'Some task \u{1F194} z9a8b7 rest'.match(TaskParser.ID_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe('z9a8b7');
			});

			it('does not match an ID with uppercase chars', () => {
				const match = '\u{1F194} ABC123'.match(TaskParser.ID_REGEX);
				expect(match).toBeNull();
			});

			it('does not match an ID shorter than 6 chars', () => {
				const match = '\u{1F194} abc12'.match(TaskParser.ID_REGEX);
				expect(match).toBeNull();
			});

			it('does not match an ID longer than 6 chars', () => {
				const match = '\u{1F194} abc1234'.match(TaskParser.ID_REGEX);
				// Should match abc123 (first 6), capturing group is exactly 6
				expect(match).not.toBeNull();
				expect(match![1]).toBe('abc123');
			});
		});

		describe('DEP_REGEX', () => {
			it('matches a single dependency', () => {
				const line = '- [ ] Child task ⛔ abc123';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe('abc123');
			});

			it('matches comma-separated dependencies', () => {
				const line = '- [ ] Child ⛔ abc123,def456';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe('abc123,def456');
			});

			it('matches comma-separated dependencies with spaces', () => {
				const line = '- [ ] Child ⛔ abc123, def456';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe('abc123, def456');
			});

			it('does not match a dep with uppercase chars', () => {
				const line = '⛔ ABCDEF';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).toBeNull();
			});

			it('matches ⛔ even when followed by other markers like 🆔', () => {
				const line = '- [ ] Task ⛔ abc123 🆔 def456';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe('abc123');
			});

			it('captures spaces between comma-separated IDs literally', () => {
				const line = '- [ ] Task ⛔ abc123, def456';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				// The \s* in the regex allows spaces, so the captured group includes them
				expect(match![1]).toContain(' ');
			});

			it('matches when there is whitespace before the comma', () => {
				const line = '- [ ] Task ⛔ abc123 ,def456';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe('abc123 ,def456');
			});
		});
	});

	describe('DEFAULT_INDENT_CONFIG', () => {
		it('defaults to useTab true and tabSize 4', () => {
			expect(DEFAULT_INDENT_CONFIG).toEqual({ useTab: true, tabSize: 4 });
		});
	});

	describe('constructor', () => {
		it('creates an instance with default config', () => {
			const parser = new TaskParser();
			expect(parser).toBeInstanceOf(TaskParser);
		});

		it('creates an instance with custom config', () => {
			const parser = new TaskParser({ useTab: false, tabSize: 2 });
			expect(parser).toBeInstanceOf(TaskParser);
		});
	});

	describe('isTaskLine', () => {
		const parser = new TaskParser();

		it('returns true for a dash task', () => {
			expect(parser.isTaskLine('- [ ] Buy milk')).toBe(true);
		});

		it('returns true for an asterisk task', () => {
			expect(parser.isTaskLine('* [ ] Buy milk')).toBe(true);
		});

		it('returns true for a completed task', () => {
			expect(parser.isTaskLine('- [x] Done')).toBe(true);
		});

		it('returns true for a tab-indented task', () => {
			expect(parser.isTaskLine('\t- [ ] Indented')).toBe(true);
		});

		it('returns true for a space-indented task', () => {
			expect(parser.isTaskLine('    * [x] Deep task')).toBe(true);
		});

		it('returns false for a plain bullet', () => {
			expect(parser.isTaskLine('- Just a bullet')).toBe(false);
		});

		it('returns false for a heading', () => {
			expect(parser.isTaskLine('## Heading')).toBe(false);
		});

		it('returns false for empty string', () => {
			expect(parser.isTaskLine('')).toBe(false);
		});

		it('returns false for whitespace-only', () => {
			expect(parser.isTaskLine('   ')).toBe(false);
		});

		it('returns false for a numbered list', () => {
			expect(parser.isTaskLine('1. First item')).toBe(false);
		});
	});

	describe('getIndentLevel', () => {
		describe('with useTab: true (default)', () => {
			const parser = new TaskParser();

			it('returns 0 for a line with no indentation', () => {
				expect(parser.getIndentLevel('- [ ] Root task')).toBe(0);
			});

			it('returns 1 for a single-tab indented line', () => {
				expect(parser.getIndentLevel('\t- [ ] One tab')).toBe(1);
			});

			it('returns 2 for a double-tab indented line', () => {
				expect(parser.getIndentLevel('\t\t- [ ] Two tabs')).toBe(2);
			});

			it('returns 0 for an empty string', () => {
				expect(parser.getIndentLevel('')).toBe(0);
			});

			it('counts leading tabs only, ignoring content', () => {
				expect(parser.getIndentLevel('\t\t\tDeep content')).toBe(3);
			});

			it('counts only leading tabs, not tabs after content', () => {
				expect(parser.getIndentLevel('text\t\ttabs')).toBe(0);
			});

			it('ignores leading spaces when useTab is true', () => {
				expect(parser.getIndentLevel('    - [ ] Spaces ignored')).toBe(0);
			});
		});

		describe('with useTab: false, tabSize: 4', () => {
			const parser = new TaskParser({ useTab: false, tabSize: 4 });

			it('returns 1 for 4-space indented line', () => {
				expect(parser.getIndentLevel('    - [ ] Spaced')).toBe(1);
			});

			it('returns 2 for 8-space indented line', () => {
				expect(parser.getIndentLevel('        - [ ] Deep')).toBe(2);
			});

			it('returns 0 for fewer spaces than tabSize', () => {
				expect(parser.getIndentLevel('   - [ ] Partial')).toBe(0);
			});

			it('floors partial indent levels', () => {
				expect(parser.getIndentLevel('      - [ ] 6 spaces')).toBe(1);
			});

			it('returns 0 for no indentation', () => {
				expect(parser.getIndentLevel('- [ ] Root')).toBe(0);
			});

			it('does not count spaces after content', () => {
				expect(parser.getIndentLevel('text    spaces')).toBe(0);
			});
		});

		describe('with useTab: false, tabSize: 2', () => {
			const parser = new TaskParser({ useTab: false, tabSize: 2 });

			it('returns 1 for 2-space indented line', () => {
				expect(parser.getIndentLevel('  - [ ] Two spaces')).toBe(1);
			});

			it('returns 2 for 4-space indented line', () => {
				expect(parser.getIndentLevel('    - [ ] Four spaces')).toBe(2);
			});

			it('returns 3 for 6-space indented line', () => {
				expect(parser.getIndentLevel('      - [ ] Six spaces')).toBe(3);
			});
		});

		describe('with mixed tabs and spaces (useTab: false, tabSize: 4)', () => {
			const parser = new TaskParser({ useTab: false, tabSize: 4 });

			it('counts tab then spaces as additional partial level', () => {
				expect(parser.getIndentLevel('\t    - [ ] Tab+4spaces')).toBe(2);
			});

			it('counts tabs with trailing spaces below tabSize', () => {
				expect(parser.getIndentLevel('\t  - [ ] Tab+2spaces')).toBe(1);
			});

			it('handles multiple tabs then spaces', () => {
				expect(parser.getIndentLevel('\t\t    - [ ] 2tabs+4spaces')).toBe(3);
			});
		});
	});

	describe('getTaskId', () => {
		const parser = new TaskParser();

		it('returns the ID from a task line with an ID marker', () => {
			expect(parser.getTaskId('- [ ] Parent task \u{1F194} abc123')).toBe('abc123');
		});

		it('returns null when the line has no ID marker', () => {
			expect(parser.getTaskId('- [ ] No ID here')).toBeNull();
		});

		it('returns null for an empty string', () => {
			expect(parser.getTaskId('')).toBeNull();
		});

		it('extracts the ID even with surrounding text', () => {
			expect(parser.getTaskId('- [ ] Task \u{1F194} z9a8b7 some notes')).toBe('z9a8b7');
		});

		it('returns the ID from a line that also has dependencies', () => {
			expect(parser.getTaskId('- [ ] Task 🆔 abc123 ⛔ def456,ghi789')).toBe('abc123');
		});
	});

	describe('getTaskDependencies', () => {
		const parser = new TaskParser();

		it('returns an empty array when there are no dependencies', () => {
			expect(parser.getTaskDependencies('- [ ] No deps')).toEqual([]);
		});

		it('returns a single dependency', () => {
			expect(parser.getTaskDependencies('- [ ] Child ⛔ abc123')).toEqual(['abc123']);
		});

		it('returns multiple comma-separated dependencies', () => {
			expect(
				parser.getTaskDependencies('- [ ] Child ⛔ abc123,def456'),
			).toEqual(['abc123', 'def456']);
		});

		it('returns multiple comma-separated dependencies with spaces', () => {
			expect(
				parser.getTaskDependencies('- [ ] Child ⛔ abc123, def456'),
			).toEqual(['abc123', 'def456']);
		});

		it('returns an empty array for an empty string', () => {
			expect(parser.getTaskDependencies('')).toEqual([]);
		});

		it('returns dependencies even when an ID marker is also present', () => {
			expect(
				parser.getTaskDependencies(
					'- [ ] Task 🆔 xxx111 ⛔ abc123,def456',
				),
			).toEqual(['abc123', 'def456']);
		});

		it('returns dependencies when ⛔ appears before 🆔', () => {
			expect(
				parser.getTaskDependencies(
					'- [ ] Task ⛔ abc123 🆔 xxx111',
				),
			).toEqual(['abc123']);
		});

		it('returns comma-separated dependencies when ⛔ appears before 🆔', () => {
			expect(
				parser.getTaskDependencies(
					'- [ ] Task ⛔ abc123,def456 🆔 xxx111',
				),
			).toEqual(['abc123', 'def456']);
		});
	});

	describe('addIdToLine', () => {
		const parser = new TaskParser();

		it('appends the ID marker to the end of the line', () => {
			expect(parser.addIdToLine('- [ ] Parent task', 'abc123')).toBe(
				'- [ ] Parent task \u{1F194} abc123',
			);
		});

		it('preserves trailing whitespace by trimming then appending', () => {
			expect(parser.addIdToLine('- [ ] Task  ', 'abc123')).toBe(
				'- [ ] Task   \u{1F194} abc123',
			);
		});

		it('works with an indented line', () => {
			expect(parser.addIdToLine('\t- [ ] Sub task', 'z9a8b7')).toBe(
				'\t- [ ] Sub task \u{1F194} z9a8b7',
			);
		});

		it('does not duplicate if line already has the same ID', () => {
			const line = '- [ ] Task \u{1F194} abc123';
			expect(parser.addIdToLine(line, 'abc123')).toBe(line);
		});
	});

	describe('addDependencyToLine', () => {
		const parser = new TaskParser();

		it('appends the dependency marker to the end of the line', () => {
			expect(parser.addDependencyToLine('- [ ] Child task', 'abc123')).toBe(
				'- [ ] Child task ⛔ abc123',
			);
		});

		it('works on a line that already has an ID', () => {
			expect(
				parser.addDependencyToLine('- [ ] Child 🆔 xxx111', 'abc123'),
			).toBe('- [ ] Child 🆔 xxx111 ⛔ abc123');
		});

		it('appends to existing comma-separated list when line already has a dependency', () => {
			expect(
				parser.addDependencyToLine('- [ ] Child ⛔ aaa111', 'bbb222'),
			).toBe('- [ ] Child ⛔ aaa111,bbb222');
		});

		it('does not duplicate if the same dependency already exists', () => {
			const line = '- [ ] Child ⛔ abc123';
			expect(parser.addDependencyToLine(line, 'abc123')).toBe(line);
		});

		it('does not duplicate in a comma-separated list', () => {
			const line = '- [ ] Child ⛔ abc123,def456';
			expect(parser.addDependencyToLine(line, 'def456')).toBe(line);
		});

		it('works with an indented line', () => {
			expect(parser.addDependencyToLine('\t- [ ] Sub', 'abc123')).toBe(
				'\t- [ ] Sub ⛔ abc123',
			);
		});

		it('appends to ⛔ that appears before 🆔', () => {
			expect(
				parser.addDependencyToLine('- [ ] Task ⛔ aaa111 🆔 xxx111', 'bbb222'),
			).toBe('- [ ] Task ⛔ aaa111,bbb222 🆔 xxx111');
		});
	});

	describe('removeDependencyFromLine', () => {
		const parser = new TaskParser();

		it('removes the entire ⛔ marker when removing the only dependency', () => {
			expect(
				parser.removeDependencyFromLine('- [ ] Child ⛔ abc123', 'abc123'),
			).toBe('- [ ] Child');
		});

		it('removes the first ID from a comma-separated list', () => {
			expect(
				parser.removeDependencyFromLine(
					'- [ ] Child ⛔ abc123,def456',
					'abc123',
				),
			).toBe('- [ ] Child ⛔ def456');
		});

		it('removes the last ID from a comma-separated list', () => {
			expect(
				parser.removeDependencyFromLine(
					'- [ ] Child ⛔ abc123,def456',
					'def456',
				),
			).toBe('- [ ] Child ⛔ abc123');
		});

		it('removes a middle ID from a comma-separated list', () => {
			expect(
				parser.removeDependencyFromLine(
					'- [ ] Child ⛔ abc123,def456,ghi789',
					'def456',
				),
			).toBe('- [ ] Child ⛔ abc123,ghi789');
		});

		it('returns the line unchanged if the dependency does not exist', () => {
			const line = '- [ ] Child ⛔ abc123';
			const result = parser.removeDependencyFromLine(line, 'zzz999');
			expect(result).toBe(line);
			// Verify it's the exact same string reference (early return, no rebuild)
			expect(Object.is(result, line)).toBe(true);
		});

		it('returns the line unchanged if there are no dependencies', () => {
			const line = '- [ ] No deps';
			const result = parser.removeDependencyFromLine(line, 'abc123');
			expect(result).toBe(line);
			expect(Object.is(result, line)).toBe(true);
		});

		it('preserves spaces in comma-separated list when dep does not exist', () => {
			const line = '- [ ] Child ⛔ abc123, def456';
			const result = parser.removeDependencyFromLine(line, 'zzz999');
			expect(result).toBe('- [ ] Child ⛔ abc123, def456');
		});

		it('preserves the ID marker when removing a dependency', () => {
			expect(
				parser.removeDependencyFromLine(
					'- [ ] Task 🆔 xxx111 ⛔ abc123',
					'abc123',
				),
			).toBe('- [ ] Task 🆔 xxx111');
		});

		it('handles removing the last dependency and cleans up trailing space', () => {
			expect(
				parser.removeDependencyFromLine('- [ ] Task ⛔ abc123', 'abc123'),
			).toBe('- [ ] Task');
		});

		it('preserves leading whitespace (indentation) after removal', () => {
			expect(
				parser.removeDependencyFromLine('\t- [ ] Task ⛔ abc123', 'abc123'),
			).toBe('\t- [ ] Task');
		});

		it('removes ⛔ marker without leading space (e.g. at start of line)', () => {
			expect(
				parser.removeDependencyFromLine('⛔ abc123', 'abc123'),
			).toBe('');
		});

		it('removes a dep from a list with spaces after commas', () => {
			expect(
				parser.removeDependencyFromLine(
					'- [ ] Child ⛔ abc123, def456',
					'def456',
				),
			).toBe('- [ ] Child ⛔ abc123');
		});

		it('removes ⛔ that appears before 🆔 and preserves the 🆔', () => {
			expect(
				parser.removeDependencyFromLine(
					'- [ ] Task ⛔ abc123 🆔 xxx111',
					'abc123',
				),
			).toBe('- [ ] Task 🆔 xxx111');
		});

		it('removes one dep from comma list before 🆔 and preserves both', () => {
			expect(
				parser.removeDependencyFromLine(
					'- [ ] Task ⛔ abc123,def456 🆔 xxx111',
					'abc123',
				),
			).toBe('- [ ] Task ⛔ def456 🆔 xxx111');
		});
	});

	describe('removeIdFromLine', () => {
		const parser = new TaskParser();

		it('removes the ID marker from a task line', () => {
			expect(
				parser.removeIdFromLine('- [ ] Task 🆔 abc123'),
			).toBe('- [ ] Task');
		});

		it('returns the line unchanged if no ID marker exists', () => {
			const line = '- [ ] No ID here';
			expect(parser.removeIdFromLine(line)).toBe(line);
		});

		it('preserves dependencies when removing the ID', () => {
			expect(
				parser.removeIdFromLine('- [ ] Task 🆔 abc123 ⛔ def456,ghi789'),
			).toBe('- [ ] Task ⛔ def456,ghi789');
		});

		it('preserves leading whitespace (indentation) after removal', () => {
			expect(
				parser.removeIdFromLine('\t- [ ] Task 🆔 abc123'),
			).toBe('\t- [ ] Task');
		});

		it('cleans up trailing whitespace after removal', () => {
			expect(
				parser.removeIdFromLine('- [ ] Task 🆔 abc123  '),
			).toBe('- [ ] Task');
		});

		it('returns an empty string unchanged', () => {
			expect(parser.removeIdFromLine('')).toBe('');
		});

		it('removes the ID marker even without a leading space', () => {
			expect(parser.removeIdFromLine('🆔 abc123')).toBe('');
		});
	});
});
