import { Plugin, MarkdownView } from 'obsidian';
import type { Editor } from 'obsidian';
import { TaskParser } from './parsing/task-parser';
import type { IndentConfig } from './parsing/task-parser';
import { IdCache, DepCache } from './cache/marker-cache';
import { MarkerScanner } from './parsing/marker-scanner';
import { IdGenerator } from './linking/id-generator';
import { RelationshipAnalyzer } from './parsing/relationship-analyzer';
import { TaskMetadataParser } from './parsing/task-metadata-parser';
import { MetadataSyncCache } from './cache/metadata-sync-cache';
import { MetadataInheritor } from './linking/metadata-inheritor';
import { TaskLinker } from './linking/task-linker';
import { DependencyCleaner } from './linking/dependency-cleaner';
import { EditorProcessor } from './processing/editor-processor';
import { CacheCoordinator } from './cache/cache-coordinator';
import { ObsidianEditorAdapter } from './obsidian/obsidian-editor-adapter';
import { LineWriteArbiter } from './editing/line-write-arbiter';
import { MarkerAccessorRegistry } from './parsing/marker-accessor';
import { Debounce } from './utils';
import { CursorLineWatcher } from './obsidian/cursor-line-watcher';
import { PluginTriggers } from './obsidian/plugin-triggers';

/**
 * Tasks Auto-Dependency Linker plugin for Obsidian.
 *
 * Thin shell that wires Obsidian events to the extracted, testable classes.
 * All logic lives in TaskParser, IdGenerator, IdCache, TaskLinker,
 * DependencyCleaner, EditorProcessor, CacheCoordinator, and Debounce.
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
		const scanner = new MarkerScanner();
		const idGenerator = new IdGenerator();
		const relAnalyzer = new RelationshipAnalyzer(parser);
		const metadataParser = new TaskMetadataParser();
		const registry = new MarkerAccessorRegistry(parser, metadataParser);
		this.syncCache = new MetadataSyncCache(parser, metadataParser, relAnalyzer);
		const inheritor = new MetadataInheritor(registry, this.syncCache);
		const linker = new TaskLinker(
			parser, idGenerator, relAnalyzer, inheritor,
		);
		const cleaner = new DependencyCleaner(parser);

		this.idCache = new IdCache(scanner);
		this.depCache = new DepCache(scanner);
		this.coordinator = new CacheCoordinator(
			this.idCache, this.depCache, this.syncCache, this.app.vault,
		);
		this.arbiter = new LineWriteArbiter(registry);
		this.processor = new EditorProcessor(
			linker, cleaner, parser, relAnalyzer,
			this.idCache, this.depCache, this.arbiter,
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
