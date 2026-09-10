import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataSyncCache } from '../../src/metadata-sync-cache';
import { TaskParser } from '../../src/task-parser';
import { TaskMetadataParser } from '../../src/task-metadata-parser';
import { RelationshipAnalyzer } from '../../src/relationship-analyzer';

describe('MetadataSyncCache', () => {
	let cache: MetadataSyncCache;

	beforeEach(() => {
		const parser = new TaskParser();
		const metadataParser = new TaskMetadataParser();
		const relAnalyzer = new RelationshipAnalyzer(parser);
		cache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
	});

	describe('get', () => {
		it('returns undefined for an unknown child id', () => {
			expect(cache.get('unknown')).toBeUndefined();
		});
	});

	describe('buildFromFiles', () => {
		it("records the parent's value for a field the child already shares", () => {
			const content = [
				'- [ ] Parent \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{1F53A}',
				'\t- [ ] Child \u{1F194} childid \u{1F4C5} 2025-01-01 \u{23F3} 2025-02-02 \u{1F53A}',
			].join('\n');
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toEqual({
				due: '2025-01-01',
				scheduled: '2025-02-02',
				priority: 'highest',
			});
		});

		it("records null for a field the child does not yet hold, even when the parent has it", () => {
			// Regression: a child indented under a parent that had no metadata
			// must keep a null last-synced value so a metadata the parent gains
			// LATER still propagates. Seeding the parent's value here would make
			// the inheritor believe the child already received it.
			const content = [
				'- [ ] Parent \u{23F3} 2025-02-02',
				'\t- [ ] Child \u{1F194} childid',
			].join('\n');
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toEqual({
				due: null,
				scheduled: null,
				priority: null,
			});
		});

		it('seeds null fields when the parent has no metadata', () => {
			const content = ['- [ ] Parent', '\t- [ ] Child \u{1F194} childid'].join(
				'\n',
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toEqual({
				due: null,
				scheduled: null,
				priority: null,
			});
		});

		it('ignores children that have no id', () => {
			const content = ['- [ ] Parent \u{1F4C5} 2025-01-01', '\t- [ ] Child'].join(
				'\n',
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toBeUndefined();
		});

		it('clears previous entries when rebuilding', () => {
			cache.buildFromFiles([
				{
					path: 'a.md',
					content: '- [ ] Parent \u{1F4C5} 2025-01-01\n\t- [ ] Child \u{1F194} childid',
				},
			]);
			cache.buildFromFiles([{ path: 'b.md', content: '- [ ] Lonely' }]);
			expect(cache.get('childid')).toBeUndefined();
		});

		it('seeds records across multiple files', () => {
			cache.buildFromFiles([
				{
					path: 'a.md',
					content:
						'- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa \u{1F4C5} 2025-01-01',
				},
				{
					path: 'b.md',
					content:
						'- [ ] P \u{23F3} 2025-03-03\n\t- [ ] C \u{1F194} bbb \u{23F3} 2025-03-03',
				},
			]);
			expect(cache.get('aaa')?.due).toBe('2025-01-01');
			expect(cache.get('bbb')?.scheduled).toBe('2025-03-03');
		});
	});

	describe('updateForFile', () => {
		it('reseeds a single file without touching other files', () => {
			cache.buildFromFiles([
				{
					path: 'a.md',
					content:
						'- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa \u{1F4C5} 2025-01-01',
				},
				{
					path: 'b.md',
					content:
						'- [ ] P \u{1F4C5} 2025-02-02\n\t- [ ] C \u{1F194} bbb \u{1F4C5} 2025-02-02',
				},
			]);
			cache.updateForFile(
				'a.md',
				'- [ ] P \u{1F4C5} 2025-09-09\n\t- [ ] C \u{1F194} aaa \u{1F4C5} 2025-09-09',
			);
			expect(cache.get('aaa')?.due).toBe('2025-09-09');
			expect(cache.get('bbb')?.due).toBe('2025-02-02');
		});

		it('prunes a child that is no longer present in the file', () => {
			cache.buildFromFiles([
				{
					path: 'a.md',
					content: '- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa',
				},
			]);
			cache.updateForFile('a.md', '- [ ] P \u{1F4C5} 2025-01-01');
			expect(cache.get('aaa')).toBeUndefined();
		});
	});

	describe('set', () => {
		it('records a freshly propagated value for one field', () => {
			cache.buildFromFiles([
				{
					path: 'a.md',
					content: '- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa',
				},
			]);
			cache.set('aaa', 'due', '2025-12-12');
			expect(cache.get('aaa')?.due).toBe('2025-12-12');
		});

		it('creates a record when the child id is not yet known', () => {
			cache.set('fresh', 'priority', 'low');
			expect(cache.get('fresh')).toEqual({
				due: null,
				scheduled: null,
				priority: 'low',
			});
		});
	});

	describe('pruneFile', () => {
		it('drops the exact path', () => {
			cache.buildFromFiles([
				{
					path: 'a.md',
					content: '- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa',
				},
			]);
			cache.pruneFile('a.md');
			expect(cache.get('aaa')).toBeUndefined();
		});

		it('drops descendants under path + "/"', () => {
			cache.buildFromFiles([
				{
					path: 'notes/a.md',
					content: '- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa',
				},
				{
					path: 'notes/sub/b.md',
					content: '- [ ] P \u{1F4C5} 2025-02-02\n\t- [ ] C \u{1F194} bbb',
				},
				{
					path: 'other.md',
					content: '- [ ] P \u{1F4C5} 2025-03-03\n\t- [ ] C \u{1F194} ccc',
				},
			]);
			cache.pruneFile('notes');
			expect(cache.get('aaa')).toBeUndefined();
			expect(cache.get('bbb')).toBeUndefined();
			expect(cache.get('ccc')).toBeDefined();
		});

		it('leaves a sibling path with the same prefix but no separator alone', () => {
			cache.buildFromFiles([
				{
					path: 'notes-archive.md',
					content: '- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa',
				},
			]);
			cache.pruneFile('notes');
			expect(cache.get('aaa')).toBeDefined();
		});

		it('is a no-op when the path is not present', () => {
			cache.buildFromFiles([
				{
					path: 'a.md',
					content: '- [ ] P \u{1F4C5} 2025-01-01\n\t- [ ] C \u{1F194} aaa',
				},
			]);
			cache.pruneFile('nonexistent.md');
			expect(cache.get('aaa')).toBeDefined();
		});
	});
});
