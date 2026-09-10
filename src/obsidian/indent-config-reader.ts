/**
 * Reads the vault's indentation settings.
 *
 * Obsidian exposes `getConfig` on the vault at runtime but does not
 * declare it in its published typings, so the cast lives here instead of
 * in the composition root. A missing key means the user never changed
 * that setting, so Obsidian's own defaults apply: tabs on, four columns
 * per tab.
 */

import type { Vault } from 'obsidian';
import type { IndentConfig } from '../parsing/task-parser';

/** The undeclared settings surface Obsidian attaches to `Vault`. */
interface ConfigurableVault {
	getConfig(key: string): unknown;
}

export class IndentConfigReader {
	constructor(private readonly vault: Vault) {}

	/** Returns the vault's indentation settings, falling back to Obsidian's defaults. */
	read(): IndentConfig {
		const source = this.vault as unknown as ConfigurableVault;
		return {
			useTab: (source.getConfig('useTab') as boolean | undefined) ?? true,
			tabSize: (source.getConfig('tabSize') as number | undefined) ?? 4,
		};
	}
}
