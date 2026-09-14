import { describe, it, expect, vi } from 'vitest';
import { IndentConfigReader } from '../../src/obsidian/indent-config-reader';
import type { Vault } from 'obsidian';

/**
 * `Vault` does not expose `getConfig` in Obsidian's published typings, which
 * is why the production class casts internally. The stub here mirrors that
 * cast rather than the real Obsidian `Vault`.
 */

function createFakeVault(config: Record<string, unknown>): {
	vault: Vault;
	getConfig: ReturnType<typeof vi.fn>;
} {
	const getConfig = vi.fn((key: string) => config[key]);
	const vault = { getConfig } as unknown as Vault;
	return { vault, getConfig };
}

describe('IndentConfigReader', () => {
	it('defaults useTab to true when the vault has no useTab setting', () => {
		const { vault } = createFakeVault({ tabSize: 4 });
		const reader = new IndentConfigReader(vault);

		expect(reader.read().useTab).toBe(true);
	});

	it("returns the vault's useTab setting when one is configured", () => {
		const { vault } = createFakeVault({ useTab: false });
		const reader = new IndentConfigReader(vault);

		expect(reader.read().useTab).toBe(false);
	});

	it('defaults tabSize to 4 when the vault has no tabSize setting', () => {
		const { vault } = createFakeVault({ useTab: true });
		const reader = new IndentConfigReader(vault);

		expect(reader.read().tabSize).toBe(4);
	});

	it("returns the vault's tabSize setting when one is configured", () => {
		const { vault } = createFakeVault({ tabSize: 2 });
		const reader = new IndentConfigReader(vault);

		expect(reader.read().tabSize).toBe(2);
	});

	it('reads useTab and tabSize from the vault by key', () => {
		const { vault, getConfig } = createFakeVault({ useTab: false, tabSize: 2 });
		const reader = new IndentConfigReader(vault);

		reader.read();

		expect(getConfig).toHaveBeenCalledWith('useTab');
		expect(getConfig).toHaveBeenCalledWith('tabSize');
	});
});
