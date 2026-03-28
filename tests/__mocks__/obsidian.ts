/**
 * Mock of the obsidian module for testing.
 * The real `obsidian` npm package is type-only (no runtime JS).
 * This provides runtime stubs that capture event registrations and
 * allow full plugin instantiation in vitest.
 */

export class Component {
	_registeredEvents: unknown[] = [];

	registerEvent(eventRef: unknown): void {
		this._registeredEvents.push(eventRef);
	}
}

/**
 * Event registration helper that captures callbacks.
 * Each `on(name, cb)` call stores `{ name, cb }` so tests can retrieve
 * and invoke the callbacks.
 */
class EventEmitterStub {
	_handlers: Array<{ name: string; cb: (...args: unknown[]) => unknown }> = [];

	on(name: string, cb: (...args: unknown[]) => unknown) {
		const ref = { name, cb };
		this._handlers.push(ref);
		return ref;
	}

	/** Retrieve all handlers registered for a given event name. */
	getHandlers(name: string) {
		return this._handlers.filter((h) => h.name === name);
	}
}

export class Plugin extends Component {
	_vaultEmitter = new EventEmitterStub();
	_workspaceEmitter = new EventEmitterStub();
	_layoutReadyCb: (() => void) | null = null;

	app = {
		vault: Object.assign(this._vaultEmitter, {
			getConfig: (_key: string): unknown => undefined,
			getMarkdownFiles: (): TFile[] => [],
			cachedRead: async (_file: TFile): Promise<string> => '',
		}),
		workspace: Object.assign(this._workspaceEmitter, {
			onLayoutReady: (cb: () => void) => {
				(this as Plugin)._layoutReadyCb = cb;
			},
			getActiveViewOfType: (_type: unknown): unknown => null,
		}),
	};

	async onload(): Promise<void> {
		// stub — overridden by subclass
	}

	onunload(): void {
		// stub — overridden by subclass
	}

	registerInterval(_id: number): number {
		return 0;
	}

	addCommand(_command: unknown): unknown {
		return {};
	}

	addSettingTab(_settingTab: unknown): void {
		// stub
	}

	async loadData(): Promise<unknown> {
		return {};
	}

	async saveData(_data: unknown): Promise<void> {
		// stub
	}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;

	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}

	display(): void {
		// stub
	}

	hide(): void {
		// stub
	}
}

export class MarkdownView {
	editor: unknown = {};
}

export class TFile {
	path = '';
	name = '';
	extension = 'md';
}

export class Notice {
	constructor(_message: string) {
		// stub
	}
}
