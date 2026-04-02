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
		it('returns an empty set for empty content', () => {
			const engine = new IdEngine();
			const ids = engine.collectAllIds('');
			expect(ids.size).toBe(0);
		});

		it('finds a single ID in content', () => {
			const engine = new IdEngine();
			const content = '- [ ] Parent task \u{1F194} abc123';
			const ids = engine.collectAllIds(content);
			expect(ids).toEqual(new Set(['abc123']));
		});

		it('finds multiple IDs across lines', () => {
			const engine = new IdEngine();
			const content = [
				'- [ ] Task A \u{1F194} aaa111',
				'- [ ] Task B \u{1F194} bbb222',
				'Some text without ID',
				'\t- [ ] Task C \u{1F194} ccc333',
			].join('\n');
			const ids = engine.collectAllIds(content);
			expect(ids).toEqual(new Set(['aaa111', 'bbb222', 'ccc333']));
		});

		it('does not include dependency IDs', () => {
			const engine = new IdEngine();
			const content = '- [ ] Task \u{1F194} aaa111 \u26D4 bbb222';
			const ids = engine.collectAllIds(content);
			expect(ids).toEqual(new Set(['aaa111']));
		});

		it('handles content with no IDs', () => {
			const engine = new IdEngine();
			const content = '- [ ] Task without ID\n- [ ] Another task';
			const ids = engine.collectAllIds(content);
			expect(ids.size).toBe(0);
		});
	});

	describe('collectAllDepIds', () => {
		it('returns empty set when content has no deps', () => {
			const engine = new IdEngine();
			const deps = engine.collectAllDepIds('');
			expect(deps.size).toBe(0);
		});

		it('returns empty set for content with only 🆔 markers', () => {
			const engine = new IdEngine();
			const deps = engine.collectAllDepIds('- [ ] Task 🆔 abc123');
			expect(deps.size).toBe(0);
		});

		it('returns single dep ID from ⛔ marker', () => {
			const engine = new IdEngine();
			const deps = engine.collectAllDepIds('- [ ] Task ⛔ abc123');
			expect(deps).toEqual(new Set(['abc123']));
		});

		it('returns multiple comma-separated dep IDs', () => {
			const engine = new IdEngine();
			const deps = engine.collectAllDepIds('- [ ] Task ⛔ abc123,def456');
			expect(deps).toEqual(new Set(['abc123', 'def456']));
		});

		it('returns deps from multiple lines', () => {
			const engine = new IdEngine();
			const content = [
				'- [ ] Task A ⛔ aaa111',
				'- [ ] Task B ⛔ bbb222',
			].join('\n');
			const deps = engine.collectAllDepIds(content);
			expect(deps).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('handles mixed content (lines with and without deps)', () => {
			const engine = new IdEngine();
			const content = [
				'- [ ] Task A ⛔ aaa111',
				'- [ ] Task B 🆔 bbb222',
				'Some plain text',
				'- [ ] Task C ⛔ ccc333,ddd444',
			].join('\n');
			const deps = engine.collectAllDepIds(content);
			expect(deps).toEqual(new Set(['aaa111', 'ccc333', 'ddd444']));
		});

		it('trims whitespace around comma-separated IDs', () => {
			const engine = new IdEngine();
			const deps = engine.collectAllDepIds('- [ ] Task ⛔ abc123 , def456');
			expect(deps).toEqual(new Set(['abc123', 'def456']));
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
		it('returns an empty set for an empty files array', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([]);
			expect(cache.getIds().size).toBe(0);
		});

		it('collects IDs from a single file', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'note.md', content: '- [ ] Task 🆔 abc123' },
			]);
			expect(cache.getIds()).toEqual(new Set(['abc123']));
		});

		it('collects IDs from multiple files', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task A 🆔 aaa111' },
				{ path: 'b.md', content: '- [ ] Task B 🆔 bbb222\n- [ ] Task C 🆔 ccc333' },
			]);
			expect(cache.getIds()).toEqual(new Set(['aaa111', 'bbb222', 'ccc333']));
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
		it('returns IDs from all files except the excluded one', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
				{ path: 'b.md', content: '- [ ] Task 🆔 bbb222' },
			]);
			const ids = cache.getIdsExcluding('a.md');
			expect(ids).toEqual(new Set(['bbb222']));
		});

		it('returns all IDs when excluded path does not exist', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
			]);
			const ids = cache.getIdsExcluding('nonexistent.md');
			expect(ids).toEqual(new Set(['aaa111']));
		});

		it('returns empty set when only file is excluded', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
			]);
			const ids = cache.getIdsExcluding('a.md');
			expect(ids.size).toBe(0);
		});

		it('returns empty set for empty cache', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([]);
			const ids = cache.getIdsExcluding('a.md');
			expect(ids.size).toBe(0);
		});

		it('combines IDs from multiple non-excluded files', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task 🆔 aaa111' },
				{ path: 'b.md', content: '- [ ] Task 🆔 bbb222' },
				{ path: 'c.md', content: '- [ ] Task 🆔 ccc333' },
			]);
			const ids = cache.getIdsExcluding('b.md');
			expect(ids).toEqual(new Set(['aaa111', 'ccc333']));
		});
	});
});

describe('DepCache', () => {
	describe('buildFromFiles', () => {
		it('populates deps from multiple files', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([
				{ path: 'a.md', content: '- [ ] Task A ⛔ aaa111' },
				{ path: 'b.md', content: '- [ ] Task B ⛔ bbb222\n- [ ] Task C ⛔ ccc333' },
			]);
			expect(cache.getDeps()).toEqual(new Set(['aaa111', 'bbb222', 'ccc333']));
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

		it('returns empty set for empty files array', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromFiles([]);
			expect(cache.getDeps().size).toBe(0);
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
