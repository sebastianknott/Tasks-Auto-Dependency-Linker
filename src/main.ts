import { Plugin, MarkdownView, TFile } from 'obsidian';
import { TaskParser } from './task-parser';
import type { IndentConfig } from './task-parser';
import { IdEngine, IdCache } from './id-engine';
import { IndentationHandler, EditorProcessor } from './indentation-handler';
import { Debounce } from './utils';

/**
 * Tasks Auto-Dependency Linker — Obsidian Plugin.
 *
 * Thin shell that wires Obsidian events to the extracted, testable classes.
 * All logic lives in TaskParser, IdEngine, IdCache, IndentationHandler,
 * EditorProcessor, and Debounce.
 */
export default class TasksAutoDependencyLinker extends Plugin {
	private debounce!: Debounce;
	private idCache!: IdCache;
	private processor!: EditorProcessor;

	async onload(): Promise<void> {
		const vault = this.app.vault as unknown as {
			getConfig(key: string): unknown;
		};

		const indentConfig: IndentConfig = {
			useTab: (vault.getConfig('useTab') as boolean | undefined) ?? true,
			tabSize: (vault.getConfig('tabSize') as number | undefined) ?? 4,
		};

		const parser = new TaskParser(indentConfig);
		const idEngine = new IdEngine();
		const handler = new IndentationHandler(parser, idEngine);

		this.idCache = new IdCache(idEngine);
		this.processor = new EditorProcessor(handler);
		this.debounce = new Debounce(() => this.processActiveEditor());

		this.app.workspace.onLayoutReady(() => void this.buildIdCache());

		this.registerEvent(
			this.app.vault.on('modify', (file: TFile) => {
				if (file.extension === 'md') {
					void this.updateCacheForFile(file);
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', () => this.debounce.call()),
		);
	}

	onunload(): void {
		this.debounce?.cancel();
	}

	private async buildIdCache(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const contents: string[] = [];
		for (const file of files) {
			contents.push(await this.app.vault.cachedRead(file));
		}
		this.idCache.buildFromContents(contents);
	}

	private async updateCacheForFile(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		this.idCache.updateFromContent(content);
	}

	private processActiveEditor(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return;
		}
		this.processor.processAllLines(view.editor, this.idCache.getIds());
	}
}
