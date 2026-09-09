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
 * extension registered by `main.ts`'s `buildComponents()`. Only the fields
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
		it('does nothing when Tasks plugin is not enabled', async () => {
			const p = plugin as PluginInternals;
			p.app.plugins.enabledPlugins = new Set<string>();

			await plugin.onload();

			// No events should be registered
			const vaultHandlers = p._vaultEmitter.getHandlers('modify');
			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			expect(vaultHandlers.length).toBe(0);
			expect(wsHandlers.length).toBe(0);
			expect(p._layoutReadyCb).toBeNull();
			expect(p._registeredEvents.length).toBe(0);
		});

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

		it('does not set up debounce when Tasks plugin is missing', async () => {
			const p = plugin as PluginInternals;
			p.app.plugins.enabledPlugins = new Set<string>();

			await plugin.onload();

			// onunload should not throw even though debounce was never set up
			expect(() => plugin.onunload()).not.toThrow();
		});
	});

	describe('onload', () => {
		it('registers vault modify and workspace editor-change events', async () => {
			await plugin.onload();

			const p = plugin as PluginInternals;
			const vaultHandlers = p._vaultEmitter.getHandlers('modify');
			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');

			expect(vaultHandlers.length).toBe(1);
			expect(wsHandlers.length).toBe(1);
		});

		it('stores event refs via registerEvent', async () => {
			await plugin.onload();

			const p = plugin as PluginInternals;
			expect(p._registeredEvents.length).toBe(5);
		});

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

	describe('onunload', () => {
		it('cancels a pending debounce timer', async () => {
			await plugin.onload();

			// Trigger an editor-change so a debounce timer is pending
			const p = plugin as PluginInternals;
			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');

			vi.useFakeTimers();
			wsHandlers[0].cb();

			// Spy on the processActiveEditor effect via getActiveViewOfType
			const viewSpy = vi.fn(() => null);
			p.app.workspace.getActiveViewOfType = viewSpy;

			// Unload should cancel the pending timer
			plugin.onunload();

			// Advance past the debounce delay
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			// processActiveEditor should NOT have fired
			expect(viewSpy).not.toHaveBeenCalled();
		});

		it('is safe to call before onload (debounce is undefined)', () => {
			expect(() => plugin.onunload()).not.toThrow();
		});
	});

	describe('buildIdCache (via layoutReady)', () => {
		it('populates the ID cache so existing IDs are known during editing', async () => {
			const p = plugin as PluginInternals;

			const file1 = new TFile();
			file1.path = 'note1.md';

			p.app.vault.getMarkdownFiles = () => [file1];
			p.app.vault.cachedRead = vi.fn(async () => '- [ ] Task \u{1F194} aaa111');

			await plugin.onload();
			await p._layoutReadyCb();

			// After layout ready, an editor-change that assigns a NEW parent
			// should generate an ID that is NOT 'aaa111' (because it's already cached).
			// We verify by checking the cache was populated via integration.
			const buildSpy = vi.spyOn(p.idCache, 'buildFromFiles');

			// Trigger a second layout-ready to check it calls buildFromFiles
			await p._layoutReadyCb();
			expect(buildSpy).toHaveBeenCalledWith([
				{ path: 'note1.md', content: '- [ ] Task \u{1F194} aaa111' },
			]);
			buildSpy.mockRestore();
		});

		it('handles empty vault gracefully (empty files array)', async () => {
			const p = plugin as PluginInternals;
			p.app.vault.getMarkdownFiles = () => [];

			await plugin.onload();

			const buildSpy = vi.spyOn(p.idCache, 'buildFromFiles');
			await p._layoutReadyCb();

			expect(buildSpy).toHaveBeenCalledWith([]);
			buildSpy.mockRestore();
		});
	});

	describe('vault modify handler', () => {
		const modifyCases = [
			{ name: 'updates cache when a .md file is modified', extension: 'md', expectRead: true },
			{ name: 'ignores non-md files', extension: 'css', expectRead: false },
		];

		it.each(modifyCases)('$name', async ({ extension, expectRead }) => {
			const p = plugin as PluginInternals;
			const readSpy = vi.fn(async () => '- [ ] Task \u{1F194} ccc333');
			p.app.vault.cachedRead = readSpy;

			await plugin.onload();

			const modifyHandlers = p._vaultEmitter.getHandlers('modify');
			const file = new TFile();
			file.extension = extension;

			await modifyHandlers[0].cb(file);

			expect(readSpy.mock.calls).toEqual(expectRead ? [[file]] : []);
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
			await p.coordinator.updateForFile(seedFile);
			expect(p.idCache.getAll().has(id)).toBe(true);

			const deleteHandlers = p._vaultEmitter.getHandlers('delete');
			expect(deleteHandlers.length).toBe(1);
			deleteHandlers[0].cb(makeDeleteTarget(seedFile));

			expect(p.idCache.getAll().has(id)).toBe(false);
		});
	});

	describe('vault rename handler', () => {
		it('forgets the old path and re-indexes the file under the new path when a TFile is renamed', async () => {
			const p = plugin as PluginInternals;
			p.app.vault.getMarkdownFiles = () => [];
			p.app.vault.cachedRead = vi.fn(async () => '- [ ] Task \u{1F194} renamed1');

			await plugin.onload();

			const oldFile = new TFile();
			oldFile.path = 'old.md';
			await p.coordinator.updateForFile(oldFile);
			expect(p.idCache.getAll().has('renamed1')).toBe(true);

			const renamedFile = new TFile();
			renamedFile.path = 'new.md';

			const renameHandlers = p._vaultEmitter.getHandlers('rename');
			expect(renameHandlers.length).toBe(1);
			await renameHandlers[0].cb(renamedFile, 'old.md');

			// old path's contribution is gone, new path's content re-indexed
			expect(p.idCache.getAll().has('renamed1')).toBe(true);
		});

		it('rebuilds the whole vault cache when a TFolder is renamed', async () => {
			const p = plugin as PluginInternals;
			const fileInFolder = new TFile();
			fileInFolder.path = 'newfolder/a.md';
			p.app.vault.getMarkdownFiles = () => [fileInFolder];
			p.app.vault.cachedRead = vi.fn(async () => '- [ ] Task \u{1F194} folder1');

			await plugin.onload();

			const buildSpy = vi.spyOn(p.idCache, 'buildFromFiles');

			const renamedFolder = new TFolder();
			renamedFolder.path = 'newfolder';

			const renameHandlers = p._vaultEmitter.getHandlers('rename');
			await renameHandlers[0].cb(renamedFolder, 'oldfolder');

			expect(buildSpy).toHaveBeenCalledWith([
				{ path: 'newfolder/a.md', content: '- [ ] Task \u{1F194} folder1' },
			]);
			buildSpy.mockRestore();
		});
	});

	describe('file-open handler', () => {
		const openedFile = new TFile();
		openedFile.path = 'opened.md';
		openedFile.extension = 'md';

		const nonMdFile = new TFile();
		nonMdFile.extension = 'css';

		const fileOpenCases = [
			{
				name: 'seeds the arbiter snapshot from the opened file\'s on-disk content',
				file: openedFile as TFile | null,
				expectSeeded: true,
			},
			{ name: 'does nothing when no file is open (null)', file: null, expectSeeded: false },
			{ name: 'ignores non-md files', file: nonMdFile as TFile | null, expectSeeded: false },
		];

		it.each(fileOpenCases)('$name', async ({ file, expectSeeded }) => {
			const p = plugin as PluginInternals;
			const content = '- [ ] Task \u{1F194} abc123';
			const readSpy = vi.fn(async () => content);
			p.app.vault.cachedRead = readSpy;

			await plugin.onload();
			const seedSpy = vi.spyOn(p.arbiter, 'seedFromText');

			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			expect(fileOpenHandlers.length).toBe(1);
			await fileOpenHandlers[0].cb(file);

			expect(readSpy.mock.calls).toEqual(expectSeeded ? [[file]] : []);
			expect(seedSpy.mock.calls).toEqual(expectSeeded && file ? [[file.path, content]] : []);
			seedSpy.mockRestore();
		});
	});

	describe('processActiveEditor', () => {
		it('does nothing when no active MarkdownView exists', async () => {
			const p = plugin as PluginInternals;
			const viewSpy = vi.fn(() => null);
			p.app.workspace.getActiveViewOfType = viewSpy;

			await plugin.onload();

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(viewSpy).toHaveBeenCalled();
		});

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

		it('passes current file path to getAllExcluding for cross-file awareness', async () => {
			const p = plugin as PluginInternals;

			const lines = ['- [ ] Root task'];
			const mockEditor = {
				...createEditor(lines, { line: 0, ch: 0 }),
				getValue: vi.fn(() => '- [ ] Root task'),
			};

			p.app.workspace.getActiveViewOfType = () => ({
				editor: mockEditor,
				file: { path: 'folder/current.md' },
			});

			await plugin.onload();

			const excludeSpy = vi.spyOn(p.idCache, 'getAllExcluding');

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(excludeSpy).toHaveBeenCalledWith('folder/current.md');
			excludeSpy.mockRestore();
		});

		it('uses empty string when view.file is null', async () => {
			const p = plugin as PluginInternals;

			const lines = ['- [ ] Root task'];
			const mockEditor = createEditor(lines, { line: 0, ch: 0 });

			// view.file is undefined (no file property)
			p.app.workspace.getActiveViewOfType = () => ({
				editor: mockEditor,
			});

			await plugin.onload();

			const excludeSpy = vi.spyOn(p.idCache, 'getAllExcluding');

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(excludeSpy).toHaveBeenCalledWith('');
			excludeSpy.mockRestore();
		});

		it('refreshes the coordinator with the live editor content after processing, for a file-backed view', async () => {
			const p = plugin as PluginInternals;

			const lines = ['- [ ] Root task'];
			const mockEditor = {
				...createEditor(lines, { line: 0, ch: 0 }),
				getValue: vi.fn(() => '- [ ] Root task \u{1F194} live1'),
			};

			p.app.workspace.getActiveViewOfType = () => ({
				editor: mockEditor,
				file: { path: 'folder/current.md' },
			});

			await plugin.onload();

			const liveSpy = vi.spyOn(p.coordinator, 'updateFromLiveContent');

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(liveSpy).toHaveBeenCalledWith(
				'folder/current.md',
				'- [ ] Root task \u{1F194} live1',
			);
			liveSpy.mockRestore();
		});

		it('does not refresh the coordinator with live content when the view has no backing file', async () => {
			const p = plugin as PluginInternals;

			const lines = ['- [ ] Root task'];
			const mockEditor = {
				...createEditor(lines, { line: 0, ch: 0 }),
				getValue: vi.fn(() => '- [ ] Root task'),
			};

			// view.file is undefined: a file-less markdown buffer
			p.app.workspace.getActiveViewOfType = () => ({ editor: mockEditor });

			await plugin.onload();

			const liveSpy = vi.spyOn(p.coordinator, 'updateFromLiveContent');

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(liveSpy).not.toHaveBeenCalled();
			expect(mockEditor.getValue).not.toHaveBeenCalled();
			liveSpy.mockRestore();
		});

		it('refreshes the live cache only after processAllLines has finished writing markers', async () => {
			const p = plugin as PluginInternals;
			const callOrder: string[] = [];

			const lines = ['- [ ] Root task'];
			const mockEditor = {
				...createEditor(lines, { line: 0, ch: 0 }),
				getValue: vi.fn(() => {
					callOrder.push('getValue');
					return '- [ ] Root task \u{1F194} order1';
				}),
			};

			p.app.workspace.getActiveViewOfType = () => ({
				editor: mockEditor,
				file: { path: 'folder/order.md' },
			});

			await plugin.onload();

			vi.spyOn(p.processor, 'processAllLines').mockImplementation(() => {
				callOrder.push('processAllLines');
			});
			vi.spyOn(p.coordinator, 'updateFromLiveContent').mockImplementation(() => {
				callOrder.push('updateFromLiveContent');
			});

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			expect(callOrder).toEqual(['processAllLines', 'getValue', 'updateFromLiveContent']);
		});
	});

	describe('cursor-line-watcher wiring (buildComponents)', () => {
		it('registers exactly one editor extension during onload', async () => {
			const p = plugin as PluginInternals;

			await plugin.onload();

			expect(p._registeredEditorExtensions.length).toBe(1);
		});

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
