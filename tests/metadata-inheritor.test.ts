import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataInheritor } from '../src/metadata-inheritor';
import { TaskParser } from '../src/task-parser';
import { TaskMetadataParser } from '../src/task-metadata-parser';
import { RelationshipAnalyzer } from '../src/relationship-analyzer';
import { MetadataSyncCache } from '../src/metadata-sync-cache';

describe('MetadataInheritor', () => {
	let metadataParser: TaskMetadataParser;
	let syncCache: MetadataSyncCache;
	let inheritor: MetadataInheritor;

	beforeEach(() => {
		const parser = new TaskParser(TaskParser.DEFAULT_CONFIG);
		metadataParser = new TaskMetadataParser();
		const relAnalyzer = new RelationshipAnalyzer(parser);
		syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
		inheritor = new MetadataInheritor(metadataParser, syncCache);
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

	it("records the propagated value so a later unchanged pass is a no-op", () => {
		const child = '\t- [ ] Child \u{1F194} abc123';
		const parent = '- [ ] Parent \u{1F4C5} 2025-09-09';
		const first = inheritor.syncFromParent('abc123', child, parent);
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
});
