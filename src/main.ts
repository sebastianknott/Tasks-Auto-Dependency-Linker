import { Plugin } from 'obsidian';

export default class TasksAutoDependencyLinker extends Plugin {
	async onload() {
		// TODO: Wire up editor-change events and ID cache
	}

	onunload() {
		// Cleanup handled automatically via registerEvent()
	}
}
