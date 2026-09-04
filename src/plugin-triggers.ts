import type { Plugin, TFile } from 'obsidian';
import type { CacheCoordinator } from './cache-coordinator';
import type { LineWriteArbiter } from './line-write-arbiter';
import type { Debounce } from './utils';
import type { CursorLineWatcher } from './cursor-line-watcher';

/**
 * Wires Obsidian vault, workspace, and editor events to the cache
 * coordinator, line-write arbiter, and debounce. Extracted from
 * TasksAutoDependencyLinker so main.ts stays within the FTA complexity
 * budget; this class owns no state of its own beyond its collaborators.
 */
export class PluginTriggers {
	constructor(
		private readonly plugin: Plugin,
		private readonly coordinator: CacheCoordinator,
		private readonly arbiter: LineWriteArbiter,
		private readonly debounce: Debounce,
		private readonly watcher: CursorLineWatcher,
	) {}

	/** Registers every event and editor extension this plugin depends on. */
	register(): void {
		this.plugin.app.workspace.onLayoutReady(
			async () => this.coordinator.buildAll(this.plugin.app.vault.getMarkdownFiles()),
		);

		this.registerModifyTrigger();
		this.registerDeleteTrigger();
		this.registerRenameTrigger();
		this.registerFileOpenTrigger();
		this.registerEditorChangeTrigger();

		// The watcher's onLineChange callback (wired in main.ts's
		// buildComponents) must call debounce.call() rather than processing
		// the editor directly: CodeMirror forbids dispatching a transaction
		// from inside an update listener, and the debounce's setTimeout
		// moves the editor write out of that call stack. Do not "optimise"
		// this into a direct synchronous call.
		this.plugin.registerEditorExtension(this.watcher.extension());
	}

	/**
	 * Updates the cache for every modified markdown file, and additionally
	 * schedules a debounced processing pass when the modified file is the
	 * one currently shown in the active editor. This is the save trigger:
	 * `vault.on('modify')` fires for both Ctrl+S and Obsidian's autosave.
	 * A background file (Obsidian Sync, another window, another plugin
	 * writing elsewhere) must not schedule a pass, since there is no
	 * active editor buffer for it to affect.
	 */
	private registerModifyTrigger(): void {
		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file: TFile) => {
				if (file.extension !== 'md') {
					return;
				}
				void this.coordinator.updateForFile(file);
				if (this.plugin.app.workspace.getActiveFile() === file) {
					this.debounce.call();
				}
			}),
		);
	}

	private registerDeleteTrigger(): void {
		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file) => this.coordinator.handleDelete(file)),
		);
	}

	private registerRenameTrigger(): void {
		this.plugin.registerEvent(
			this.plugin.app.vault.on(
				'rename',
				async (file, oldPath) => this.coordinator.handleRename(file, oldPath),
			),
		);
	}

	/**
	 * On every file-open, resets the cursor-line watcher unconditionally
	 * (a single watcher instance is shared across all editor views, so the
	 * previously remembered line is meaningless once the file changes,
	 * including when the new file is null or non-markdown) and seeds the
	 * arbiter snapshot when the opened file is markdown.
	 */
	private registerFileOpenTrigger(): void {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', (file) => {
				this.watcher.reset();
				void this.seedArbiterForFile(file);
			}),
		);
	}

	private registerEditorChangeTrigger(): void {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('editor-change', () => this.debounce.call()),
		);
	}

	/**
	 * Primes the arbiter's snapshot for a newly opened file from its
	 * on-disk content, so the very first edit after opening is already
	 * protected. Reads via `cachedRead` because the editor is not
	 * guaranteed to exist yet when `file-open` fires.
	 */
	private async seedArbiterForFile(file: TFile | null): Promise<void> {
		if (!file || file.extension !== 'md') {
			return;
		}
		const content = await this.plugin.app.vault.cachedRead(file);
		this.arbiter.seedFromText(file.path, content);
	}
}
