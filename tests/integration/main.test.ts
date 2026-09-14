import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import TasksAutoDependencyLinker from '../../src/main';
import type { CapturedUpdateListener } from '../__mocks__/codemirror-view';
import type { ViewUpdate } from '@codemirror/view';
import { createEditor } from '../fixtures/editor';

/**
 * Helper: cast plugin to access mock internals set up by the obsidian mock.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginInternals = any;

/**
 * Builds a structural fake `ViewUpdate` for driving the CursorLineWatcher
 * extension registered by `main.ts`. Only the fields
 * `CursorLineWatcher.handle` actually reads are populated.
 */
function fakeCursorUpdate(options: { selectionSet: boolean; lineForHead: number }): ViewUpdate {
	const lineAt = vi.fn((_pos: number) => ({ number: options.lineForHead }));
	return {
		selectionSet: options.selectionSet,
		docChanged: false,
		state: {
			selection: { main: { head: 0 } },
			doc: { lineAt },
		},
	} as unknown as ViewUpdate;
}

describe('TasksAutoDependencyLinker', () => {
	let plugin: TasksAutoDependencyLinker;

	beforeEach(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		plugin = new (TasksAutoDependencyLinker as any)();
	});

	describe('Tasks plugin detection', () => {
		it('proceeds normally when Tasks plugin is enabled', async () => {
			const p = plugin as PluginInternals;
			// The mock default includes 'obsidian-tasks-plugin' in enabledPlugins
			expect(p.app.plugins.enabledPlugins.has('obsidian-tasks-plugin')).toBe(true);

			await plugin.onload();

			const vaultHandlers = p._vaultEmitter.getHandlers('modify');
			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			expect(vaultHandlers.length).toBe(1);
			expect(wsHandlers.length).toBe(1);
		});
	});

	describe('onload', () => {
		it('registers a layoutReady callback that calls buildIdCache', async () => {
			const p = plugin as PluginInternals;

			const file1 = new TFile();
			file1.path = 'a.md';
			p.app.vault.getMarkdownFiles = () => [file1];
			const readSpy = vi.fn(async () => '- [ ] Task \u{1F194} aaa111');
			p.app.vault.cachedRead = readSpy;

			await plugin.onload();

			// The layoutReady callback should be set
			expect(p._layoutReadyCb).toBeInstanceOf(Function);

			// Call it and verify buildIdCache ran (cachedRead was called)
			await p._layoutReadyCb();
			expect(readSpy).toHaveBeenCalledWith(file1);
		});

		const useTabCases = [
			{
				name: 'uses useTab:true as default when vault.getConfig returns undefined',
				getConfig: (_key: string): unknown => undefined,
				expectSetLine: false,
			},
			{
				name: 'reads useTab:false from vault config so spaces count as indentation',
				getConfig: (key: string): unknown => {
					if (key === 'useTab') return false;
					if (key === 'tabSize') return 4;
					return undefined;
				},
				expectSetLine: true,
			},
		];

		// With useTab:true (default), spaces do not count as indentation, so no
		// parent is found for the space-indented child, and setLine is never
		// called. With useTab:false and tabSize:4, four spaces count as one
		// indent level, a parent is found, and setLine is called.
		it.each(useTabCases)('$name', async ({ getConfig, expectSetLine }) => {
			const p = plugin as PluginInternals;
			p.app.vault.getConfig = getConfig;

			const lines = ['- [ ] Parent', '    - [ ] Child with spaces'];
			const mockEditor = createEditor(lines, { line: 0, ch: 0 });
			p.app.workspace.getActiveViewOfType = () => ({ editor: mockEditor });

			await plugin.onload();

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(mockEditor.setLine.mock.calls.length > 0).toBe(expectSetLine);
		});
	});

	describe('vault delete handler', () => {
		const deleteCases = [
			{
				name: 'forgets a deleted file so its ids no longer protect dependents',
				seedPath: 'a.md',
				id: 'aaa111',
				// deleting the seeded file itself
				makeDeleteTarget: (seedFile: TFile): TFile | TFolder => seedFile,
			},
			{
				name: 'drops descendants of a deleted folder path',
				seedPath: 'notes/a.md',
				id: 'nested1',
				// deleting an ancestor folder of the seeded file
				makeDeleteTarget: (_seedFile: TFile): TFile | TFolder => {
					const folder = new TFolder();
					folder.path = 'notes';
					return folder;
				},
			},
		];

		it.each(deleteCases)('$name', async ({ seedPath, id, makeDeleteTarget }) => {
			const p = plugin as PluginInternals;
			p.app.vault.getMarkdownFiles = () => [];
			p.app.vault.cachedRead = vi.fn(async () => `- [ ] Task \u{1F194} ${id}`);

			await plugin.onload();

			const seedFile = new TFile();
			seedFile.path = seedPath;
			await p.graph.coordinator.updateForFile(seedFile);
			expect(p.graph.idCache.getAll().has(id)).toBe(true);

			const deleteHandlers = p._vaultEmitter.getHandlers('delete');
			expect(deleteHandlers.length).toBe(1);
			deleteHandlers[0].cb(makeDeleteTarget(seedFile));

			expect(p.graph.idCache.getAll().has(id)).toBe(false);
		});
	});

	describe('processActiveEditor', () => {
		it('processes lines when a MarkdownView is active', async () => {
			const p = plugin as PluginInternals;

			const lines = ['- [ ] Parent', '\t- [ ] Child'];
			const mockEditor = createEditor(lines, { line: 0, ch: 0 });

			p.app.workspace.getActiveViewOfType = () => ({ editor: mockEditor });

			await plugin.onload();

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(mockEditor.setLine).toHaveBeenCalled();
		});
	});

	describe('cursor-line-watcher wiring', () => {
		it('routes a cursor line change through the debounce, not a direct synchronous call', async () => {
			const p = plugin as PluginInternals;

			const lines = ['- [ ] Parent', '\t- [ ] Child'];
			const mockEditor = createEditor(lines, { line: 0, ch: 0 });
			p.app.workspace.getActiveViewOfType = () => ({ editor: mockEditor });

			await plugin.onload();

			const ext = p._registeredEditorExtensions[0] as CapturedUpdateListener;

			// First observation only records the line; must not fire yet.
			ext.fn(fakeCursorUpdate({ selectionSet: true, lineForHead: 1 }));
			expect(mockEditor.setLine).not.toHaveBeenCalled();

			// Moving to a different line schedules a debounced pass, not an
			// immediate one: nothing happens before the timer fires.
			vi.useFakeTimers();
			ext.fn(fakeCursorUpdate({ selectionSet: true, lineForHead: 2 }));
			expect(mockEditor.setLine).not.toHaveBeenCalled();

			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(mockEditor.setLine).toHaveBeenCalled();
		});
	});
});
