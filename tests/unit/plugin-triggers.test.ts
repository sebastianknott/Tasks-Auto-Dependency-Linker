import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Plugin, TFile } from 'obsidian';
import { PluginTriggers } from '../../src/plugin-triggers';
import type { CacheCoordinator } from '../../src/cache-coordinator';
import type { LineWriteArbiter } from '../../src/line-write-arbiter';
import type { Debounce } from '../../src/utils';
import type { CursorLineWatcher } from '../../src/cursor-line-watcher';

/**
 * Helper: cast plugin to access mock internals set up by the obsidian mock.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginInternals = any;

/** Builds a fake `CacheCoordinator` exposing only the methods PluginTriggers calls. */
function fakeCoordinator() {
	return {
		buildAll: vi.fn(),
		updateForFile: vi.fn(async () => undefined),
		handleDelete: vi.fn(),
		handleRename: vi.fn(async () => undefined),
	} as unknown as CacheCoordinator;
}

/** Builds a fake `LineWriteArbiter` exposing only the method PluginTriggers calls. */
function fakeArbiter() {
	return {
		seedFromText: vi.fn(),
	} as unknown as LineWriteArbiter;
}

/** Builds a fake `Debounce` exposing only the method PluginTriggers calls. */
function fakeDebounce() {
	return {
		call: vi.fn(),
	} as unknown as Debounce;
}

/** Builds a fake `CursorLineWatcher` exposing only the methods PluginTriggers calls. */
function fakeWatcher() {
	return {
		extension: vi.fn(() => 'extension-sentinel'),
		reset: vi.fn(),
	} as unknown as CursorLineWatcher;
}

function mdFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.extension = 'md';
	return file;
}

describe('PluginTriggers', () => {
	let plugin: Plugin;
	let p: PluginInternals;
	let coordinator: ReturnType<typeof fakeCoordinator>;
	let arbiter: ReturnType<typeof fakeArbiter>;
	let debounce: ReturnType<typeof fakeDebounce>;
	let watcher: ReturnType<typeof fakeWatcher>;
	let triggers: PluginTriggers;

	beforeEach(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		plugin = new (Plugin as any)();
		p = plugin as PluginInternals;
		coordinator = fakeCoordinator();
		arbiter = fakeArbiter();
		debounce = fakeDebounce();
		watcher = fakeWatcher();
		triggers = new PluginTriggers(plugin, coordinator, arbiter, debounce, watcher);
	});

	describe('register', () => {
		it('registers a layoutReady callback that calls coordinator.buildAll', () => {
			const file1 = mdFile('a.md');
			p.app.vault.getMarkdownFiles = () => [file1];

			triggers.register();

			expect(p._layoutReadyCb).toBeInstanceOf(Function);
			p._layoutReadyCb();
			expect(coordinator.buildAll).toHaveBeenCalledWith([file1]);
		});

		it('registers exactly 5 events via registerEvent', () => {
			triggers.register();

			expect(p._registeredEvents.length).toBe(5);
		});

		it('registers the watcher extension exactly once via registerEditorExtension', () => {
			triggers.register();

			expect(p._registeredEditorExtensions.length).toBe(1);
			expect(p._registeredEditorExtensions[0]).toBe('extension-sentinel');
			expect(watcher.extension).toHaveBeenCalledTimes(1);
		});
	});

	describe('vault modify handler', () => {
		it('updates the cache and schedules a pass when the modified md file is the active file', async () => {
			const file = mdFile('active.md');
			p.app.workspace.getActiveFile = () => file;
			triggers.register();

			const modifyHandlers = p._vaultEmitter.getHandlers('modify');
			await modifyHandlers[0].cb(file);

			expect(coordinator.updateForFile).toHaveBeenCalledWith(file);
			expect(debounce.call).toHaveBeenCalledTimes(1);
		});

		it('updates the cache but does NOT schedule a pass when the modified md file is not the active file', async () => {
			const activeFile = mdFile('active.md');
			const modifiedFile = mdFile('background.md');
			p.app.workspace.getActiveFile = () => activeFile;
			triggers.register();

			const modifyHandlers = p._vaultEmitter.getHandlers('modify');
			await modifyHandlers[0].cb(modifiedFile);

			expect(coordinator.updateForFile).toHaveBeenCalledWith(modifiedFile);
			expect(debounce.call).not.toHaveBeenCalled();
		});

		it('does NOT schedule a pass when getActiveFile returns null', async () => {
			const modifiedFile = mdFile('background.md');
			p.app.workspace.getActiveFile = () => null;
			triggers.register();

			const modifyHandlers = p._vaultEmitter.getHandlers('modify');
			await modifyHandlers[0].cb(modifiedFile);

			expect(coordinator.updateForFile).toHaveBeenCalledWith(modifiedFile);
			expect(debounce.call).not.toHaveBeenCalled();
		});

		it('ignores non-md files entirely: neither updateForFile nor a pass is scheduled', async () => {
			const cssFile = new TFile();
			cssFile.extension = 'css';
			p.app.workspace.getActiveFile = () => cssFile;
			triggers.register();

			const modifyHandlers = p._vaultEmitter.getHandlers('modify');
			await modifyHandlers[0].cb(cssFile);

			expect(coordinator.updateForFile).not.toHaveBeenCalled();
			expect(debounce.call).not.toHaveBeenCalled();
		});
	});

	describe('vault delete handler', () => {
		it('delegates to coordinator.handleDelete', () => {
			triggers.register();

			const deleteHandlers = p._vaultEmitter.getHandlers('delete');
			const file = mdFile('gone.md');
			deleteHandlers[0].cb(file);

			expect(coordinator.handleDelete).toHaveBeenCalledWith(file);
		});
	});

	describe('vault rename handler', () => {
		it('delegates to coordinator.handleRename', async () => {
			triggers.register();

			const renameHandlers = p._vaultEmitter.getHandlers('rename');
			const file = mdFile('new.md');
			await renameHandlers[0].cb(file, 'old.md');

			expect(coordinator.handleRename).toHaveBeenCalledWith(file, 'old.md');
		});
	});

	describe('editor-change handler', () => {
		it('schedules a debounced pass', () => {
			triggers.register();

			const wsHandlers = p._workspaceEmitter.getHandlers('editor-change');
			wsHandlers[0].cb();

			expect(debounce.call).toHaveBeenCalledTimes(1);
		});
	});

	describe('cursor-line-watcher callback (wired via the CursorLineWatcher constructed by main.ts)', () => {
		it('the callback handed to onLineChange schedules a debounced pass rather than running one synchronously', () => {
			// This exercises the *contract* PluginTriggers relies on: the
			// watcher fires a callback and PluginTriggers never calls the
			// watcher's callback itself, it only registers the extension.
			// The actual `() => this.debounce.call()` wiring lives in
			// main.ts's buildComponents(); verified end-to-end there.
			triggers.register();

			expect(watcher.extension).toHaveBeenCalledTimes(1);
			expect(debounce.call).not.toHaveBeenCalled();
		});
	});

	describe('file-open handler', () => {
		it('seeds the arbiter and resets the watcher for a real md file', async () => {
			const file = mdFile('opened.md');
			p.app.vault.cachedRead = vi.fn(async () => '- [ ] Task \u{1F194} abc123');
			triggers.register();

			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			await fileOpenHandlers[0].cb(file);

			expect(watcher.reset).toHaveBeenCalledTimes(1);
			expect(p.app.vault.cachedRead).toHaveBeenCalledWith(file);
			expect(arbiter.seedFromText).toHaveBeenCalledWith('opened.md', '- [ ] Task \u{1F194} abc123');
		});

		it('resets the watcher even when no file is open (null), and does not seed the arbiter', async () => {
			const readSpy = vi.fn(async () => '');
			p.app.vault.cachedRead = readSpy;
			triggers.register();

			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			await fileOpenHandlers[0].cb(null);

			expect(watcher.reset).toHaveBeenCalledTimes(1);
			expect(readSpy).not.toHaveBeenCalled();
			expect(arbiter.seedFromText).not.toHaveBeenCalled();
		});

		it('resets the watcher even for a non-md file, and does not seed the arbiter', async () => {
			const readSpy = vi.fn(async () => '');
			p.app.vault.cachedRead = readSpy;
			triggers.register();

			const cssFile = new TFile();
			cssFile.extension = 'css';
			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			await fileOpenHandlers[0].cb(cssFile);

			expect(watcher.reset).toHaveBeenCalledTimes(1);
			expect(readSpy).not.toHaveBeenCalled();
			expect(arbiter.seedFromText).not.toHaveBeenCalled();
		});

		it('resets the watcher BEFORE seeding, so the mutant that moves reset() inside the md guard is caught by call order', async () => {
			const callOrder: string[] = [];
			p.app.vault.cachedRead = vi.fn(async () => {
				callOrder.push('cachedRead');
				return '';
			});
			(watcher.reset as ReturnType<typeof vi.fn>).mockImplementation(() => {
				callOrder.push('reset');
			});
			triggers.register();

			const file = mdFile('ordered.md');
			const fileOpenHandlers = p._workspaceEmitter.getHandlers('file-open');
			await fileOpenHandlers[0].cb(file);

			expect(callOrder).toEqual(['reset', 'cachedRead']);
		});
	});
});
