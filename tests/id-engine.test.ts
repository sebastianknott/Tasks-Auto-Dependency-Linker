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
	describe('buildFromContents', () => {
		it('returns an empty set for an empty contents array', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromContents([]);
			expect(cache.getIds().size).toBe(0);
		});

		it('collects IDs from a single file content', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromContents(['- [ ] Task \u{1F194} abc123']);
			expect(cache.getIds()).toEqual(new Set(['abc123']));
		});

		it('collects IDs from multiple file contents', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromContents([
				'- [ ] Task A \u{1F194} aaa111',
				'- [ ] Task B \u{1F194} bbb222\n- [ ] Task C \u{1F194} ccc333',
			]);
			expect(cache.getIds()).toEqual(new Set(['aaa111', 'bbb222', 'ccc333']));
		});

		it('clears previous IDs before rebuilding', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromContents(['- [ ] Task \u{1F194} old111']);
			cache.buildFromContents(['- [ ] Task \u{1F194} new222']);
			expect(cache.getIds()).toEqual(new Set(['new222']));
			expect(cache.getIds().has('old111')).toBe(false);
		});
	});

	describe('updateFromContent', () => {
		it('adds new IDs to the existing cache', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromContents(['- [ ] Task \u{1F194} aaa111']);
			cache.updateFromContent('- [ ] Task \u{1F194} bbb222');
			expect(cache.getIds()).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('does nothing for content without IDs', () => {
			const cache = new IdCache(new IdEngine());
			cache.buildFromContents(['- [ ] Task \u{1F194} aaa111']);
			cache.updateFromContent('- [ ] No ID here');
			expect(cache.getIds()).toEqual(new Set(['aaa111']));
		});

		it('works on an empty cache', () => {
			const cache = new IdCache(new IdEngine());
			cache.updateFromContent('- [ ] Task \u{1F194} abc123');
			expect(cache.getIds()).toEqual(new Set(['abc123']));
		});
	});

	describe('getIds', () => {
		it('returns the internal set (same reference)', () => {
			const cache = new IdCache(new IdEngine());
			const ids1 = cache.getIds();
			const ids2 = cache.getIds();
			expect(ids1).toBe(ids2);
		});
	});
});

describe('DepCache', () => {
	describe('buildFromContents', () => {
		it('populates deps from multiple files', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromContents([
				'- [ ] Task A ⛔ aaa111',
				'- [ ] Task B ⛔ bbb222\n- [ ] Task C ⛔ ccc333',
			]);
			expect(cache.getDeps()).toEqual(new Set(['aaa111', 'bbb222', 'ccc333']));
		});

		it('clears previous deps before rebuilding', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromContents(['- [ ] Task ⛔ old111']);
			cache.buildFromContents(['- [ ] Task ⛔ new222']);
			expect(cache.getDeps()).toEqual(new Set(['new222']));
			expect(cache.getDeps().has('old111')).toBe(false);
		});

		it('returns empty set for empty contents array', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromContents([]);
			expect(cache.getDeps().size).toBe(0);
		});
	});

	describe('updateFromContent', () => {
		it('adds new deps to the existing cache', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromContents(['- [ ] Task ⛔ aaa111']);
			cache.updateFromContent('- [ ] Task ⛔ bbb222');
			expect(cache.getDeps()).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('does nothing for content without deps', () => {
			const cache = new DepCache(new IdEngine());
			cache.buildFromContents(['- [ ] Task ⛔ aaa111']);
			cache.updateFromContent('- [ ] No deps here');
			expect(cache.getDeps()).toEqual(new Set(['aaa111']));
		});

		it('works on an empty cache', () => {
			const cache = new DepCache(new IdEngine());
			cache.updateFromContent('- [ ] Task ⛔ abc123');
			expect(cache.getDeps()).toEqual(new Set(['abc123']));
		});
	});

	describe('getDeps', () => {
		it('returns the internal set (same reference)', () => {
			const cache = new DepCache(new IdEngine());
			const deps1 = cache.getDeps();
			const deps2 = cache.getDeps();
			expect(deps1).toBe(deps2);
		});
	});
});
