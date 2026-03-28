import { describe, it, expect } from 'vitest';

/**
 * main.ts is the plugin entry point that extends Obsidian's Plugin class.
 * Since the `obsidian` package is type-only (no runtime), we cannot instantiate
 * the plugin in unit tests. Integration testing requires a running Obsidian instance.
 *
 * These smoke tests validate the module exports the correct shape.
 */
describe('TasksAutoDependencyLinker', () => {
	it('exports a default class', async () => {
		const module = await import('../src/main');
		expect(module.default).toBeDefined();
		expect(typeof module.default).toBe('function'); // classes are functions
	});

	it('has onload and onunload methods on its prototype', async () => {
		const module = await import('../src/main');
		const proto = module.default.prototype;
		expect(typeof proto.onload).toBe('function');
		expect(typeof proto.onunload).toBe('function');
	});
});
