/**
 * Mock of the obsidian module for testing.
 * The real `obsidian` npm package is type-only (no runtime JS).
 * This provides minimal runtime stubs so modules that import from
 * 'obsidian' can be loaded in vitest.
 */

export class Component {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	registerEvent(_eventRef: unknown): void {
		// stub
	}
}

export class Plugin extends Component {
	app: Record<string, unknown> = {
		vault: {
			getConfig: () => undefined,
			getMarkdownFiles: () => [],
			cachedRead: async () => '',
			on: () => ({ /* EventRef stub */ }),
		},
		workspace: {
			on: () => ({ /* EventRef stub */ }),
			onLayoutReady: (cb: () => void) => cb(),
		},
	};

	async onload(): Promise<void> {
		// stub
	}

	onunload(): void {
		// stub
	}

	registerInterval(_id: number): number {
		return 0;
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	addCommand(_command: unknown): unknown {
		return {};
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	addSettingTab(_settingTab: unknown): void {
		// stub
	}

	async loadData(): Promise<unknown> {
		return {};
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	constructor(_message: string) {
		// stub
	}
}
