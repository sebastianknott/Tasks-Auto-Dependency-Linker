import { describe, it, expect, vi } from 'vitest';
import { IdGenerator } from '../../src/linking/id-generator';

describe('IdGenerator', () => {
	describe('generateId', () => {
		it('returns a 6-character string', () => {
			const engine = new IdGenerator();
			const id = engine.generateId();
			expect(id).toHaveLength(6);
		});

		it('contains only lowercase alphanumeric characters', () => {
			const engine = new IdGenerator();
			const id = engine.generateId();
			expect(id).toMatch(/^[a-z0-9]{6}$/);
		});

		it('produces different IDs on successive calls', () => {
			const engine = new IdGenerator();
			const ids = new Set<string>();
			for (let i = 0; i < 50; i++) {
				ids.add(engine.generateId());
			}
			// With 2.18 billion combinations, 50 IDs should all be unique
			expect(ids.size).toBe(50);
		});
	});

	describe('generateUniqueId', () => {
		it('returns an ID not present in the existing set', () => {
			const engine = new IdGenerator();
			const existing = new Set(['abc123', 'def456']);
			const id = engine.generateUniqueId(existing);
			expect(id).toHaveLength(6);
			expect(existing.has(id)).toBe(false);
		});

		it('returns a valid 6-char lowercase alphanumeric ID', () => {
			const engine = new IdGenerator();
			const id = engine.generateUniqueId(new Set());
			expect(id).toMatch(/^[a-z0-9]{6}$/);
		});

		it('avoids collisions with a large existing set', () => {
			const engine = new IdGenerator();
			const existing = new Set<string>();
			// Pre-fill with 100 IDs
			for (let i = 0; i < 100; i++) {
				existing.add(engine.generateId());
			}
			const newId = engine.generateUniqueId(existing);
			expect(existing.has(newId)).toBe(false);
		});

		it('retries when the first generated ID collides', () => {
			const engine = new IdGenerator();
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
