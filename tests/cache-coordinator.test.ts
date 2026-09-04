import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheCoordinator } from '../src/cache-coordinator';
import { IdCache, DepCache, IdEngine } from '../src/id-engine';
import { MetadataSyncCache } from '../src/metadata-sync-cache';
import { TaskParser } from '../src/task-parser';
import { TaskMetadataParser } from '../src/task-metadata-parser';
import { RelationshipAnalyzer } from '../src/relationship-analyzer';
import { TFile, TFolder } from 'obsidian';
import type { TAbstractFile } from 'obsidian';

describe('CacheCoordinator', () => {
	let idCache: IdCache;
	let depCache: DepCache;
	let syncCache: MetadataSyncCache;
	let contents: Map<string, string>;
	let markdownFiles: TFile[];
	let vault: {
		cachedRead(file: TFile): Promise<string>;
		getMarkdownFiles(): TFile[];
	};
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
		const idEngine = new IdEngine();
		idCache = new IdCache(idEngine);
		depCache = new DepCache(idEngine);
		const parser = new TaskParser();
		const metadataParser = new TaskMetadataParser();
		const relAnalyzer = new RelationshipAnalyzer(parser);
		syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
		contents = new Map();
		markdownFiles = [];
		vault = {
			cachedRead: async (file: TFile): Promise<string> =>
				contents.get(file.path) ?? '',
			getMarkdownFiles: (): TFile[] => markdownFiles,
		};
		coordinator = new CacheCoordinator(idCache, depCache, syncCache, vault);
	});

	describe('buildAll', () => {
		it('populates all three caches from file content', async () => {
			contents.set(
				'a.md',
				'- [ ] Parent \u{1F4C5} 2025-01-01\n\t- [ ] Child \u{1F194} aaa \u{1F4C5} 2025-01-01 \u26D4 bbb',
			);
			await coordinator.buildAll([makeFile('a.md')]);
			expect(idCache.getAll()).toEqual(new Set(['aaa']));
			expect(depCache.getAll()).toEqual(new Set(['bbb']));
			expect(syncCache.get('aaa')?.due).toBe('2025-01-01');
		});
	});

	describe('updateForFile', () => {
		it('refreshes one file without touching others', async () => {
			contents.set('a.md', '- [ ] P \u{1F194} aaa');
			contents.set('b.md', '- [ ] P \u{1F194} bbb');
			await coordinator.buildAll([makeFile('a.md'), makeFile('b.md')]);

			contents.set('a.md', '- [ ] P \u{1F194} ccc');
			await coordinator.updateForFile(makeFile('a.md'));

			expect(idCache.getAll()).toEqual(new Set(['ccc', 'bbb']));
		});

		it('still updates all three caches (idCache, depCache, syncCache) after the delegation refactor', async () => {
			contents.set(
				'a.md',
				'- [ ] Parent \u{1F4C5} 2025-01-01\n\t- [ ] Child \u{1F194} aaa \u{1F4C5} 2025-01-01 \u26D4 bbb',
			);
			await coordinator.buildAll([makeFile('a.md')]);

			contents.set(
				'a.md',
				'- [ ] Parent \u{1F4C5} 2025-02-02\n\t- [ ] Child \u{1F194} ccc \u{1F4C5} 2025-02-02 \u26D4 ddd',
			);
			await coordinator.updateForFile(makeFile('a.md'));

			expect(idCache.getAll()).toEqual(new Set(['ccc']));
			expect(depCache.getAll()).toEqual(new Set(['ddd']));
			expect(syncCache.get('ccc')?.due).toBe('2025-02-02');
		});
	});

	describe('updateFromLiveContent', () => {
		it('populates idCache and depCache from the given content synchronously, without reading from the vault', () => {
			const readSpy = vi.spyOn(vault, 'cachedRead');

			coordinator.updateFromLiveContent(
				'a.md',
				'- [ ] Parent \u26D4 dep1\n\t- [ ] Child \u{1F194} live1',
			);

			expect(idCache.getAll()).toEqual(new Set(['live1']));
			expect(depCache.getAll()).toEqual(new Set(['dep1']));
			expect(readSpy).not.toHaveBeenCalled();
		});

		it('replaces stale entries for that path and leaves other files\' entries untouched', async () => {
			contents.set('a.md', '- [ ] P \u{1F194} aaa');
			contents.set('b.md', '- [ ] P \u{1F194} bbb');
			await coordinator.buildAll([makeFile('a.md'), makeFile('b.md')]);

			coordinator.updateFromLiveContent('a.md', '- [ ] P \u{1F194} ccc');

			expect(idCache.getAll()).toEqual(new Set(['ccc', 'bbb']));
		});
	});

	describe('forgetPath', () => {
		it('drops the exact path from all three caches', async () => {
			contents.set(
				'a.md',
				'- [ ] Parent \u{1F4C5} 2025-01-01\n\t- [ ] Child \u{1F194} aaa \u26D4 bbb',
			);
			await coordinator.buildAll([makeFile('a.md')]);

			coordinator.forgetPath('a.md');

			expect(idCache.getAll()).toEqual(new Set());
			expect(depCache.getAll()).toEqual(new Set());
			expect(syncCache.get('aaa')).toBeUndefined();
		});

		it('drops descendants under path + "/" and leaves a sibling path with the same prefix but no separator alone', async () => {
			contents.set('notes/a.md', '- [ ] P \u{1F194} aaa');
			contents.set('notes-archive.md', '- [ ] P \u{1F194} bbb');
			await coordinator.buildAll([
				makeFile('notes/a.md'),
				makeFile('notes-archive.md'),
			]);

			coordinator.forgetPath('notes');

			expect(idCache.getAll()).toEqual(new Set(['bbb']));
		});
	});

	describe('handleDelete', () => {
		it('forgets the deleted path', async () => {
			contents.set('a.md', '- [ ] P \u{1F194} aaa');
			await coordinator.buildAll([makeFile('a.md')]);

			const deleted: TAbstractFile = makeFile('a.md');
			coordinator.handleDelete(deleted);

			expect(idCache.getAll()).toEqual(new Set());
		});

		it('forgets every descendant when a folder is deleted', async () => {
			contents.set('notes/a.md', '- [ ] P \u{1F194} aaa');
			await coordinator.buildAll([makeFile('notes/a.md')]);

			coordinator.handleDelete(makeFolder('notes'));

			expect(idCache.getAll()).toEqual(new Set());
		});
	});

	describe('handleRename', () => {
		it('forgets the old path and re-indexes the file under the new path', async () => {
			contents.set('old.md', '- [ ] P \u{1F194} aaa');
			await coordinator.buildAll([makeFile('old.md')]);

			contents.set('new.md', '- [ ] P \u{1F194} bbb');
			markdownFiles = [makeFile('new.md')];
			await coordinator.handleRename(makeFile('new.md'), 'old.md');

			expect(idCache.getAll()).toEqual(new Set(['bbb']));
		});

		it('rebuilds the whole vault cache when a folder is renamed', async () => {
			contents.set('newfolder/a.md', '- [ ] P \u{1F194} folder1');
			markdownFiles = [makeFile('newfolder/a.md')];

			await coordinator.handleRename(makeFolder('newfolder'), 'oldfolder');

			expect(idCache.getAll()).toEqual(new Set(['folder1']));
		});
	});
});
