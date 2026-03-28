/**
 * Mock of the obsidian module for testing.
 * The real `obsidian` npm package is type-only (no runtime JS).
 * This provides minimal runtime stubs so modules that import from
 * 'obsidian' can be loaded in vitest.
 */

export class Plugin {
	app: unknown = {};

	async onload(): Promise<void> {
		// stub
	}

	onunload(): void {
		// stub
	}

	registerEvent(_eventRef: unknown): void {
		// stub
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

export class Notice {
	constructor(_message: string) {
		// stub
	}
}
