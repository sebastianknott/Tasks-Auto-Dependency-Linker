import { Plugin, MarkdownView } from 'obsidian';
import type { Editor } from 'obsidian';
import { ComponentGraph } from './obsidian/component-graph';
import { IndentConfigReader } from './obsidian/indent-config-reader';
import { ObsidianEditorAdapter } from './obsidian/obsidian-editor-adapter';
import { CursorLineWatcher } from './obsidian/cursor-line-watcher';
import { PluginTriggers } from './obsidian/plugin-triggers';
import { Debounce } from './utils';

/**
 * Tasks Auto-Dependency Linker plugin for Obsidian.
 *
 * Thin shell around three jobs: refuse to start unless the Tasks plugin
 * is enabled, register the triggers that schedule a pass, and hand the
 * active editor to the processor. `ComponentGraph` builds everything
 * else.
 */
export default class TasksAutoDependencyLinker extends Plugin {
	private debounce!: Debounce;
	private graph!: ComponentGraph;
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

		const indent = new IndentConfigReader(this.app.vault).read();
		this.graph = new ComponentGraph(this.app.vault, indent);
		this.debounce = new Debounce(() => this.processActiveEditor());
		this.watcher = new CursorLineWatcher(() => this.debounce.call());
		new PluginTriggers(
			this, this.graph.coordinator, this.graph.arbiter, this.debounce, this.watcher,
		).register();
	}

	onunload(): void {
		this.debounce?.cancel();
	}

	private processActiveEditor(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			return;
		}
		const path = view.file?.path ?? '';
		this.graph.processor.processAllLines(new ObsidianEditorAdapter(view.editor), path);
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
		this.graph.coordinator.updateFromLiveContent(path, editor.getValue());
	}
}
