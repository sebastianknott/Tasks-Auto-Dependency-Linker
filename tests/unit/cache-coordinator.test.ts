import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheCoordinator } from '../../src/cache/cache-coordinator';
import type { VaultReader } from '../../src/cache/cache-coordinator';
import type { IdCache, DepCache } from '../../src/cache/marker-cache';
import type { MetadataSyncCache } from '../../src/cache/metadata-sync-cache';
import { TFile, TFolder } from 'obsidian';

type MarkerCacheStub = {
	buildFromFiles: ReturnType<typeof vi.fn>;
	updateForFile: ReturnType<typeof vi.fn>;
	pruneFile: ReturnType<typeof vi.fn>;
};

type SyncCacheStub = MarkerCacheStub;

function markerCacheStub(): MarkerCacheStub {
	return {
		buildFromFiles: vi.fn(),
		updateForFile: vi.fn(),
		pruneFile: vi.fn(),
	};
}

describe('CacheCoordinator', () => {
	let idCache: MarkerCacheStub;
	let depCache: MarkerCacheStub;
	let syncCache: SyncCacheStub;
	let contents: Map<string, string>;
	let markdownFiles: TFile[];
	let cachedRead: ReturnType<typeof vi.fn>;
	let getMarkdownFiles: ReturnType<typeof vi.fn>;
	let coordinator: CacheCoordinator;

	function makeFile(path: string): TFile {
		const file = new TFile();
		file.path = path;
		return file;
	}

	function makeFolder(path: string): TFolder {
		const folder = new TFolder();
		folder.path = path;
		return folder;
	}

	beforeEach(() => {
		idCache = markerCacheStub();
		depCache = markerCacheStub();
		syncCache = markerCacheStub();
		contents = new Map();
		markdownFiles = [];
		// The stub answers from an explicit per-test map rather than
		// reimplementing a vault, so a test states exactly what the
		// coordinator sees on disk.
		cachedRead = vi.fn((file: TFile) => Promise.resolve(contents.get(file.path) ?? ''));
		getMarkdownFiles = vi.fn(() => markdownFiles);
		const vault: VaultReader = { cachedRead, getMarkdownFiles };
		coordinator = new CacheCoordinator(
			idCache as unknown as IdCache,
			depCache as unknown as DepCache,
			syncCache as unknown as MetadataSyncCache,
			vault,
		);
	});

	describe('buildAll', () => {
		it('reads every file and hands the same entry list to all three caches', async () => {
			contents.set('a.md', 'content of a');
			contents.set('b.md', 'content of b');

			await coordinator.buildAll([makeFile('a.md'), makeFile('b.md')]);

			const expected = [
				{ path: 'a.md', content: 'content of a' },
				{ path: 'b.md', content: 'content of b' },
			];
			expect(idCache.buildFromFiles).toHaveBeenCalledWith(expected);
			expect(depCache.buildFromFiles).toHaveBeenCalledWith(expected);
			expect(syncCache.buildFromFiles).toHaveBeenCalledWith(expected);
		});

		it('preserves the order of the files it was given', async () => {
			contents.set('b.md', 'b');
			contents.set('a.md', 'a');

			await coordinator.buildAll([makeFile('b.md'), makeFile('a.md')]);

			expect(idCache.buildFromFiles).toHaveBeenCalledWith([
				{ path: 'b.md', content: 'b' },
				{ path: 'a.md', content: 'a' },
			]);
		});

		it('reads each file exactly once, not once per cache', async () => {
			contents.set('a.md', 'a');

			await coordinator.buildAll([makeFile('a.md')]);

			expect(cachedRead).toHaveBeenCalledTimes(1);
		});

		it('builds all three caches from an empty list when given no files', async () => {
			await coordinator.buildAll([]);

			expect(cachedRead).not.toHaveBeenCalled();
			expect(idCache.buildFromFiles).toHaveBeenCalledWith([]);
			expect(depCache.buildFromFiles).toHaveBeenCalledWith([]);
			expect(syncCache.buildFromFiles).toHaveBeenCalledWith([]);
		});

		it('does not update or prune anything', async () => {
			contents.set('a.md', 'a');

			await coordinator.buildAll([makeFile('a.md')]);

			expect(idCache.updateForFile).not.toHaveBeenCalled();
			expect(idCache.pruneFile).not.toHaveBeenCalled();
			expect(syncCache.updateForFile).not.toHaveBeenCalled();
			expect(syncCache.pruneFile).not.toHaveBeenCalled();
		});
	});

	describe('updateForFile', () => {
		it('reads the file from the vault and updates all three caches with its path and content', async () => {
			contents.set('a.md', 'fresh content');

			await coordinator.updateForFile(makeFile('a.md'));

			expect(cachedRead).toHaveBeenCalledTimes(1);
			expect(idCache.updateForFile).toHaveBeenCalledWith('a.md', 'fresh content');
			expect(depCache.updateForFile).toHaveBeenCalledWith('a.md', 'fresh content');
			expect(syncCache.updateForFile).toHaveBeenCalledWith('a.md', 'fresh content');
		});

		it('passes the file it was handed to cachedRead', async () => {
			const file = makeFile('a.md');

			await coordinator.updateForFile(file);

			expect(cachedRead).toHaveBeenCalledWith(file);
		});

		it('does not rebuild or prune', async () => {
			await coordinator.updateForFile(makeFile('a.md'));

			expect(idCache.buildFromFiles).not.toHaveBeenCalled();
			expect(idCache.pruneFile).not.toHaveBeenCalled();
		});
	});

	describe('updateFromLiveContent', () => {
		it('updates the id and dependency caches from the given content', () => {
			coordinator.updateFromLiveContent('a.md', 'live buffer');

			expect(idCache.updateForFile).toHaveBeenCalledWith('a.md', 'live buffer');
			expect(depCache.updateForFile).toHaveBeenCalledWith('a.md', 'live buffer');
		});

		it('leaves the sync cache alone, so a mid-edit buffer cannot reseed lastSynced', () => {
			coordinator.updateFromLiveContent('a.md', 'live buffer');

			expect(syncCache.updateForFile).not.toHaveBeenCalled();
			expect(syncCache.buildFromFiles).not.toHaveBeenCalled();
			expect(syncCache.pruneFile).not.toHaveBeenCalled();
		});

		it('does not read from the vault', () => {
			coordinator.updateFromLiveContent('a.md', 'live buffer');

			expect(cachedRead).not.toHaveBeenCalled();
		});
	});

	describe('forgetPath', () => {
		it('prunes the path from all three caches', () => {
			coordinator.forgetPath('notes/a.md');

			expect(idCache.pruneFile).toHaveBeenCalledWith('notes/a.md');
			expect(depCache.pruneFile).toHaveBeenCalledWith('notes/a.md');
			expect(syncCache.pruneFile).toHaveBeenCalledWith('notes/a.md');
		});

		it('passes the path through unchanged, leaving descendant matching to the caches', () => {
			coordinator.forgetPath('notes');

			expect(idCache.pruneFile).toHaveBeenCalledWith('notes');
		});
	});

	describe('handleDelete', () => {
		it('forgets the deleted path in all three caches', () => {
			coordinator.handleDelete(makeFile('a.md'));

			expect(idCache.pruneFile).toHaveBeenCalledWith('a.md');
			expect(depCache.pruneFile).toHaveBeenCalledWith('a.md');
			expect(syncCache.pruneFile).toHaveBeenCalledWith('a.md');
		});

		it('forgets a folder path the same way, without rebuilding', () => {
			coordinator.handleDelete(makeFolder('notes'));

			expect(idCache.pruneFile).toHaveBeenCalledWith('notes');
			expect(idCache.buildFromFiles).not.toHaveBeenCalled();
		});
	});

	describe('handleRename', () => {
		it('forgets the old path and re-indexes the renamed file', async () => {
			contents.set('new.md', 'moved content');

			await coordinator.handleRename(makeFile('new.md'), 'old.md');

			expect(idCache.pruneFile).toHaveBeenCalledWith('old.md');
			expect(idCache.updateForFile).toHaveBeenCalledWith('new.md', 'moved content');
			expect(syncCache.updateForFile).toHaveBeenCalledWith('new.md', 'moved content');
		});

		it('prunes the old path before re-indexing, so the reindex is not undone', async () => {
			contents.set('new.md', 'moved content');
			const order: string[] = [];
			idCache.pruneFile.mockImplementation(() => order.push('prune'));
			idCache.updateForFile.mockImplementation(() => order.push('update'));

			await coordinator.handleRename(makeFile('new.md'), 'old.md');

			expect(order).toEqual(['prune', 'update']);
		});

		it('does not rebuild the vault when a single file is renamed', async () => {
			await coordinator.handleRename(makeFile('new.md'), 'old.md');

			expect(getMarkdownFiles).not.toHaveBeenCalled();
			expect(idCache.buildFromFiles).not.toHaveBeenCalled();
		});

		it('rebuilds every cache from the whole vault when a folder is renamed', async () => {
			contents.set('newfolder/a.md', 'a');
			markdownFiles = [makeFile('newfolder/a.md')];

			await coordinator.handleRename(makeFolder('newfolder'), 'oldfolder');

			expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
			expect(idCache.buildFromFiles).toHaveBeenCalledWith([
				{ path: 'newfolder/a.md', content: 'a' },
			]);
			expect(syncCache.buildFromFiles).toHaveBeenCalledWith([
				{ path: 'newfolder/a.md', content: 'a' },
			]);
		});

		it('does not prune the old folder path, because the rebuild replaces every entry', async () => {
			markdownFiles = [];

			await coordinator.handleRename(makeFolder('newfolder'), 'oldfolder');

			expect(idCache.pruneFile).not.toHaveBeenCalled();
			expect(depCache.pruneFile).not.toHaveBeenCalled();
			expect(syncCache.pruneFile).not.toHaveBeenCalled();
		});
	});
});
