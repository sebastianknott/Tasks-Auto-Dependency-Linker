import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentGraph } from '../../src/obsidian/component-graph';
import { IndentConfigReader } from '../../src/obsidian/indent-config-reader';
import { ObsidianEditorAdapter } from '../../src/obsidian/obsidian-editor-adapter';
import { CursorLineWatcher } from '../../src/obsidian/cursor-line-watcher';
import { PluginTriggers } from '../../src/obsidian/plugin-triggers';
import { Debounce } from '../../src/utils';
import TasksAutoDependencyLinker from '../../src/main';

const holder = vi.hoisted(() => ({
	graphState: { current: undefined },
	indentState: { current: undefined },
	debounceState: { current: undefined },
	watcherState: { current: undefined },
	triggersState: { current: undefined },
}));

vi.mock('../../src/obsidian/component-graph', () => ({
	ComponentGraph: vi.fn(() => holder.graphState.current),
}));

vi.mock('../../src/obsidian/indent-config-reader', () => ({
	IndentConfigReader: vi.fn(() => holder.indentState.current),
}));

vi.mock('../../src/utils', () => ({
	Debounce: vi.fn(() => holder.debounceState.current),
}));

vi.mock('../../src/obsidian/cursor-line-watcher', () => ({
	CursorLineWatcher: vi.fn(() => holder.watcherState.current),
}));

vi.mock('../../src/obsidian/plugin-triggers', () => ({
	PluginTriggers: vi.fn(() => holder.triggersState.current),
}));

function createFakeGraph(order: string[]): {
	coordinator: { updateFromLiveContent: ReturnType<typeof vi.fn> };
	arbiter: object;
	processor: { processAllLines: ReturnType<typeof vi.fn> };
} {
	return {
		coordinator: {
			updateFromLiveContent: vi.fn(() => {
				order.push('updateFromLiveContent');
			}),
		},
		arbiter: {},
		processor: {
			processAllLines: vi.fn(() => {
				order.push('processAllLines');
			}),
		},
	};
}

function createFakeDebounce(): { call: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
	return {
		call: vi.fn(),
		cancel: vi.fn(),
	};
}

function createFakeWatcher(): { extension: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> } {
	return {
		extension: vi.fn(),
		reset: vi.fn(),
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPlugin = any;

describe('TasksAutoDependencyLinker (solitary)', () => {
	let order: string[];
	let plugin: AnyPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		order = [];
		holder.graphState.current = createFakeGraph(order);
		holder.indentState.current = { read: vi.fn(() => ({ useTab: true, tabSize: 4 })) };
		holder.debounceState.current = createFakeDebounce();
		holder.watcherState.current = createFakeWatcher();
		holder.triggersState.current = { register: vi.fn() };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		plugin = new (TasksAutoDependencyLinker as any)();
	});

	describe('Tasks plugin gate', () => {
		it('does not construct any collaborator when the Tasks plugin is not enabled', async () => {
			plugin.app.plugins.enabledPlugins = new Set();

			await plugin.onload();

			expect(IndentConfigReader).not.toHaveBeenCalled();
			expect(ComponentGraph).not.toHaveBeenCalled();
			expect(Debounce).not.toHaveBeenCalled();
			expect(CursorLineWatcher).not.toHaveBeenCalled();
			expect(PluginTriggers).not.toHaveBeenCalled();
		});

		it('constructs all collaborators and registers triggers when the Tasks plugin is enabled', async () => {
			plugin.app.plugins.enabledPlugins = new Set(['obsidian-tasks-plugin']);

			await plugin.onload();

			expect(IndentConfigReader).toHaveBeenCalledTimes(1);
			expect(IndentConfigReader).toHaveBeenCalledWith(plugin.app.vault);
			expect(ComponentGraph).toHaveBeenCalledTimes(1);
			expect(ComponentGraph).toHaveBeenCalledWith(plugin.app.vault, { useTab: true, tabSize: 4 });
			expect(Debounce).toHaveBeenCalledTimes(1);
			expect(CursorLineWatcher).toHaveBeenCalledTimes(1);
			expect(PluginTriggers).toHaveBeenCalledTimes(1);
			expect(PluginTriggers).toHaveBeenCalledWith(
				plugin,
				holder.graphState.current.coordinator,
				holder.graphState.current.arbiter,
				holder.debounceState.current,
				holder.watcherState.current,
			);
			expect(holder.triggersState.current.register).toHaveBeenCalledTimes(1);
		});
	});

	describe('onunload', () => {
		it('does not throw when called before onload', () => {
			expect(() => {
				plugin.onunload();
			}).not.toThrow();
		});

		it('cancels the debounce when called after onload', async () => {
			plugin.app.plugins.enabledPlugins = new Set(['obsidian-tasks-plugin']);
			await plugin.onload();

			plugin.onunload();

			expect(holder.debounceState.current.cancel).toHaveBeenCalledTimes(1);
		});
	});

	describe('processActiveEditor via the Debounce callback', () => {
		async function loadAndCapture(): Promise<() => void> {
			plugin.app.plugins.enabledPlugins = new Set(['obsidian-tasks-plugin']);
			await plugin.onload();
			return vi.mocked(Debounce).mock.calls[0][0];
		}

		it('does not process when there is no active markdown view', async () => {
			const runProcessActiveEditor = await loadAndCapture();
			plugin.app.workspace.getActiveViewOfType = vi.fn(() => null);

			runProcessActiveEditor();

			expect(holder.graphState.current.processor.processAllLines).not.toHaveBeenCalled();
		});

		it('falls back to an empty path when the view has no backing file', async () => {
			const runProcessActiveEditor = await loadAndCapture();
			const editor = { getValue: vi.fn(() => 'content') };
			plugin.app.workspace.getActiveViewOfType = vi.fn(() => ({ file: undefined, editor }));

			runProcessActiveEditor();

			expect(holder.graphState.current.processor.processAllLines).toHaveBeenCalledWith(
				expect.any(ObsidianEditorAdapter),
				'',
			);
		});

		it('uses the file path when the view has a backing file', async () => {
			const runProcessActiveEditor = await loadAndCapture();
			const editor = { getValue: vi.fn(() => 'content') };
			plugin.app.workspace.getActiveViewOfType = vi.fn(() => ({ file: { path: 'notes/a.md' }, editor }));

			runProcessActiveEditor();

			expect(holder.graphState.current.processor.processAllLines).toHaveBeenCalledWith(
				expect.any(ObsidianEditorAdapter),
				'notes/a.md',
			);
		});
	});

	describe('refreshLiveCache', () => {
		async function loadAndCapture(): Promise<() => void> {
			plugin.app.plugins.enabledPlugins = new Set(['obsidian-tasks-plugin']);
			await plugin.onload();
			return vi.mocked(Debounce).mock.calls[0][0];
		}

		it('does not update the sync cache when the path is empty', async () => {
			const runProcessActiveEditor = await loadAndCapture();
			const editor = { getValue: vi.fn(() => 'irrelevant') };
			plugin.app.workspace.getActiveViewOfType = vi.fn(() => ({ file: undefined, editor }));

			runProcessActiveEditor();

			expect(holder.graphState.current.coordinator.updateFromLiveContent).not.toHaveBeenCalled();
		});

		it('updates the sync cache with the path and live editor content when the path is non-empty', async () => {
			const runProcessActiveEditor = await loadAndCapture();
			const editor = { getValue: vi.fn(() => 'line one\nline two') };
			plugin.app.workspace.getActiveViewOfType = vi.fn(() => ({ file: { path: 'notes/b.md' }, editor }));

			runProcessActiveEditor();

			expect(holder.graphState.current.coordinator.updateFromLiveContent).toHaveBeenCalledWith(
				'notes/b.md',
				'line one\nline two',
			);
		});

		it('runs after processAllLines has already written markers', async () => {
			const runProcessActiveEditor = await loadAndCapture();
			const editor = { getValue: vi.fn(() => 'content') };
			plugin.app.workspace.getActiveViewOfType = vi.fn(() => ({ file: { path: 'notes/c.md' }, editor }));

			runProcessActiveEditor();

			expect(order).toEqual(['processAllLines', 'updateFromLiveContent']);
		});
	});

	describe('CursorLineWatcher wiring', () => {
		it('triggers the debounce when the watcher reports a line change', async () => {
			plugin.app.plugins.enabledPlugins = new Set(['obsidian-tasks-plugin']);
			await plugin.onload();
			const onLineChange = vi.mocked(CursorLineWatcher).mock.calls[0][0];

			onLineChange();

			expect(holder.debounceState.current.call).toHaveBeenCalledTimes(1);
		});
	});
});
