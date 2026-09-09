import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import TasksAutoDependencyLinker from '../src/main';
import type { CapturedUpdateListener } from './__mocks__/codemirror-view';
import type { ViewUpdate } from '@codemirror/view';

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

		it('uses useTab:true as default when vault.getConfig returns undefined', async () => {
			const p = plugin as PluginInternals;

			// Provide a space-indented task. With useTab:true (default),
			// spaces should NOT count as indentation, so no parent is found
			const mockEditor = {
				lineCount: () => 2,
				getLine: (n: number) => {
					if (n === 0) return '- [ ] Parent';
					if (n === 1) return '    - [ ] Child with spaces';
					throw new RangeError(`out of bounds: ${n}`);
				},
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
			};
			p.app.workspace.getActiveViewOfType = () => ({ editor: mockEditor });

			await plugin.onload();

			// Trigger editor-change → debounce → processActiveEditor
			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			// With useTab:true, spaces are ignored → no parent found → no setLine
			expect(mockEditor.setLine).not.toHaveBeenCalled();
		});

		it('reads useTab:false from vault config so spaces count as indentation', async () => {
			const p = plugin as PluginInternals;

			p.app.vault.getConfig = (key: string) => {
				if (key === 'useTab') return false;
				if (key === 'tabSize') return 4;
				return undefined;
			};

			const mockEditor = {
				lineCount: () => 2,
				getLine: (n: number) => {
					if (n === 0) return '- [ ] Parent';
					if (n === 1) return '    - [ ] Child with spaces';
					throw new RangeError(`out of bounds: ${n}`);
				},
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
			};
			p.app.workspace.getActiveViewOfType = () => ({ editor: mockEditor });

			await plugin.onload();

			// Trigger
			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			vi.useFakeTimers();
			wsHandlers[0].cb();
			vi.advanceTimersByTime(300);
			vi.useRealTimers();

			// With useTab:false, 4 spaces = 1 indent → parent found → setLine called
			expect(mockEditor.setLine).toHaveBeenCalled();
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
		it('updates cache when a .md file is modified', async () => {
			const p = plugin as PluginInternals;
			const readSpy = vi.fn(async () => '- [ ] Task \u{1F194} ccc333');
			p.app.vault.cachedRead = readSpy;

			await plugin.onload();

			const modifyHandlers = p._vaultEmitter.getHandlers('modify');
			const mdFile = new TFile();
			mdFile.extension = 'md';

			await modifyHandlers[0].cb(mdFile);

			expect(readSpy).toHaveBeenCalledWith(mdFile);
		});

		it('ignores non-md files', async () => {
			const p = plugin as PluginInternals;
			const readSpy = vi.fn(async () => '');
			p.app.vault.cachedRead = readSpy;

			await plugin.onload();

			const modifyHandlers = p._vaultEmitter.getHandlers('modify');
			const cssFile = new TFile();
			cssFile.extension = 'css';

			await modifyHandlers[0].cb(cssFile);

			expect(readSpy).not.toHaveBeenCalled();
		});
	});

	describe('vault delete handler', () => {
		it('forgets a deleted file so its ids no longer protect dependents', async () => {
			const p = plugin as PluginInternals;
			p.app.vault.getMarkdownFiles = () => [];
			p.app.vault.cachedRead = vi.fn(async (file: TFile) => {
				if (file.path === 'a.md') {
					return '- [ ] Task \u{1F194} aaa111';
				}
				return '';
			});

			await plugin.onload();

			const fileA = new TFile();
			fileA.path = 'a.md';
			await p.coordinator.updateForFile(fileA);
			expect(p.idCache.getAll().has('aaa111')).toBe(true);

			const deleteHandlers = p._vaultEmitter.getHandlers('delete');
			expect(deleteHandlers.length).toBe(1);
			deleteHandlers[0].cb(fileA);

			expect(p.idCache.getAll().has('aaa111')).toBe(false);
		});

		it('drops descendants of a deleted folder path', async () => {
			const p = plugin as PluginInternals;
			p.app.vault.getMarkdownFiles = () => [];
			p.app.vault.cachedRead = vi.fn(
				async () => '- [ ] Task \u{1F194} nested1',
			);

			await plugin.onload();

			const fileA = new TFile();
			fileA.path = 'notes/a.md';
			await p.coordinator.updateForFile(fileA);
			expect(p.idCache.getAll().has('nested1')).toBe(true);

			const folder = new TFolder();
			folder.path = 'notes';
			const deleteHandlers = p._vaultEmitter.getHandlers('delete');
			deleteHandlers[0].cb(folder);

			expect(p.idCache.getAll().has('nested1')).toBe(false);
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
		it('seeds the arbiter snapshot from the opened file\'s on-disk content', async () => {
			const p = plugin as PluginInternals;
			const file = new TFile();
			file.path = 'opened.md';
			file.extension = 'md';
			p.app.vault.cachedRead = vi.fn(async () => '- [ ] Task \u{1F194} abc123');

			await plugin.onload();
			const seedSpy = vi.spyOn(p.arbiter, 'seedFromText');

			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			expect(fileOpenHandlers.length).toBe(1);
			await fileOpenHandlers[0].cb(file);

			expect(p.app.vault.cachedRead).toHaveBeenCalledWith(file);
			expect(seedSpy).toHaveBeenCalledWith('opened.md', '- [ ] Task \u{1F194} abc123');
			seedSpy.mockRestore();
		});

		it('does nothing when no file is open (null)', async () => {
			const p = plugin as PluginInternals;
			const readSpy = vi.fn(async () => '');
			p.app.vault.cachedRead = readSpy;

			await plugin.onload();

			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			await fileOpenHandlers[0].cb(null);

			expect(readSpy).not.toHaveBeenCalled();
		});

		it('ignores non-md files', async () => {
			const p = plugin as PluginInternals;
			const readSpy = vi.fn(async () => '');
			p.app.vault.cachedRead = readSpy;

			await plugin.onload();

			const cssFile = new TFile();
			cssFile.extension = 'css';
			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			await fileOpenHandlers[0].cb(cssFile);

			expect(readSpy).not.toHaveBeenCalled();
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

			const mockEditor = {
				lineCount: () => 2,
				getLine: (n: number) => {
					if (n === 0) return '- [ ] Parent';
					if (n === 1) return '\t- [ ] Child';
					throw new RangeError(`out of bounds: ${n}`);
				},
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
			};

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

			const mockEditor = {
				lineCount: () => 1,
				getLine: () => '- [ ] Root task',
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
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

			const mockEditor = {
				lineCount: () => 1,
				getLine: () => '- [ ] Root task',
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
			};

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

			const mockEditor = {
				lineCount: () => 1,
				getLine: () => '- [ ] Root task',
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
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

			const mockEditor = {
				lineCount: () => 1,
				getLine: () => '- [ ] Root task',
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
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

			const mockEditor = {
				lineCount: () => 1,
				getLine: () => '- [ ] Root task',
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
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

			const mockEditor = {
				lineCount: () => 2,
				getLine: (n: number) => {
					if (n === 0) return '- [ ] Parent';
					if (n === 1) return '\t- [ ] Child';
					throw new RangeError(`out of bounds: ${n}`);
				},
				setLine: vi.fn(),
				getCursor: () => ({ line: 0, ch: 0 }),
				setSelection: vi.fn(),
			};
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
