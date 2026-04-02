import { describe, it, expect, vi } from 'vitest';
import { IdEngine, IdCache, DepCache } from '../src/id-engine';

describe('IdEngine', () => {
	describe('generateId', () => {
		it('returns a 6-character string', () => {
			const engine = new IdEngine();
			const id = engine.generateId();
			expect(id).toHaveLength(6);
		});

		it('contains only lowercase alphanumeric characters', () => {
			const engine = new IdEngine();
			const id = engine.generateId();
			expect(id).toMatch(/^[a-z0-9]{6}$/);
		});

		it('produces different IDs on successive calls', () => {
			const engine = new IdEngine();
			const ids = new Set<string>();
			for (let i = 0; i < 50; i++) {
				ids.add(engine.generateId());
			}
			// With 2.18 billion combinations, 50 IDs should all be unique
			expect(ids.size).toBe(50);
		});
	});

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
			const engine = new IdEngine();
			const ids = engine.collectAllIds(content);
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
			const engine = new IdEngine();
			const deps = engine.collectAllDepIds(content);
			expect(deps).toEqual(expected);
		});
	});

	describe('generateUniqueId', () => {
		it('returns an ID not present in the existing set', () => {
			const engine = new IdEngine();
			const existing = new Set(['abc123', 'def456']);
			const id = engine.generateUniqueId(existing);
			expect(id).toHaveLength(6);
			expect(existing.has(id)).toBe(false);
		});

		it('returns a valid 6-char lowercase alphanumeric ID', () => {
			const engine = new IdEngine();
			const id = engine.generateUniqueId(new Set());
			expect(id).toMatch(/^[a-z0-9]{6}$/);
		});

		it('avoids collisions with a large existing set', () => {
			const engine = new IdEngine();
			const existing = new Set<string>();
			// Pre-fill with 100 IDs
			for (let i = 0; i < 100; i++) {
				existing.add(engine.generateId());
			}
			const newId = engine.generateUniqueId(existing);
			expect(existing.has(newId)).toBe(false);
		});

		it('retries when the first generated ID collides', () => {
			const engine = new IdEngine();
			const collisionId = 'aaaaaa';
			const uniqueId = 'bbbbbb';
			const existing = new Set([collisionId]);

			// First call returns the collision, second call returns unique
			const spy = vi.spyOn(engine, 'generateId');
			spy.mockReturnValueOnce(collisionId);
			spy.mockReturnValueOnce(uniqueId);

			const result = engine.generateUniqueId(existing);
			expect(result).toBe(uniqueId);
			expect(spy).toHaveBeenCalledTimes(2);

			spy.mockRestore();
		});
	});
});

describe('IdCache', () => {
	describe('buildFromFiles', () => {
		it.each<[string, { path: string; content: string }[], Set<string>]>([
			[
				'returns an empty set for an empty files array',
				[],
				new Set(),
			],
			[
				'collects IDs from a single file',
				[{ path: 'note.md', content: '- [ ] Task 🆔 abc123' }],
				new Set(['abc123']),
			],
			[
				'collects IDs from multiple files',
				[
					{ path: 'a.md', content: '- [ ] Task A 🆔 aaa111' },
					{ path: 'b.md', content: '- [ ] Task B 🆔 bbb222\n- [ ] Task C 🆔 ccc333' },
				],
				new Set(['aaa111', 'bbb222', 'ccc333']),
			],
		])('%s', (_name, files, expected) => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles(files);
			expect(cache.getIds()).toEqual(expected);
		});

		it('clears previous IDs before rebuilding', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'old.md', content: '- [ ] Task 🆔 old111' },
			]);
			cache.buildFromFiles([
				{ path: 'new.md', content: '- [ ] Task 🆔 new222' },
			]);
			expect(cache.getIds()).toEqual(new Set(['new222']));
			expect(cache.getIds().has('old111')).toBe(false);
		});
	});

	describe('updateForFile', () => {
		it('adds new IDs from a file', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
			]);
			cache.updateForFile('b.md', '- [ ] Task 🆔 bbb222');
			expect(cache.getIds()).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('removes stale IDs when file content changes', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
				{ path: 'b.md', content: '- [ ] Task 🆔 bbb222' },
			]);
			// File b.md changed: bbb222 was removed, ccc333 was added
			cache.updateForFile('b.md', '- [ ] Task 🆔 ccc333');
			expect(cache.getIds()).toEqual(new Set(['aaa111', 'ccc333']));
			expect(cache.getIds().has('bbb222')).toBe(false);
		});

		it('removes all IDs for a file when new content has none', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
				{ path: 'b.md', content: '- [ ] Task 🆔 bbb222' },
			]);
			cache.updateForFile('b.md', '- [ ] Plain task');
			expect(cache.getIds()).toEqual(new Set(['aaa111']));
		});

		it('does not affect IDs from other files', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
				{ path: 'b.md', content: '- [ ] Task 🆔 bbb222' },
			]);
			cache.updateForFile('b.md', '- [ ] Task 🆔 ccc333');
			// a.md's ID should be untouched
			expect(cache.getIds().has('aaa111')).toBe(true);
		});

		it('works for a new file not seen in buildFromFiles', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([]);
			cache.updateForFile('new.md', '- [ ] Task 🆔 abc123');
			expect(cache.getIds()).toEqual(new Set(['abc123']));
		});
	});

	describe('getIds', () => {
		it('returns a consistent set across calls', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 abc123' },
			]);
			const ids1 = cache.getIds();
			const ids2 = cache.getIds();
			expect(ids1).toEqual(ids2);
		});
	});

	describe('getIdsExcluding', () => {
		it.each<[string, { path: string; content: string }[], string, Set<string>]>([
			[
				'returns IDs from all files except the excluded one',
				[
					{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
					{ path: 'b.md', content: '- [ ] Task 🆔 bbb222' },
				],
				'a.md',
				new Set(['bbb222']),
			],
			[
				'returns all IDs when excluded path does not exist',
				[
					{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
				],
				'nonexistent.md',
				new Set(['aaa111']),
			],
			[
				'returns empty set when only file is excluded',
				[
					{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
				],
				'a.md',
				new Set(),
			],
			[
				'returns empty set for empty cache',
				[],
				'a.md',
				new Set(),
			],
			[
				'combines IDs from multiple non-excluded files',
				[
					{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
					{ path: 'b.md', content: '- [ ] Task 🆔 bbb222' },
					{ path: 'c.md', content: '- [ ] Task 🆔 ccc333' },
				],
				'b.md',
				new Set(['aaa111', 'ccc333']),
			],
		])('%s', (_name, files, excludePath, expected) => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles(files);
			const ids = cache.getIdsExcluding(excludePath);
			expect(ids).toEqual(expected);
		});
	});
});

describe('DepCache', () => {
	describe('buildFromFiles', () => {
		it.each<[string, { path: string; content: string }[], Set<string>]>([
			[
				'populates deps from multiple files',
				[
					{ path: 'a.md', content: '- [ ] Task A ⛔ aaa111' },
					{ path: 'b.md', content: '- [ ] Task B ⛔ bbb222\n- [ ] Task C ⛔ ccc333' },
				],
				new Set(['aaa111', 'bbb222', 'ccc333']),
			],
			[
				'returns empty set for empty files array',
				[],
				new Set(),
			],
		])('%s', (_name, files, expected) => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles(files);
			expect(cache.getDeps()).toEqual(expected);
		});

		it('clears previous deps before rebuilding', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'old.md', content: '- [ ] Task ⛔ old111' },
			]);
			cache.buildFromFiles([
				{ path: 'new.md', content: '- [ ] Task ⛔ new222' },
			]);
			expect(cache.getDeps()).toEqual(new Set(['new222']));
			expect(cache.getDeps().has('old111')).toBe(false);
		});
	});

	describe('updateForFile', () => {
		it('adds new deps from a file', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task ⛔ aaa111' },
			]);
			cache.updateForFile('b.md', '- [ ] Task ⛔ bbb222');
			expect(cache.getDeps()).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('removes stale deps when file content changes', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task ⛔ aaa111' },
				{ path: 'b.md', content: '- [ ] Task ⛔ bbb222' },
			]);
			// File b.md changed: bbb222 was removed, ccc333 was added
			cache.updateForFile('b.md', '- [ ] Task ⛔ ccc333');
			expect(cache.getDeps()).toEqual(new Set(['aaa111', 'ccc333']));
			expect(cache.getDeps().has('bbb222')).toBe(false);
		});

		it('removes all deps for a file when new content has none', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task ⛔ aaa111' },
				{ path: 'b.md', content: '- [ ] Task ⛔ bbb222' },
			]);
			cache.updateForFile('b.md', '- [ ] Plain task');
			expect(cache.getDeps()).toEqual(new Set(['aaa111']));
		});

		it('does not affect deps from other files', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task ⛔ aaa111' },
				{ path: 'b.md', content: '- [ ] Task ⛔ bbb222' },
			]);
			cache.updateForFile('b.md', '- [ ] Task ⛔ ccc333');
			expect(cache.getDeps().has('aaa111')).toBe(true);
		});

		it('works for a new file not seen in buildFromFiles', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([]);
			cache.updateForFile('new.md', '- [ ] Task ⛔ abc123');
			expect(cache.getDeps()).toEqual(new Set(['abc123']));
		});
	});

	describe('getDeps', () => {
		it('returns a consistent set across calls', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task ⛔ abc123' },
			]);
			const deps1 = cache.getDeps();
			const deps2 = cache.getDeps();
			expect(deps1).toEqual(deps2);
		});
	});
});
