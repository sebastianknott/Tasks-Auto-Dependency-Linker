import { Plugin, MarkdownView, TFile } from 'obsidian';
import { TaskParser } from './task-parser';
import type { IndentConfig } from './task-parser';
import { IdEngine } from './id-engine';
import { IndentationHandler } from './indentation-handler';
import { Debounce } from './utils';

/**
 * Tasks Auto-Dependency Linker — Obsidian Plugin.
 *
 * Automatically manages task dependencies (`🆔` / `⛔` markers) based on
 * indentation. Indent a task = block its parent; outdent = unblock.
 */
export default class TasksAutoDependencyLinker extends Plugin {
	private parser!: TaskParser;
	private idEngine!: IdEngine;
	private handler!: IndentationHandler;
	private debounce!: Debounce;
	private existingIds: Set<string> = new Set();

	async onload(): Promise<void> {
		const vault = this.app.vault as unknown as {
			getConfig(key: string): unknown;
		};

		const indentConfig: IndentConfig = {
			useTab: (vault.getConfig('useTab') as boolean | undefined) ?? true,
			tabSize: (vault.getConfig('tabSize') as number | undefined) ?? 4,
		};

		this.parser = new TaskParser(indentConfig);
		this.idEngine = new IdEngine();
		this.handler = new IndentationHandler(this.parser, this.idEngine);

		this.debounce = new Debounce(() => {
			this.processActiveEditor();
		});

		// Build initial ID cache once the workspace layout is ready
		this.app.workspace.onLayoutReady(() => {
			void this.buildIdCache();
		});

		// Keep ID cache up to date when files change
		this.registerEvent(
			this.app.vault.on('modify', (file: TFile) => {
				if (file.extension === 'md') {
					void this.updateIdCacheForFile(file);
				}
			}),
		);

		// React to editor changes (debounced)
		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				this.debounce.call();
			}),
		);
	}

	onunload(): void {
		this.debounce?.cancel();
	}

	/** Scans all markdown files in the vault to build the full ID cache. */
	private async buildIdCache(): Promise<void> {
		this.existingIds.clear();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			for (const id of this.idEngine.collectAllIds(content)) {
				this.existingIds.add(id);
			}
		}
	}

	/** Updates the ID cache for a single file after modification. */
	private async updateIdCacheForFile(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		for (const id of this.idEngine.collectAllIds(content)) {
			this.existingIds.add(id);
		}
	}

	/** Processes all visible lines in the active editor. */
	private processActiveEditor(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return;
		}

		const editor = view.editor;
		const lineCount = editor.lineCount();

		for (let i = 0; i < lineCount; i++) {
			this.handler.processLine(editor, i, this.existingIds);
		}
	}
}
