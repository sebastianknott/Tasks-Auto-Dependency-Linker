import { describe, it, expect } from 'vitest';
import { MarkerScanner } from '../../src/parsing/marker-scanner';

describe('MarkerScanner', () => {
	describe('collectAllIds', () => {
		it.each<[string, string, Set<string>]>([
			[
				'returns an empty set for empty content',
				'',
				new Set(),
			],
			[
				'finds a single ID in content',
				'- [ ] Parent task 🆔 abc123',
				new Set(['abc123']),
			],
			[
				'finds multiple IDs across lines',
				[
					'- [ ] Task A 🆔 aaa111',
					'- [ ] Task B 🆔 bbb222',
					'Some text without ID',
					'\t- [ ] Task C 🆔 ccc333',
				].join('\n'),
				new Set(['aaa111', 'bbb222', 'ccc333']),
			],
			[
				'does not include dependency IDs',
				'- [ ] Task 🆔 aaa111 ⛔ bbb222',
				new Set(['aaa111']),
			],
			[
				'handles content with no IDs',
				'- [ ] Task without ID\n- [ ] Another task',
				new Set(),
			],
		])('%s', (_name, content, expected) => {
			const scanner = new MarkerScanner();
			const ids = scanner.collectAllIds(content);
			expect(ids).toEqual(expected);
		});
	});

	describe('collectAllDepIds', () => {
		it.each<[string, string, Set<string>]>([
			[
				'returns empty set when content has no deps',
				'',
				new Set(),
			],
			[
				'returns empty set for content with only 🆔 markers',
				'- [ ] Task 🆔 abc123',
				new Set(),
			],
			[
				'returns single dep ID from ⛔ marker',
				'- [ ] Task ⛔ abc123',
				new Set(['abc123']),
			],
			[
				'returns multiple comma-separated dep IDs',
				'- [ ] Task ⛔ abc123,def456',
				new Set(['abc123', 'def456']),
			],
			[
				'returns deps from multiple lines',
				[
					'- [ ] Task A ⛔ aaa111',
					'- [ ] Task B ⛔ bbb222',
				].join('\n'),
				new Set(['aaa111', 'bbb222']),
			],
			[
				'handles mixed content (lines with and without deps)',
				[
					'- [ ] Task A ⛔ aaa111',
					'- [ ] Task B 🆔 bbb222',
					'Some plain text',
					'- [ ] Task C ⛔ ccc333,ddd444',
				].join('\n'),
				new Set(['aaa111', 'ccc333', 'ddd444']),
			],
			[
				'trims whitespace around comma-separated IDs',
				'- [ ] Task ⛔ abc123 , def456',
				new Set(['abc123', 'def456']),
			],
		])('%s', (_name, content, expected) => {
			const scanner = new MarkerScanner();
			const deps = scanner.collectAllDepIds(content);
			expect(deps).toEqual(expected);
		});
	});
});
