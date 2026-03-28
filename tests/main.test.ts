import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import TasksAutoDependencyLinker from '../src/main';

/**
 * Helper: cast plugin to access mock internals set up by the obsidian mock.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginInternals = any;

describe('TasksAutoDependencyLinker', () => {
	let plugin: TasksAutoDependencyLinker;

	beforeEach(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		plugin = new (TasksAutoDependencyLinker as any)();
	});

	it('exports a default class', () => {
		expect(TasksAutoDependencyLinker).toBeDefined();
		expect(typeof TasksAutoDependencyLinker).toBe('function');
	});

	it('has onload and onunload methods on its prototype', () => {
		expect(typeof plugin.onload).toBe('function');
		expect(typeof plugin.onunload).toBe('function');
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
			expect(p._registeredEvents.length).toBe(2);
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

			// Provide a space-indented task — with useTab:true (default),
			// spaces should NOT count as indentation, so no parent is found
			const mockEditor = {
				lineCount: () => 2,
				getLine: (n: number) => {
					if (n === 0) return '- [ ] Parent';
					if (n === 1) return '    - [ ] Child with spaces';
					throw new RangeError(`out of bounds: ${n}`);
				},
				setLine: vi.fn(),
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

			// Spy on the processActiveEditor effect — getActiveViewOfType
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
			// The simplest proof: spy on IdCache.buildFromContents
			const buildSpy = vi.spyOn(p.idCache, 'buildFromContents');

			// Trigger a second layout-ready to check it calls buildFromContents
			await p._layoutReadyCb();
			expect(buildSpy).toHaveBeenCalledWith(['- [ ] Task \u{1F194} aaa111']);
			buildSpy.mockRestore();
		});

		it('handles empty vault gracefully (empty contents array)', async () => {
			const p = plugin as PluginInternals;
			p.app.vault.getMarkdownFiles = () => [];

			await plugin.onload();

			const buildSpy = vi.spyOn(p.idCache, 'buildFromContents');
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
	});
});
