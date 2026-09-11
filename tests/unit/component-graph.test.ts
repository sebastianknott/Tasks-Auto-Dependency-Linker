import { describe, it, expect, vi } from 'vitest';
import { ComponentGraph } from '../../src/obsidian/component-graph';
import type { VaultReader } from '../../src/cache/cache-coordinator';
import { IdCache, DepCache } from '../../src/cache/marker-cache';
import { MetadataSyncCache } from '../../src/cache/metadata-sync-cache';
import { CacheCoordinator } from '../../src/cache/cache-coordinator';
import { LineWriteArbiter } from '../../src/editing/line-write-arbiter';
import { EditorProcessor } from '../../src/processing/editor-processor';

/**
 * Sociable test for ComponentGraph, the single documented exception to the
 * solitary rule in the plan (docs/solitary-unit-coverage.md, section 3.1).
 *
 * ComponentGraph is pure wiring: one constructor, sixteen `new` expressions,
 * cyclomatic complexity 1. Replacing its sixteen collaborators with doubles
 * would only assert the test's own wiring back at itself. Instead this test
 * constructs the real graph and checks that each of its six published
 * readonly fields holds an instance of the expected class. The class under
 * test is the composition, so exercising the real composition is correct
 * here and nowhere else in this suite.
 */

describe('ComponentGraph', () => {
	it('wires idCache, depCache, syncCache, coordinator, arbiter and processor to real instances', () => {
		const vault: VaultReader = {
			cachedRead: vi.fn(() => Promise.resolve('')),
			getMarkdownFiles: vi.fn(() => []),
		};

		const graph = new ComponentGraph(vault, { useTab: true, tabSize: 4 });

		expect(graph.idCache).toBeInstanceOf(IdCache);
		expect(graph.depCache).toBeInstanceOf(DepCache);
		expect(graph.syncCache).toBeInstanceOf(MetadataSyncCache);
		expect(graph.coordinator).toBeInstanceOf(CacheCoordinator);
		expect(graph.arbiter).toBeInstanceOf(LineWriteArbiter);
		expect(graph.processor).toBeInstanceOf(EditorProcessor);
	});

	it('builds a fresh set of instances on every construction, so plugin reloads do not share state', () => {
		const vault: VaultReader = {
			cachedRead: vi.fn(() => Promise.resolve('')),
			getMarkdownFiles: vi.fn(() => []),
		};

		const first = new ComponentGraph(vault, { useTab: true, tabSize: 4 });
		const second = new ComponentGraph(vault, { useTab: true, tabSize: 4 });

		expect(first.idCache).not.toBe(second.idCache);
		expect(first.arbiter).not.toBe(second.arbiter);
	});
});
