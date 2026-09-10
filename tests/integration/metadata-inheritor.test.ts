import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataInheritor } from '../../src/metadata-inheritor';
import { TaskParser } from '../../src/task-parser';
import { TaskMetadataParser } from '../../src/task-metadata-parser';
import { RelationshipAnalyzer } from '../../src/relationship-analyzer';
import { MetadataSyncCache } from '../../src/metadata-sync-cache';
import { MarkerAccessorRegistry } from '../../src/marker-accessor';

describe('MetadataInheritor', () => {
	let metadataParser: TaskMetadataParser;
	let syncCache: MetadataSyncCache;
	let registry: MarkerAccessorRegistry;
	let inheritor: MetadataInheritor;

	beforeEach(() => {
		const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);
		metadataParser = new TaskMetadataParser();
		const relAnalyzer = new RelationshipAnalyzer(parser);
		syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
		registry = new MarkerAccessorRegistry(parser, metadataParser);
		inheritor = new MetadataInheritor(registry, syncCache);
	});

	it('fills due, scheduled, and priority on a child that has none', () => {
		const result = inheritor.syncFromParent(
			'abc123',
			'\t- [ ] Child \u{1F194} abc123',
			'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{23EB}',
		);
		expect(result).toContain('\u{1F4C5} 2025-01-01');
		expect(result).toContain('\u{23F3} 2025-02-02');
		expect(result).toContain('\u{23EB}');
	});

	it('inherits nothing when the parent has no metadata', () => {
		const child = '\t- [ ] Child \u{1F194} abc123';
		expect(inheritor.syncFromParent('abc123', child, '- [ ] Parent')).toBe(child);
	});

	it("propagates a field the parent gains after the child was already linked", () => {
		// Regression: the child was indented while the parent had no scheduled
		// date, so its record holds scheduled=null. When the parent later gains
		// a scheduled date, the empty child must receive it.
		syncCache.set('abc123', 'scheduled', null);
		const result = inheritor.syncFromParent(
			'abc123',
			'\t- [ ] Child \u{1F194} abc123',
			'- [ ] Parent \u{23F3} 2025-05-05',
		);
		expect(result).toContain('\u{23F3} 2025-05-05');
	});

	it("does not overwrite a value the user set on the child", () => {
		const child = '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2099-12-31';
		const result = inheritor.syncFromParent(
			'abc123',
			child,
			'- [ ] Parent \u{1F4C5} 2025-01-01',
		);
		expect(result).toContain('2099-12-31');
		expect(result).not.toContain('2025-01-01');
	});

	it("propagates a changed parent value onto a child that held the old value", () => {
		syncCache.set('abc123', 'due', '2025-01-01');
		const result = inheritor.syncFromParent(
			'abc123',
			'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
			'- [ ] Parent \u{1F4C5} 2025-09-09',
		);
		expect(result).toContain('2025-09-09');
		expect(result).not.toContain('2025-01-01');
	});

	it("records the propagated value (once confirmed) so a later unchanged pass is a no-op", () => {
		const child = '\t- [ ] Child \u{1F194} abc123';
		const parent = '- [ ] Parent \u{1F4C5} 2025-09-09';
		const first = inheritor.syncFromParent('abc123', child, parent);
		inheritor.confirmWrite(first);
		// The cache now records 2025-09-09; a second identical pass changes nothing.
		const second = inheritor.syncFromParent('abc123', first, parent);
		expect(second).toBe(first);
		expect(syncCache.get('abc123')?.due).toBe('2025-09-09');
	});

	it("does not re-add a field the child cleared while the parent value is unchanged", () => {
		syncCache.set('abc123', 'due', '2025-01-01');
		const child = '\t- [ ] Child \u{1F194} abc123';
		const result = inheritor.syncFromParent(
			'abc123',
			child,
			'- [ ] Parent \u{1F4C5} 2025-01-01',
		);
		expect(result).toBe(child);
	});

	it("leaves the child untouched when the parent clears its value", () => {
		syncCache.set('abc123', 'due', '2025-01-01');
		const child = '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01';
		expect(inheritor.syncFromParent('abc123', child, '- [ ] Parent')).toBe(child);
	});

	describe('confirmWrite', () => {
		it('does not record anything when syncFromParent is never confirmed', () => {
			const child = '\t- [ ] Child \u{1F194} abc123';
			const parent = '- [ ] Parent \u{1F4C5} 2025-09-09';
			inheritor.syncFromParent('abc123', child, parent);
			// No confirmWrite call: nothing must have been recorded.
			expect(syncCache.get('abc123')?.due ?? null).toBeNull();
		});

		it('proposes the same sync again on the next pass when the prior write was never confirmed', () => {
			// Simulates an arbiter refusal: the proposed line is never
			// actually applied to the document (the caller does not call
			// confirmWrite with a line reflecting the change), so the sync
			// must not be swallowed. The next pass proposes it again.
			const child = '\t- [ ] Child \u{1F194} abc123';
			const parent = '- [ ] Parent \u{1F4C5} 2025-09-09';
			const proposed = inheritor.syncFromParent('abc123', child, parent);
			expect(proposed).toContain('2025-09-09');
			// Arbiter refused the write; the document line stays as `child`.
			const secondPass = inheritor.syncFromParent('abc123', child, parent);
			expect(secondPass).toContain('2025-09-09');
		});

		it('records due when the written line confirms it landed', () => {
			const child = '\t- [ ] Child \u{1F194} abc123';
			const parent = '- [ ] Parent \u{1F4C5} 2025-09-09';
			const proposed = inheritor.syncFromParent('abc123', child, parent);
			inheritor.confirmWrite(proposed);
			expect(syncCache.get('abc123')?.due).toBe('2025-09-09');
		});

		it('records scheduled when the written line confirms it landed', () => {
			const child = '\t- [ ] Child \u{1F194} abc123';
			const parent = '- [ ] Parent \u{23F3} 2025-05-05';
			const proposed = inheritor.syncFromParent('abc123', child, parent);
			inheritor.confirmWrite(proposed);
			expect(syncCache.get('abc123')?.scheduled).toBe('2025-05-05');
		});

		it('records priority when the written line confirms it landed', () => {
			const child = '\t- [ ] Child \u{1F194} abc123';
			const parent = '- [ ] Parent \u{1F53A}';
			const proposed = inheritor.syncFromParent('abc123', child, parent);
			inheritor.confirmWrite(proposed);
			expect(syncCache.get('abc123')?.priority).toBe('highest');
		});

		it('records only the fields that actually landed in the written line (partial landing)', () => {
			const child = '\t- [ ] Child \u{1F194} abc123';
			const parent = '- [ ] Parent \u{1F4C5} 2025-09-09 \u{23EB}';
			const proposed = inheritor.syncFromParent('abc123', child, parent);
			expect(proposed).toContain('2025-09-09');
			expect(proposed).toContain('\u{23EB}');
			// Simulate the arbiter suppressing only the priority marker: the
			// written line keeps the due date but drops the priority change.
			const writtenLine = proposed.replace(/ \u{23EB}/u, '');
			inheritor.confirmWrite(writtenLine);
			expect(syncCache.get('abc123')?.due).toBe('2025-09-09');
			expect(syncCache.get('abc123')?.priority ?? null).toBeNull();
		});

		it('does not leak a pending proposal into a later confirmWrite call when the later pass proposed nothing', () => {
			const child = '\t- [ ] Child \u{1F194} abc123';
			const parent = '- [ ] Parent \u{1F4C5} 2025-09-09';
			const proposed = inheritor.syncFromParent('abc123', child, parent);
			expect(proposed).toContain('2025-09-09');
			// A later pass on an unrelated child proposes nothing (parent has
			// no metadata), so its pending list is empty.
			const unrelatedResult = inheritor.syncFromParent(
				'other456',
				'\t- [ ] Other \u{1F194} other456',
				'- [ ] Unrelated parent',
			);
			// Confirming this second, empty pass must not resurrect and
			// confirm the first child's still-unconfirmed proposal.
			inheritor.confirmWrite(unrelatedResult);
			expect(syncCache.get('abc123')?.due ?? null).toBeNull();
		});
	});

	describe('REGRESSION (C3): fragmentary child marker blocks inheritance for that field', () => {
		it('leaves a fragmentary due-date marker on the child completely alone', () => {
			// Post-autosave-reseed state: the sync cache holds nothing for
			// this child's due field (lastSynced is null), exactly as
			// MetadataSyncCache.seedFile leaves it after the user's
			// half-typed date failed to parse. Before the fix this
			// produced a duplicate \u{1F4C5} because setDueDate appends
			// when the line's own glyph does not parse.
			const child = '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2026-0';
			const result = inheritor.syncFromParent(
				'abc123',
				child,
				'- [ ] Parent \u{1F4C5} 2026-01-15',
			);
			expect(result).toBe(child);
			expect((result.match(/\u{1F4C5}/gu) ?? []).length).toBe(1);
		});

		it('leaves a fragmentary scheduled-date marker on the child completely alone', () => {
			const child = '\t- [ ] Child \u{1F194} abc123 \u{23F3} 2026-0';
			const result = inheritor.syncFromParent(
				'abc123',
				child,
				'- [ ] Parent \u{23F3} 2026-02-20',
			);
			expect(result).toBe(child);
			expect((result.match(/\u{23F3}/gu) ?? []).length).toBe(1);
		});

		it('queues nothing for a field that was skipped because of a fragment', () => {
			const child = '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2026-0';
			const result = inheritor.syncFromParent(
				'abc123',
				child,
				'- [ ] Parent \u{1F4C5} 2026-01-15',
			);
			inheritor.confirmWrite(result);
			expect(syncCache.get('abc123')?.due ?? null).toBeNull();
		});

		it('does not let a fragment in one field block inheritance of another field', () => {
			const child = '\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2026-0';
			const parent = '- [ ] Parent \u{1F4C5} 2026-01-15 \u{23F3} 2026-02-20';
			const result = inheritor.syncFromParent('abc123', child, parent);
			expect(result).toContain('\u{23F3} 2026-02-20');
			expect(result).toContain('\u{1F4C5} 2026-0');
			expect(result).not.toContain('2026-01-15');
		});

		it('leaves priority inheritance unaffected, since a priority glyph never fragments', () => {
			const child = '\t- [ ] Child \u{1F194} abc123 \u{1F53D}';
			const parent = '- [ ] Parent \u{1F53A}';
			const result = inheritor.syncFromParent('abc123', child, parent);
			// Existing override rule: the child already holds an explicit,
			// non-inherited value, so the parent's priority is not applied.
			expect(result).toBe(child);
		});

		it('REGRESSION GUARD: a child with no due-date marker at all still inherits the parent due date', () => {
			const child = '\t- [ ] Child \u{1F194} abc123';
			const result = inheritor.syncFromParent(
				'abc123',
				child,
				'- [ ] Parent \u{1F4C5} 2026-01-15',
			);
			expect(result).toContain('\u{1F4C5} 2026-01-15');
		});

		it('REGRESSION GUARD: a child still holding the previously inherited due date follows a later parent change', () => {
			syncCache.set('abc123', 'due', '2025-01-01');
			const result = inheritor.syncFromParent(
				'abc123',
				'\t- [ ] Child \u{1F194} abc123 \u{1F4C5} 2025-01-01',
				'- [ ] Parent \u{1F4C5} 2025-09-09',
			);
			expect(result).toContain('2025-09-09');
			expect(result).not.toContain('2025-01-01');
		});
	});
});
