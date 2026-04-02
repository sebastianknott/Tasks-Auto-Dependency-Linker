import { describe, it, expect } from 'vitest';
import { TaskParser } from '../src/task-parser';

describe('TaskParser', () => {
	describe('static regex constants', () => {
		describe('TASK_REGEX', () => {
			it.each([
				['matches a dash task line with space checkbox', '- [ ] My task', true],
				['matches an asterisk task line', '* [ ] My task', true],
				['matches a completed task (x)', '- [x] Done task', true],
				['matches an indented task line', '\t- [ ] Indented task', true],
				['matches a task indented with spaces', '    - [ ] Spaced task', true],
				['does not match a plain bullet without checkbox', '- No checkbox', false],
				['does not match a heading', '# Heading', false],
				['does not match plain text', 'Just some text', false],
				['does not match an empty line', '', false],
				['does not match when checkbox pattern appears mid-line', 'text - [ ] not a task', false],
			])('%s', (_desc, input, expected) => {
				expect(TaskParser.TASK_REGEX.test(input)).toBe(expected);
			});
		});

		describe('ID_REGEX', () => {
			it.each([
				['matches a valid ID marker', '\u{1F194} abc123', 'abc123'],
				['extracts only the 6-char id', 'Some task \u{1F194} z9a8b7 rest', 'z9a8b7'],
				['matches an ID with uppercase chars', '\u{1F194} AbC123', 'AbC123'],
				['matches an ID with hyphens', '\u{1F194} my-task-id', 'my-task-id'],
				['matches an ID with underscores', '\u{1F194} my_task', 'my_task'],
				['matches a longer ID (10 chars)', '\u{1F194} abcdefghij', 'abcdefghij'],
				['matches a single-char ID', '\u{1F194} a', 'a'],
				['matches a shorter ID (5 chars)', '\u{1F194} abc12', 'abc12'],
				['matches a longer ID and captures the full ID', '\u{1F194} abc1234', 'abc1234'],
			])('%s', (_desc, input, expected) => {
				const match = input.match(TaskParser.ID_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe(expected);
			});
		});

		describe('DEP_REGEX', () => {
			it.each([
				['matches a single dependency', '- [ ] Child task ⛔ abc123', 'abc123'],
				['matches comma-separated dependencies', '- [ ] Child ⛔ abc123,def456', 'abc123,def456'],
				['matches comma-separated dependencies with spaces', '- [ ] Child ⛔ abc123, def456', 'abc123, def456'],
				['matches dep IDs with uppercase chars', '⛔ AbC123', 'AbC123'],
				['matches dep IDs with hyphens', '⛔ my-task-id', 'my-task-id'],
				['matches comma-separated mixed-case deps', '⛔ AbC123,my-task', 'AbC123,my-task'],
				['matches deps when followed by other metadata', '⛔ abc123 📅 2025-01-01', 'abc123'],
				['matches ⛔ even when followed by other markers like 🆔', '- [ ] Task ⛔ abc123 🆔 def456', 'abc123'],
				['matches when there is whitespace before the comma', '- [ ] Task ⛔ abc123 ,def456', 'abc123 ,def456'],
			])('%s', (_desc, input, expected) => {
				const match = input.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				expect(match![1]).toBe(expected);
			});

			it('captures spaces between comma-separated IDs literally', () => {
				const line = '- [ ] Task ⛔ abc123, def456';
				const match = line.match(TaskParser.DEP_REGEX);
				expect(match).not.toBeNull();
				// The \s* in the regex allows spaces, so the captured group includes them
				expect(match![1]).toContain(' ');
			});
		});
	});

	describe('DEFAULT_CONFIG', () => {
		it('defaults to useTab true and tabSize 4', () => {
			expect(TaskParser.DEFAULT_CONFIG).toEqual({ useTab: true, tabSize: 4 });
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

		it.each([
			['returns true for a dash task', '- [ ] Buy milk', true],
			['returns true for an asterisk task', '* [ ] Buy milk', true],
			['returns true for a completed task', '- [x] Done', true],
			['returns true for a tab-indented task', '\t- [ ] Indented', true],
			['returns true for a space-indented task', '    * [x] Deep task', true],
			['returns false for a plain bullet', '- Just a bullet', false],
			['returns false for a heading', '## Heading', false],
			['returns false for empty string', '', false],
			['returns false for whitespace-only', '   ', false],
			['returns false for a numbered list', '1. First item', false],
		])('%s', (_desc, input, expected) => {
			expect(parser.isTaskLine(input)).toBe(expected);
		});
	});

	describe('isListItem', () => {
		const parser = new TaskParser();

		it.each([
			['returns true for a dash bullet', '- item', true],
			['returns true for an asterisk bullet', '* item', true],
			['returns true for a dash task', '- [ ] task', true],
			['returns true for a tab-indented task', '\t- [ ] indented task', true],
			['returns true for a space-indented completed task', '    * [x] space-indented completed task', true],
			['returns true for a tab-indented bullet', '\t- plain bullet', true],
			['returns false for a blank line', '', false],
			['returns false for a heading', '# Heading', false],
			['returns false for paragraph text', 'Some text', false],
			['returns false for whitespace-only', '   ', false],
			['returns false for a numbered list', '1. First item', false],
			['returns false when bullet marker appears mid-line', 'text - not a list item', false],
		])('%s', (_desc, input, expected) => {
			expect(parser.isListItem(input)).toBe(expected);
		});
	});

	describe('getIndentLevel', () => {
		describe('with useTab: true (default)', () => {
			const parser = new TaskParser();

			it.each([
				['returns 0 for a line with no indentation', '- [ ] Root task', 0],
				['returns 1 for a single-tab indented line', '\t- [ ] One tab', 1],
				['returns 2 for a double-tab indented line', '\t\t- [ ] Two tabs', 2],
				['returns 0 for an empty string', '', 0],
				['counts leading tabs only, ignoring content', '\t\t\tDeep content', 3],
				['counts only leading tabs, not tabs after content', 'text\t\ttabs', 0],
				['ignores leading spaces when useTab is true', '    - [ ] Spaces ignored', 0],
			])('%s', (_desc, input, expected) => {
				expect(parser.getIndentLevel(input)).toBe(expected);
			});
		});

		describe('with useTab: false, tabSize: 4', () => {
			const parser = new TaskParser({ useTab: false, tabSize: 4 });

			it.each([
				['returns 1 for 4-space indented line', '    - [ ] Spaced', 1],
				['returns 2 for 8-space indented line', '        - [ ] Deep', 2],
				['returns 0 for fewer spaces than tabSize', '   - [ ] Partial', 0],
				['floors partial indent levels', '      - [ ] 6 spaces', 1],
				['returns 0 for no indentation', '- [ ] Root', 0],
				['does not count spaces after content', 'text    spaces', 0],
			])('%s', (_desc, input, expected) => {
				expect(parser.getIndentLevel(input)).toBe(expected);
			});
		});

		describe('with useTab: false, tabSize: 2', () => {
			const parser = new TaskParser({ useTab: false, tabSize: 2 });

			it.each([
				['returns 1 for 2-space indented line', '  - [ ] Two spaces', 1],
				['returns 2 for 4-space indented line', '    - [ ] Four spaces', 2],
				['returns 3 for 6-space indented line', '      - [ ] Six spaces', 3],
			])('%s', (_desc, input, expected) => {
				expect(parser.getIndentLevel(input)).toBe(expected);
			});
		});

		describe('with mixed tabs and spaces (useTab: false, tabSize: 4)', () => {
			const parser = new TaskParser({ useTab: false, tabSize: 4 });

			it.each([
				['counts tab then spaces as additional partial level', '\t    - [ ] Tab+4spaces', 2],
				['counts tabs with trailing spaces below tabSize', '\t  - [ ] Tab+2spaces', 1],
				['handles multiple tabs then spaces', '\t\t    - [ ] 2tabs+4spaces', 3],
			])('%s', (_desc, input, expected) => {
				expect(parser.getIndentLevel(input)).toBe(expected);
			});
		});
	});

	describe('getTaskId', () => {
		const parser = new TaskParser();

		it.each([
			['returns the ID from a task line with an ID marker', '- [ ] Parent task \u{1F194} abc123', 'abc123'],
			['returns null when the line has no ID marker', '- [ ] No ID here', null],
			['returns null for an empty string', '', null],
			['extracts the ID even with surrounding text', '- [ ] Task \u{1F194} z9a8b7 some notes', 'z9a8b7'],
			['returns the ID from a line that also has dependencies', '- [ ] Task 🆔 abc123 ⛔ def456,ghi789', 'abc123'],
			['extracts an ID with uppercase, hyphens, and underscores', '- [ ] Task 🆔 My-Task_1', 'My-Task_1'],
			['extracts an ID when followed by other metadata', '- [ ] Task 🆔 abc123 📅 2025-01-01', 'abc123'],
		])('%s', (_desc, input, expected) => {
			expect(parser.getTaskId(input)).toBe(expected);
		});
	});

	describe('getTaskDependencies', () => {
		const parser = new TaskParser();

		it.each([
			['returns an empty array when there are no dependencies', '- [ ] No deps', []],
			['returns a single dependency', '- [ ] Child ⛔ abc123', ['abc123']],
			['returns multiple comma-separated dependencies', '- [ ] Child ⛔ abc123,def456', ['abc123', 'def456']],
			['returns multiple comma-separated dependencies with spaces', '- [ ] Child ⛔ abc123, def456', ['abc123', 'def456']],
			['returns an empty array for an empty string', '', []],
			['returns dependencies even when an ID marker is also present', '- [ ] Task 🆔 xxx111 ⛔ abc123,def456', ['abc123', 'def456']],
			['returns dependencies when ⛔ appears before 🆔', '- [ ] Task ⛔ abc123 🆔 xxx111', ['abc123']],
			['returns comma-separated dependencies when ⛔ appears before 🆔', '- [ ] Task ⛔ abc123,def456 🆔 xxx111', ['abc123', 'def456']],
			['extracts deps with uppercase, hyphens, and underscores', '- [ ] Child ⛔ My-Task_1,AbC123', ['My-Task_1', 'AbC123']],
			['extracts deps when followed by other metadata', '- [ ] Child ⛔ abc123 📅 2025-01-01', ['abc123']],
		])('%s', (_desc, input, expected) => {
			expect(parser.getTaskDependencies(input)).toEqual(expected);
		});
	});

	describe('addIdToLine', () => {
		const parser = new TaskParser();

		it.each([
			['appends the ID marker to the end of the line', '- [ ] Parent task', 'abc123', '- [ ] Parent task \u{1F194} abc123'],
			['preserves trailing whitespace by trimming then appending', '- [ ] Task  ', 'abc123', '- [ ] Task   \u{1F194} abc123'],
			['works with an indented line', '\t- [ ] Sub task', 'z9a8b7', '\t- [ ] Sub task \u{1F194} z9a8b7'],
			['does not duplicate if line already has the same ID', '- [ ] Task \u{1F194} abc123', 'abc123', '- [ ] Task \u{1F194} abc123'],
		])('%s', (_desc, input, id, expected) => {
			expect(parser.addIdToLine(input, id)).toBe(expected);
		});
	});

	describe('addDependencyToLine', () => {
		const parser = new TaskParser();

		it.each([
			['appends the dependency marker to the end of the line', '- [ ] Child task', 'abc123', '- [ ] Child task ⛔ abc123'],
			['works on a line that already has an ID', '- [ ] Child 🆔 xxx111', 'abc123', '- [ ] Child 🆔 xxx111 ⛔ abc123'],
			['appends to existing comma-separated list when line already has a dependency', '- [ ] Child ⛔ aaa111', 'bbb222', '- [ ] Child ⛔ aaa111,bbb222'],
			['does not duplicate if the same dependency already exists', '- [ ] Child ⛔ abc123', 'abc123', '- [ ] Child ⛔ abc123'],
			['does not duplicate in a comma-separated list', '- [ ] Child ⛔ abc123,def456', 'def456', '- [ ] Child ⛔ abc123,def456'],
			['works with an indented line', '\t- [ ] Sub', 'abc123', '\t- [ ] Sub ⛔ abc123'],
			['appends to ⛔ that appears before 🆔', '- [ ] Task ⛔ aaa111 🆔 xxx111', 'bbb222', '- [ ] Task ⛔ aaa111,bbb222 🆔 xxx111'],
		])('%s', (_desc, input, depId, expected) => {
			expect(parser.addDependencyToLine(input, depId)).toBe(expected);
		});
	});

	describe('removeDependencyFromLine', () => {
		const parser = new TaskParser();

		it.each([
			['removes the entire ⛔ marker when removing the only dependency', '- [ ] Child ⛔ abc123', 'abc123', '- [ ] Child'],
			['removes the first ID from a comma-separated list', '- [ ] Child ⛔ abc123,def456', 'abc123', '- [ ] Child ⛔ def456'],
			['removes the last ID from a comma-separated list', '- [ ] Child ⛔ abc123,def456', 'def456', '- [ ] Child ⛔ abc123'],
			['removes a middle ID from a comma-separated list', '- [ ] Child ⛔ abc123,def456,ghi789', 'def456', '- [ ] Child ⛔ abc123,ghi789'],
			['preserves spaces in comma-separated list when dep does not exist', '- [ ] Child ⛔ abc123, def456', 'zzz999', '- [ ] Child ⛔ abc123, def456'],
			['preserves the ID marker when removing a dependency', '- [ ] Task 🆔 xxx111 ⛔ abc123', 'abc123', '- [ ] Task 🆔 xxx111'],
			['handles removing the last dependency and cleans up trailing space', '- [ ] Task ⛔ abc123', 'abc123', '- [ ] Task'],
			['preserves leading whitespace (indentation) after removal', '\t- [ ] Task ⛔ abc123', 'abc123', '\t- [ ] Task'],
			['removes ⛔ marker without leading space (e.g. at start of line)', '⛔ abc123', 'abc123', ''],
			['removes a dep from a list with spaces after commas', '- [ ] Child ⛔ abc123, def456', 'def456', '- [ ] Child ⛔ abc123'],
			['removes ⛔ that appears before 🆔 and preserves the 🆔', '- [ ] Task ⛔ abc123 🆔 xxx111', 'abc123', '- [ ] Task 🆔 xxx111'],
			['removes one dep from comma list before 🆔 and preserves both', '- [ ] Task ⛔ abc123,def456 🆔 xxx111', 'abc123', '- [ ] Task ⛔ def456 🆔 xxx111'],
			['removes a dep with uppercase, hyphens, and underscores', '- [ ] Child ⛔ My-Task_1', 'My-Task_1', '- [ ] Child'],
		])('%s', (_desc, input, depId, expected) => {
			expect(parser.removeDependencyFromLine(input, depId)).toBe(expected);
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
	});

	describe('removeIdFromLine', () => {
		const parser = new TaskParser();

		it.each([
			['removes the ID marker from a task line', '- [ ] Task 🆔 abc123', '- [ ] Task'],
			['returns the line unchanged if no ID marker exists', '- [ ] No ID here', '- [ ] No ID here'],
			['preserves dependencies when removing the ID', '- [ ] Task 🆔 abc123 ⛔ def456,ghi789', '- [ ] Task ⛔ def456,ghi789'],
			['preserves leading whitespace (indentation) after removal', '\t- [ ] Task 🆔 abc123', '\t- [ ] Task'],
			['cleans up trailing whitespace after removal', '- [ ] Task 🆔 abc123  ', '- [ ] Task'],
			['returns an empty string unchanged', '', ''],
			['removes the ID marker even without a leading space', '🆔 abc123', ''],
			['removes an uppercase ID', '- [ ] Task 🆔 AbC123', '- [ ] Task'],
			['removes a long ID with hyphens and underscores', '- [ ] Task 🆔 my-long_task-id', '- [ ] Task'],
		])('%s', (_desc, input, expected) => {
			expect(parser.removeIdFromLine(input)).toBe(expected);
		});
	});
});
