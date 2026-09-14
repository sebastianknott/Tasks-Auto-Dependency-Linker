import { describe, it, expect, vi } from 'vitest';
import { MetadataSyncCache } from '../../src/cache/metadata-sync-cache';
import type { TaskParser } from '../../src/parsing/task-parser';
import type { TaskMetadataParser, Priority } from '../../src/parsing/task-metadata-parser';
import type { RelationshipAnalyzer } from '../../src/parsing/relationship-analyzer';

function createParserStub(idsByLine: Map<string, string | null>): TaskParser {
	return {
		getTaskId: vi.fn((line: string) => idsByLine.get(line) ?? null),
	} as unknown as TaskParser;
}

function createMetadataParserStub(
	dueByLine: Map<string, string | null>,
	scheduledByLine: Map<string, string | null>,
	priorityByLine: Map<string, Priority | null>,
): TaskMetadataParser {
	return {
		getDueDate: vi.fn((line: string) => dueByLine.get(line) ?? null),
		getScheduledDate: vi.fn((line: string) => scheduledByLine.get(line) ?? null),
		getPriority: vi.fn((line: string) => priorityByLine.get(line) ?? null),
	} as unknown as TaskMetadataParser;
}

function createRelAnalyzerStub(
	relationshipsByContent: Map<string, Map<number, number>>,
): RelationshipAnalyzer {
	return {
		buildRelationshipMap: vi.fn((lines: string[]) =>
			relationshipsByContent.get(lines.join('\n')) ?? new Map<number, number>(),
		),
	} as unknown as RelationshipAnalyzer;
}

function createEmptyCache(): MetadataSyncCache {
	return new MetadataSyncCache(
		createParserStub(new Map()),
		createMetadataParserStub(new Map(), new Map(), new Map()),
		createRelAnalyzerStub(new Map()),
	);
}

describe('MetadataSyncCache', () => {
	describe('get', () => {
		it('returns undefined for an unknown child id', () => {
			const cache = createEmptyCache();
			expect(cache.get('unknown')).toBeUndefined();
		});
	});

	describe('buildFromFiles', () => {
		it("records the parent's value for a field the child already shares", () => {
			const content = 'parent-line\nchild-line';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-line', 'childid']])),
				createMetadataParserStub(
					new Map([
						['parent-line', '2025-01-01'],
						['child-line', 'existing-due'],
					]),
					new Map([
						['parent-line', '2025-02-02'],
						['child-line', 'existing-scheduled'],
					]),
					new Map<string, Priority | null>([
						['parent-line', 'highest'],
						['child-line', 'low'],
					]),
				),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toEqual({
				due: '2025-01-01',
				scheduled: '2025-02-02',
				priority: 'highest',
			});
		});

		it('records null for a field the child does not yet hold, even when the parent has it', () => {
			const content = 'parent-line\nchild-line';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-line', 'childid']])),
				createMetadataParserStub(
					new Map([
						['parent-line', '2025-05-05'],
						['child-line', null],
					]),
					new Map([
						['parent-line', '2025-06-06'],
						['child-line', null],
					]),
					new Map<string, Priority | null>([
						['parent-line', 'medium'],
						['child-line', null],
					]),
				),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toEqual({
				due: null,
				scheduled: null,
				priority: null,
			});
		});

		it('seeds null fields when the parent has no metadata', () => {
			const content = 'parent-line\nchild-line';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-line', 'childid']])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toEqual({
				due: null,
				scheduled: null,
				priority: null,
			});
		});

		it('ignores children that have no id', () => {
			const content = 'parent-line\nchild-line';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-line', null]])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			expect(cache.get('childid')).toBeUndefined();
		});

		it('clears previous entries when rebuilding', () => {
			const contentA = 'parent-a\nchild-a';
			const contentB = 'lonely-line';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-a', 'childid']])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(
					new Map([
						[contentA, new Map([[1, 0]])],
						[contentB, new Map<number, number>()],
					]),
				),
			);
			cache.buildFromFiles([{ path: 'a.md', content: contentA }]);
			cache.buildFromFiles([{ path: 'b.md', content: contentB }]);
			expect(cache.get('childid')).toBeUndefined();
		});

		it('seeds records across multiple files', () => {
			const contentA = 'parent-a\nchild-a';
			const contentB = 'parent-b\nchild-b';
			const cache = new MetadataSyncCache(
				createParserStub(
					new Map([
						['child-a', 'aaa'],
						['child-b', 'bbb'],
					]),
				),
				createMetadataParserStub(
					new Map([
						['parent-a', '2025-01-01'],
						['child-a', 'existing-due'],
					]),
					new Map([
						['parent-b', '2025-03-03'],
						['child-b', 'existing-scheduled'],
					]),
					new Map(),
				),
				createRelAnalyzerStub(
					new Map([
						[contentA, new Map([[1, 0]])],
						[contentB, new Map([[1, 0]])],
					]),
				),
			);
			cache.buildFromFiles([
				{ path: 'a.md', content: contentA },
				{ path: 'b.md', content: contentB },
			]);
			expect(cache.get('aaa')?.due).toBe('2025-01-01');
			expect(cache.get('bbb')?.scheduled).toBe('2025-03-03');
		});
	});

	describe('updateForFile', () => {
		it('reseeds a single file without touching other files', () => {
			const contentA1 = 'parent-a1\nchild-a1';
			const contentA2 = 'parent-a2\nchild-a2';
			const contentB = 'parent-b\nchild-b';
			const cache = new MetadataSyncCache(
				createParserStub(
					new Map([
						['child-a1', 'aaa'],
						['child-a2', 'aaa'],
						['child-b', 'bbb'],
					]),
				),
				createMetadataParserStub(
					new Map([
						['parent-a1', '2025-01-01'],
						['child-a1', 'existing-due'],
						['parent-a2', '2025-09-09'],
						['child-a2', 'existing-due'],
						['parent-b', '2025-02-02'],
						['child-b', 'existing-due'],
					]),
					new Map(),
					new Map(),
				),
				createRelAnalyzerStub(
					new Map([
						[contentA1, new Map([[1, 0]])],
						[contentA2, new Map([[1, 0]])],
						[contentB, new Map([[1, 0]])],
					]),
				),
			);
			cache.buildFromFiles([
				{ path: 'a.md', content: contentA1 },
				{ path: 'b.md', content: contentB },
			]);
			cache.updateForFile('a.md', contentA2);
			expect(cache.get('aaa')?.due).toBe('2025-09-09');
			expect(cache.get('bbb')?.due).toBe('2025-02-02');
		});

		it('prunes a child that is no longer present in the file', () => {
			const contentA1 = 'parent-a1\nchild-a1';
			const contentA2 = 'parent-a2-only';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-a1', 'aaa']])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(
					new Map([
						[contentA1, new Map([[1, 0]])],
						[contentA2, new Map<number, number>()],
					]),
				),
			);
			cache.buildFromFiles([{ path: 'a.md', content: contentA1 }]);
			cache.updateForFile('a.md', contentA2);
			expect(cache.get('aaa')).toBeUndefined();
		});
	});

	describe('set', () => {
		it('records a freshly propagated value for one field', () => {
			const content = 'parent-a\nchild-a';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-a', 'aaa']])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			cache.set('aaa', 'due', '2025-12-12');
			expect(cache.get('aaa')?.due).toBe('2025-12-12');
		});

		it('creates a record when the child id is not yet known', () => {
			const cache = createEmptyCache();
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
			const content = 'parent-a\nchild-a';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-a', 'aaa']])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			cache.pruneFile('a.md');
			expect(cache.get('aaa')).toBeUndefined();
		});

		it('drops descendants under path + "/"', () => {
			const contentA = 'parent-notes-a\nchild-notes-a';
			const contentB = 'parent-notes-sub-b\nchild-notes-sub-b';
			const contentC = 'parent-other\nchild-other';
			const cache = new MetadataSyncCache(
				createParserStub(
					new Map([
						['child-notes-a', 'aaa'],
						['child-notes-sub-b', 'bbb'],
						['child-other', 'ccc'],
					]),
				),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(
					new Map([
						[contentA, new Map([[1, 0]])],
						[contentB, new Map([[1, 0]])],
						[contentC, new Map([[1, 0]])],
					]),
				),
			);
			cache.buildFromFiles([
				{ path: 'notes/a.md', content: contentA },
				{ path: 'notes/sub/b.md', content: contentB },
				{ path: 'other.md', content: contentC },
			]);
			cache.pruneFile('notes');
			expect(cache.get('aaa')).toBeUndefined();
			expect(cache.get('bbb')).toBeUndefined();
			expect(cache.get('ccc')).toBeDefined();
		});

		it('leaves a sibling path with the same prefix but no separator alone', () => {
			const content = 'parent-a\nchild-a';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-a', 'aaa']])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'notes-archive.md', content }]);
			cache.pruneFile('notes');
			expect(cache.get('aaa')).toBeDefined();
		});

		it('is a no-op when the path is not present', () => {
			const content = 'parent-a\nchild-a';
			const cache = new MetadataSyncCache(
				createParserStub(new Map([['child-a', 'aaa']])),
				createMetadataParserStub(new Map(), new Map(), new Map()),
				createRelAnalyzerStub(new Map([[content, new Map([[1, 0]])]])),
			);
			cache.buildFromFiles([{ path: 'a.md', content }]);
			cache.pruneFile('nonexistent.md');
			expect(cache.get('aaa')).toBeDefined();
		});
	});
});
