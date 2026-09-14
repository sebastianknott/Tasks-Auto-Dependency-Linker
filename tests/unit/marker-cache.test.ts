import { describe, it, expect, vi } from 'vitest';
import { MarkerCache, IdCache, DepCache } from '../../src/cache/marker-cache';
import type { FileEntry } from '../../src/types';

type ScannerStub = {
	collectAllIds: ReturnType<typeof vi.fn>;
	collectAllDepIds: ReturnType<typeof vi.fn>;
};

function createScanner(): ScannerStub {
	return {
		collectAllIds: vi.fn(),
		collectAllDepIds: vi.fn(),
	};
}

/**
 * Concrete subclass for testing the abstract MarkerCache.
 *
 * Uses a trivial extractor: splits comma-separated tokens from content.
 * This keeps the MarkerCache tests independent of the scanner methods.
 */
class TestMarkerCache extends MarkerCache {
	protected extract(content: string): Set<string> {
		const tokens = new Set<string>();
		for (const token of content.split(',')) {
			const trimmed = token.trim();
			if (trimmed) {
				tokens.add(trimmed);
			}
		}
		return tokens;
	}
}

describe('MarkerCache', () => {
	function createCache(): TestMarkerCache {
		return new TestMarkerCache(createScanner());
	}

	describe('buildFromFiles', () => {
		it.each<[string, FileEntry[], Set<string>]>([
			[
				'returns an empty set for an empty files array',
				[],
				new Set(),
			],
			[
				'collects entries from a single file',
				[{ path: 'a.md', content: 'foo,bar' }],
				new Set(['foo', 'bar']),
			],
			[
				'collects entries from multiple files',
				[
					{ path: 'a.md', content: 'aaa' },
					{ path: 'b.md', content: 'bbb,ccc' },
				],
				new Set(['aaa', 'bbb', 'ccc']),
			],
		])('%s', (_name, files, expected) => {
			const cache = createCache();
			cache.buildFromFiles(files);
			expect(cache.getAll()).toEqual(expected);
		});

		it('clears previous entries before rebuilding', () => {
			const cache = createCache();
			cache.buildFromFiles([{ path: 'old.md', content: 'old' }]);
			cache.buildFromFiles([{ path: 'new.md', content: 'new' }]);
			expect(cache.getAll()).toEqual(new Set(['new']));
			expect(cache.getAll().has('old')).toBe(false);
		});
	});

	describe('updateForFile', () => {
		it('adds new entries from a file', () => {
			const cache = createCache();
			cache.buildFromFiles([{ path: 'a.md', content: 'aaa' }]);
			cache.updateForFile('b.md', 'bbb');
			expect(cache.getAll()).toEqual(new Set(['aaa', 'bbb']));
		});

		it('removes stale entries when file content changes', () => {
			const cache = createCache();
			cache.buildFromFiles([
				{ path: 'a.md', content: 'aaa' },
				{ path: 'b.md', content: 'bbb' },
			]);
			cache.updateForFile('b.md', 'ccc');
			expect(cache.getAll()).toEqual(new Set(['aaa', 'ccc']));
			expect(cache.getAll().has('bbb')).toBe(false);
		});

		it('removes all entries for a file when new content is empty', () => {
			const cache = createCache();
			cache.buildFromFiles([
				{ path: 'a.md', content: 'aaa' },
				{ path: 'b.md', content: 'bbb' },
			]);
			cache.updateForFile('b.md', '');
			expect(cache.getAll()).toEqual(new Set(['aaa']));
		});

		it('does not affect entries from other files', () => {
			const cache = createCache();
			cache.buildFromFiles([
				{ path: 'a.md', content: 'aaa' },
				{ path: 'b.md', content: 'bbb' },
			]);
			cache.updateForFile('b.md', 'ccc');
			expect(cache.getAll().has('aaa')).toBe(true);
		});

		it('works for a new file not seen in buildFromFiles', () => {
			const cache = createCache();
			cache.buildFromFiles([]);
			cache.updateForFile('new.md', 'xxx');
			expect(cache.getAll()).toEqual(new Set(['xxx']));
		});
	});

	describe('getAll', () => {
		it('returns a consistent set across calls', () => {
			const cache = createCache();
			cache.buildFromFiles([{ path: 'a.md', content: 'aaa' }]);
			expect(cache.getAll()).toEqual(cache.getAll());
		});
	});

	describe('getAllExcluding', () => {
		it.each<[string, FileEntry[], string, Set<string>]>([
			[
				'returns entries from all files except the excluded one',
				[
					{ path: 'a.md', content: 'aaa' },
					{ path: 'b.md', content: 'bbb' },
				],
				'a.md',
				new Set(['bbb']),
			],
			[
				'returns all entries when excluded path does not exist',
				[{ path: 'a.md', content: 'aaa' }],
				'nonexistent.md',
				new Set(['aaa']),
			],
			[
				'returns empty set when only file is excluded',
				[{ path: 'a.md', content: 'aaa' }],
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
				'combines entries from multiple non-excluded files',
				[
					{ path: 'a.md', content: 'aaa' },
					{ path: 'b.md', content: 'bbb' },
					{ path: 'c.md', content: 'ccc' },
				],
				'b.md',
				new Set(['aaa', 'ccc']),
			],
		])('%s', (_name, files, excludePath, expected) => {
			const cache = createCache();
			cache.buildFromFiles(files);
			expect(cache.getAllExcluding(excludePath)).toEqual(expected);
		});
	});

	describe('pruneFile', () => {
		it('drops the exact path', () => {
			const cache = createCache();
			cache.buildFromFiles([
				{ path: 'a.md', content: 'aaa' },
				{ path: 'b.md', content: 'bbb' },
			]);
			cache.pruneFile('a.md');
			expect(cache.getAll()).toEqual(new Set(['bbb']));
		});

		it('drops descendants under path + "/"', () => {
			const cache = createCache();
			cache.buildFromFiles([
				{ path: 'notes/a.md', content: 'aaa' },
				{ path: 'notes/sub/b.md', content: 'bbb' },
				{ path: 'other.md', content: 'ccc' },
			]);
			cache.pruneFile('notes');
			expect(cache.getAll()).toEqual(new Set(['ccc']));
		});

		it('leaves a sibling path with the same prefix but no separator alone', () => {
			const cache = createCache();
			cache.buildFromFiles([
				{ path: 'notes-archive.md', content: 'aaa' },
			]);
			cache.pruneFile('notes');
			expect(cache.getAll()).toEqual(new Set(['aaa']));
		});

		it('is a no-op when the path is not present', () => {
			const cache = createCache();
			cache.buildFromFiles([{ path: 'a.md', content: 'aaa' }]);
			cache.pruneFile('nonexistent.md');
			expect(cache.getAll()).toEqual(new Set(['aaa']));
		});

		it('does not affect entries from unrelated files', () => {
			const cache = createCache();
			cache.buildFromFiles([
				{ path: 'notes/a.md', content: 'aaa' },
				{ path: 'b.md', content: 'bbb' },
			]);
			cache.pruneFile('notes');
			expect(cache.getAll().has('bbb')).toBe(true);
		});
	});
});

describe('IdCache', () => {
	function createCache(scanner: ScannerStub): IdCache {
		return new IdCache(scanner);
	}

	describe('buildFromFiles', () => {
		it.each<[string, FileEntry[], Set<string>[], Set<string>]>([
			[
				'returns an empty set for an empty files array',
				[],
				[],
				new Set(),
			],
			[
				'collects IDs from a single file',
				[{ path: 'note.md', content: 'irrelevant' }],
				[new Set(['abc123'])],
				new Set(['abc123']),
			],
			[
				'collects IDs from multiple files',
				[
					{ path: 'a.md', content: 'irrelevant-a' },
					{ path: 'b.md', content: 'irrelevant-b' },
				],
				[new Set(['aaa111']), new Set(['bbb222', 'ccc333'])],
				new Set(['aaa111', 'bbb222', 'ccc333']),
			],
		])('%s', (_name, files, scannerReturns, expected) => {
			const scanner = createScanner();
			for (const returned of scannerReturns) {
				scanner.collectAllIds.mockReturnValueOnce(returned);
			}
			const cache = createCache(scanner);
			cache.buildFromFiles(files);
			expect(cache.getAll()).toEqual(expected);
		});

		it('clears previous IDs before rebuilding', () => {
			const scanner = createScanner();
			scanner.collectAllIds
				.mockReturnValueOnce(new Set(['old111']))
				.mockReturnValueOnce(new Set(['new222']));
			const cache = createCache(scanner);
			cache.buildFromFiles([{ path: 'old.md', content: 'irrelevant' }]);
			cache.buildFromFiles([{ path: 'new.md', content: 'irrelevant' }]);
			expect(cache.getAll()).toEqual(new Set(['new222']));
			expect(cache.getAll().has('old111')).toBe(false);
		});
	});

	describe('updateForFile', () => {
		it('adds new IDs from a file', () => {
			const scanner = createScanner();
			scanner.collectAllIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']));
			const cache = createCache(scanner);
			cache.buildFromFiles([{ path: 'a.md', content: 'irrelevant' }]);
			cache.updateForFile('b.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('removes stale IDs when file content changes', () => {
			const scanner = createScanner();
			scanner.collectAllIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']))
				.mockReturnValueOnce(new Set(['ccc333']));
			const cache = createCache(scanner);
			cache.buildFromFiles([
				{ path: 'a.md', content: 'irrelevant' },
				{ path: 'b.md', content: 'irrelevant' },
			]);
			// File b.md changed: bbb222 was removed, ccc333 was added
			cache.updateForFile('b.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['aaa111', 'ccc333']));
			expect(cache.getAll().has('bbb222')).toBe(false);
		});

		it('removes all IDs for a file when new content has none', () => {
			const scanner = createScanner();
			scanner.collectAllIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']))
				.mockReturnValueOnce(new Set());
			const cache = createCache(scanner);
			cache.buildFromFiles([
				{ path: 'a.md', content: 'irrelevant' },
				{ path: 'b.md', content: 'irrelevant' },
			]);
			cache.updateForFile('b.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['aaa111']));
		});

		it('does not affect IDs from other files', () => {
			const scanner = createScanner();
			scanner.collectAllIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']))
				.mockReturnValueOnce(new Set(['ccc333']));
			const cache = createCache(scanner);
			cache.buildFromFiles([
				{ path: 'a.md', content: 'irrelevant' },
				{ path: 'b.md', content: 'irrelevant' },
			]);
			cache.updateForFile('b.md', 'irrelevant');
			// a.md's ID should be untouched
			expect(cache.getAll().has('aaa111')).toBe(true);
		});

		it('works for a new file not seen in buildFromFiles', () => {
			const scanner = createScanner();
			scanner.collectAllIds.mockReturnValueOnce(new Set(['abc123']));
			const cache = createCache(scanner);
			cache.buildFromFiles([]);
			cache.updateForFile('new.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['abc123']));
		});
	});

	describe('getAll', () => {
		it('returns a consistent set across calls', () => {
			const scanner = createScanner();
			scanner.collectAllIds.mockReturnValueOnce(new Set(['abc123']));
			const cache = createCache(scanner);
			cache.buildFromFiles([{ path: 'a.md', content: 'irrelevant' }]);
			const ids1 = cache.getAll();
			const ids2 = cache.getAll();
			expect(ids1).toEqual(ids2);
		});
	});

	describe('getAllExcluding', () => {
		it.each<[string, FileEntry[], Set<string>[], string, Set<string>]>([
			[
				'returns IDs from all files except the excluded one',
				[
					{ path: 'a.md', content: 'irrelevant-a' },
					{ path: 'b.md', content: 'irrelevant-b' },
				],
				[new Set(['aaa111']), new Set(['bbb222'])],
				'a.md',
				new Set(['bbb222']),
			],
			[
				'returns all IDs when excluded path does not exist',
				[{ path: 'a.md', content: 'irrelevant' }],
				[new Set(['aaa111'])],
				'nonexistent.md',
				new Set(['aaa111']),
			],
			[
				'returns empty set when only file is excluded',
				[{ path: 'a.md', content: 'irrelevant' }],
				[new Set(['aaa111'])],
				'a.md',
				new Set(),
			],
			[
				'returns empty set for empty cache',
				[],
				[],
				'a.md',
				new Set(),
			],
			[
				'combines IDs from multiple non-excluded files',
				[
					{ path: 'a.md', content: 'irrelevant-a' },
					{ path: 'b.md', content: 'irrelevant-b' },
					{ path: 'c.md', content: 'irrelevant-c' },
				],
				[new Set(['aaa111']), new Set(['bbb222']), new Set(['ccc333'])],
				'b.md',
				new Set(['aaa111', 'ccc333']),
			],
		])('%s', (_name, files, scannerReturns, excludePath, expected) => {
			const scanner = createScanner();
			for (const returned of scannerReturns) {
				scanner.collectAllIds.mockReturnValueOnce(returned);
			}
			const cache = createCache(scanner);
			cache.buildFromFiles(files);
			const ids = cache.getAllExcluding(excludePath);
			expect(ids).toEqual(expected);
		});
	});
});

describe('DepCache', () => {
	function createCache(scanner: ScannerStub): DepCache {
		return new DepCache(scanner);
	}

	describe('buildFromFiles', () => {
		it.each<[string, FileEntry[], Set<string>[], Set<string>]>([
			[
				'populates deps from multiple files',
				[
					{ path: 'a.md', content: 'irrelevant-a' },
					{ path: 'b.md', content: 'irrelevant-b' },
				],
				[new Set(['aaa111']), new Set(['bbb222', 'ccc333'])],
				new Set(['aaa111', 'bbb222', 'ccc333']),
			],
			[
				'returns empty set for empty files array',
				[],
				[],
				new Set(),
			],
		])('%s', (_name, files, scannerReturns, expected) => {
			const scanner = createScanner();
			for (const returned of scannerReturns) {
				scanner.collectAllDepIds.mockReturnValueOnce(returned);
			}
			const cache = createCache(scanner);
			cache.buildFromFiles(files);
			expect(cache.getAll()).toEqual(expected);
		});

		it('clears previous deps before rebuilding', () => {
			const scanner = createScanner();
			scanner.collectAllDepIds
				.mockReturnValueOnce(new Set(['old111']))
				.mockReturnValueOnce(new Set(['new222']));
			const cache = createCache(scanner);
			cache.buildFromFiles([{ path: 'old.md', content: 'irrelevant' }]);
			cache.buildFromFiles([{ path: 'new.md', content: 'irrelevant' }]);
			expect(cache.getAll()).toEqual(new Set(['new222']));
			expect(cache.getAll().has('old111')).toBe(false);
		});
	});

	describe('updateForFile', () => {
		it('adds new deps from a file', () => {
			const scanner = createScanner();
			scanner.collectAllDepIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']));
			const cache = createCache(scanner);
			cache.buildFromFiles([{ path: 'a.md', content: 'irrelevant' }]);
			cache.updateForFile('b.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['aaa111', 'bbb222']));
		});

		it('removes stale deps when file content changes', () => {
			const scanner = createScanner();
			scanner.collectAllDepIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']))
				.mockReturnValueOnce(new Set(['ccc333']));
			const cache = createCache(scanner);
			cache.buildFromFiles([
				{ path: 'a.md', content: 'irrelevant' },
				{ path: 'b.md', content: 'irrelevant' },
			]);
			// File b.md changed: bbb222 was removed, ccc333 was added
			cache.updateForFile('b.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['aaa111', 'ccc333']));
			expect(cache.getAll().has('bbb222')).toBe(false);
		});

		it('removes all deps for a file when new content has none', () => {
			const scanner = createScanner();
			scanner.collectAllDepIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']))
				.mockReturnValueOnce(new Set());
			const cache = createCache(scanner);
			cache.buildFromFiles([
				{ path: 'a.md', content: 'irrelevant' },
				{ path: 'b.md', content: 'irrelevant' },
			]);
			cache.updateForFile('b.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['aaa111']));
		});

		it('does not affect deps from other files', () => {
			const scanner = createScanner();
			scanner.collectAllDepIds
				.mockReturnValueOnce(new Set(['aaa111']))
				.mockReturnValueOnce(new Set(['bbb222']))
				.mockReturnValueOnce(new Set(['ccc333']));
			const cache = createCache(scanner);
			cache.buildFromFiles([
				{ path: 'a.md', content: 'irrelevant' },
				{ path: 'b.md', content: 'irrelevant' },
			]);
			cache.updateForFile('b.md', 'irrelevant');
			expect(cache.getAll().has('aaa111')).toBe(true);
		});

		it('works for a new file not seen in buildFromFiles', () => {
			const scanner = createScanner();
			scanner.collectAllDepIds.mockReturnValueOnce(new Set(['abc123']));
			const cache = createCache(scanner);
			cache.buildFromFiles([]);
			cache.updateForFile('new.md', 'irrelevant');
			expect(cache.getAll()).toEqual(new Set(['abc123']));
		});
	});

	describe('getAll', () => {
		it('returns a consistent set across calls', () => {
			const scanner = createScanner();
			scanner.collectAllDepIds.mockReturnValueOnce(new Set(['abc123']));
			const cache = createCache(scanner);
			cache.buildFromFiles([{ path: 'a.md', content: 'irrelevant' }]);
			const deps1 = cache.getAll();
			const deps2 = cache.getAll();
			expect(deps1).toEqual(deps2);
		});
	});
});
