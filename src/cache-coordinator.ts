/**
 * Coordinates the vault-wide lifecycle of the three markers caches.
 *
 * `IdCache`, `DepCache` and `MetadataSyncCache` each track a
 * different slice of vault state, but they are always built, updated
 * and pruned together in response to the same file events. This
 * class drives them as a single unit so `main.ts` does not have to
 * repeat the same three calls at every call site.
 */

import { TFile } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import type { IdCache, DepCache, FileEntry } from './id-engine';
import type { MetadataSyncCache } from './metadata-sync-cache';

/** Minimal vault surface this class depends on, for testability. */
export interface VaultReader {
	cachedRead(file: TFile): Promise<string>;
	getMarkdownFiles(): TFile[];
}

export class CacheCoordinator {
	private readonly idCache: IdCache;
	private readonly depCache: DepCache;
	private readonly syncCache: MetadataSyncCache;
	private readonly vault: VaultReader;

	constructor(
		idCache: IdCache,
		depCache: DepCache,
		syncCache: MetadataSyncCache,
		vault: VaultReader,
	) {
		this.idCache = idCache;
		this.depCache = depCache;
		this.syncCache = syncCache;
		this.vault = vault;
	}

	/** Rebuilds all three caches from scratch using the given files. */
	async buildAll(files: TFile[]): Promise<void> {
		const entries = await this.readEntries(files);
		this.idCache.buildFromFiles(entries);
		this.depCache.buildFromFiles(entries);
		this.syncCache.buildFromFiles(entries);
	}

	/**
	 * Refreshes all three caches for a single file, reading its content
	 * from disk via `Vault.cachedRead`.
	 */
	async updateForFile(file: TFile): Promise<void> {
		const content = await this.vault.cachedRead(file);
		this.updateFromLiveContent(file.path, content);
		this.syncCache.updateForFile(file.path, content);
	}

	/**
	 * Synchronously refreshes the ID and dependency caches for `path`
	 * from `content`, without touching disk. Intended for the live
	 * editor buffer between debounce passes, so `cleanOrphanedIds` and
	 * `cleanDanglingDeps` see fresh cross-reference data even before
	 * autosave writes the file.
	 *
	 * Deliberately excludes `syncCache`: `MetadataSyncCache.updateForFile`
	 * does prune + reseed, recomputing the "last inherited value"
	 * bookkeeping from whatever the buffer happens to hold. Reseeding
	 * that from a mid-edit buffer every 300ms debounce pass would
	 * amplify the known open bug where an autosave mid-edit resets
	 * `lastSynced` to null. `syncCache` therefore keeps refreshing on
	 * disk save only, via `updateForFile`.
	 */
	updateFromLiveContent(path: string, content: string): void {
		this.idCache.updateForFile(path, content);
		this.depCache.updateForFile(path, content);
	}

	/**
	 * Drops every entry contributed by `path` from all three caches.
	 * Also drops entries under `path + '/'`, so a folder path forgets
	 * every file it contained.
	 */
	forgetPath(path: string): void {
		this.idCache.pruneFile(path);
		this.depCache.pruneFile(path);
		this.syncCache.pruneFile(path);
	}


	/** Vault 'delete' handler. Forgets the deleted path in all caches. */
	handleDelete(file: TAbstractFile): void {
		this.forgetPath(file.path);
	}

	/**
	 * Vault 'rename' handler. A single file is a cheap forget-and-reindex.
	 * A folder rename changes the path of every file it contains, so a
	 * full rebuild runs instead of guessing which entries to prune.
	 */
	async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (file instanceof TFile) {
			this.forgetPath(oldPath);
			await this.updateForFile(file);
			return;
		}
		await this.buildAll(this.vault.getMarkdownFiles());
	}

	private async readEntries(files: TFile[]): Promise<FileEntry[]> {
		return Promise.all(
			files.map(async (file) => ({
				path: file.path,
				content: await this.vault.cachedRead(file),
			})),
		);
	}
}
