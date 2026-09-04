import { Plugin, MarkdownView } from 'obsidian';
import type { Editor } from 'obsidian';
import { TaskParser } from './task-parser';
import type { IndentConfig } from './task-parser';
import { IdEngine, IdCache, DepCache } from './id-engine';
import { RelationshipAnalyzer } from './relationship-analyzer';
import { TaskMetadataParser } from './task-metadata-parser';
import { MetadataSyncCache } from './metadata-sync-cache';
import { MetadataInheritor } from './metadata-inheritor';
import { IndentationHandler } from './indentation-handler';
import { EditorProcessor } from './editor-processor';
import { CacheCoordinator } from './cache-coordinator';
import { ObsidianEditorAdapter } from './obsidian-editor-adapter';
import { LineWriteArbiter } from './line-write-arbiter';
import { MarkerAccessorRegistry } from './marker-accessor';
import { Debounce } from './utils';
import { CursorLineWatcher } from './cursor-line-watcher';
import { PluginTriggers } from './plugin-triggers';

/**
 * Tasks Auto-Dependency Linker plugin for Obsidian.
 *
 * Thin shell that wires Obsidian events to the extracted, testable classes.
 * All logic lives in TaskParser, IdEngine, IdCache, IndentationHandler,
 * EditorProcessor, CacheCoordinator, and Debounce.
 */
export default class TasksAutoDependencyLinker extends Plugin {
	private debounce!: Debounce;
	private idCache!: IdCache;
	private depCache!: DepCache;
	private syncCache!: MetadataSyncCache;
	private coordinator!: CacheCoordinator;
	private processor!: EditorProcessor;
	private arbiter!: LineWriteArbiter;
	private watcher!: CursorLineWatcher;

	/** Obsidian Tasks plugin ID in the community plugins registry. */
	private static readonly TASKS_PLUGIN_ID = 'obsidian-tasks-plugin';

	async onload(): Promise<void> {
		const plugins = (
			this.app as unknown as {
				plugins: { enabledPlugins: Set<string> };
			}
		).plugins;
		if (!plugins.enabledPlugins.has(TasksAutoDependencyLinker.TASKS_PLUGIN_ID)) {
			return;
		}

		this.buildComponents();
		new PluginTriggers(
			this, this.coordinator, this.arbiter, this.debounce, this.watcher,
		).register();
	}

	onunload(): void {
		this.debounce?.cancel();
	}

	/** Constructs the parser/cache/processor graph used by this instance. */
	private buildComponents(): void {
		const vault = this.app.vault as unknown as {
			getConfig(key: string): unknown;
		};
		const indentConfig: IndentConfig = {
			useTab: (vault.getConfig('useTab') as boolean | undefined) ?? true,
			tabSize: (vault.getConfig('tabSize') as number | undefined) ?? 4,
		};

		const parser = new TaskParser(indentConfig);
		const idEngine = new IdEngine();
		const relAnalyzer = new RelationshipAnalyzer(parser);
		const metadataParser = new TaskMetadataParser();
		const registry = new MarkerAccessorRegistry(parser, metadataParser);
		this.syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
		const inheritor = new MetadataInheritor(registry, this.syncCache);
		const handler = new IndentationHandler(
			parser, idEngine, relAnalyzer, inheritor,
		);

		this.idCache = new IdCache(idEngine);
		this.depCache = new DepCache(idEngine);
		this.coordinator = new CacheCoordinator(
			this.idCache, this.depCache, this.syncCache, this.app.vault,
		);
		this.arbiter = new LineWriteArbiter(registry);
		this.processor = new EditorProcessor(
			handler, parser, relAnalyzer, this.idCache, this.depCache, this.arbiter,
		);
		this.debounce = new Debounce(() => this.processActiveEditor());
		this.watcher = new CursorLineWatcher(() => this.debounce.call());
	}

	private processActiveEditor(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return;
		}
		const path = view.file?.path ?? '';
		this.processor.processAllLines(new ObsidianEditorAdapter(view.editor), path);
		this.refreshLiveCache(path, view.editor);
	}

	/**
	 * Keeps the ID and dependency caches fresh from the live editor buffer
	 * between debounce passes, so cross-reference cleanup does not act on
	 * stale data while waiting for autosave. Skipped for a file-less
	 * buffer, so an empty path never pollutes the caches.
	 */
	private refreshLiveCache(path: string, editor: Editor): void {
		if (!path) {
			return;
		}
		this.coordinator.updateFromLiveContent(path, editor.getValue());
	}
}
