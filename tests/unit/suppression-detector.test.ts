import { describe, it, expect, vi, type Mock } from 'vitest';
import { SuppressionDetector } from '../../src/editing/suppression-detector';
import { MarkerType } from '../../src/parsing/marker-accessor';
import type { MarkerAccessorRegistry, MarkerAccessor } from '../../src/parsing/marker-accessor';
import type { LineSnapshotStore, LineSnapshot } from '../../src/editing/line-snapshot-store';
import { createLineEditor } from '../fixtures/editor';

type FakeMarkerAccessor = MarkerAccessor & {
	read: Mock<(line: string) => string | null>;
	apply: Mock<(line: string, value: string) => string>;
	remove: Mock<(line: string) => string>;
	hasFragment: Mock<(line: string) => boolean>;
};

/** Builds a single-value marker accessor double. Every method is a spy answering fixed, per-test data. */
function fakeAccessor(
	type: MarkerType,
	overrides: {
		read?: (line: string) => string | null;
		hasFragment?: (line: string) => boolean;
	} = {},
): FakeMarkerAccessor {
	return {
		type,
		read: vi.fn(overrides.read ?? (() => null)),
		apply: vi.fn((line: string, _value: string) => line),
		remove: vi.fn((line: string) => line),
		hasFragment: vi.fn(overrides.hasFragment ?? (() => false)),
	};
}

type FakeDependencyAccessor = {
	read: Mock<(line: string) => Set<string>>;
	apply: Mock<(line: string, depId: string) => string>;
	remove: Mock<(line: string, depId: string) => string>;
	hasFragment: Mock<(line: string) => boolean>;
};

/** Builds the multi-value dependency accessor double. */
function fakeDependencyAccessor(
	overrides: {
		read?: (line: string) => Set<string>;
		hasFragment?: (line: string) => boolean;
	} = {},
): FakeDependencyAccessor {
	return {
		read: vi.fn(overrides.read ?? (() => new Set<string>())),
		apply: vi.fn((line: string, _depId: string) => line),
		remove: vi.fn((line: string, _depId: string) => line),
		hasFragment: vi.fn(overrides.hasFragment ?? (() => false)),
	};
}

/**
 * Builds a registry double exposing only the members SuppressionDetector
 * reads: `markers` and `dependency`. `DependencyAccessor` carries a private
 * field, so a plain object literal cannot satisfy it structurally; the cast
 * mirrors the one `line-write-arbiter.test.ts` and `metadata-inheritor.test.ts`
 * already use for the same reason.
 */
function fakeRegistry(
	markers: FakeMarkerAccessor[],
	dependency: FakeDependencyAccessor,
): MarkerAccessorRegistry {
	return {
		markers,
		inheritable: markers,
		dependency,
	} as unknown as MarkerAccessorRegistry;
}

type FakeSnapshotStore = {
	get: Mock<(lineIndex: number) => LineSnapshot | undefined>;
	computeBareText: Mock<(line: string) => string>;
};

/**
 * Builds the snapshot store double. SuppressionDetector only ever calls
 * `get` and `computeBareText`, so those are the only members stubbed.
 */
function fakeSnapshotStore(overrides: Partial<FakeSnapshotStore> = {}): LineSnapshotStore {
	return {
		get: vi.fn((): LineSnapshot | undefined => undefined),
		computeBareText: vi.fn((line: string) => line),
		...overrides,
	} as unknown as LineSnapshotStore;
}

/** Builds a prior-pass snapshot with harmless defaults, so a test states only what it cares about. */
function fakeLineSnapshot(overrides: Partial<LineSnapshot> = {}): LineSnapshot {
	return {
		bareText: 'bare',
		markers: new Map<MarkerType, string | null>(),
		deps: new Set<string>(),
		...overrides,
	};
}

describe('SuppressionDetector: trusted-snapshot gating', () => {
	it('reports nothing, and never asks the store for a snapshot, when cursorLine is at the editor line count', () => {
		const registry = fakeRegistry([], fakeDependencyAccessor());
		const snapshotStore = fakeSnapshotStore();
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['only line']);

		const result = detector.observe(target, 1);

		expect(result.newlySuppressedTypes.size).toBe(0);
		expect(result.newlySuppressedDepIds.size).toBe(0);
		expect(result.verifiedTypes.size).toBe(0);
		expect(result.verifiedDepIds.size).toBe(0);
		expect(snapshotStore.get).not.toHaveBeenCalled();
	});

	it('reports nothing when there is no prior snapshot for the cursor line', () => {
		const registry = fakeRegistry([], fakeDependencyAccessor());
		const snapshotStore = fakeSnapshotStore({ get: vi.fn(() => undefined) });
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['line text']);

		const result = detector.observe(target, 0);

		expect(result.newlySuppressedTypes.size).toBe(0);
		expect(result.newlySuppressedDepIds.size).toBe(0);
		expect(result.verifiedTypes.size).toBe(0);
		expect(result.verifiedDepIds.size).toBe(0);
		expect(snapshotStore.get).toHaveBeenCalledWith(0);
		expect(snapshotStore.computeBareText).not.toHaveBeenCalled();
	});

	it('reports nothing when the prior snapshot bareText does not match the current line', () => {
		const priorSnapshot = fakeLineSnapshot({ bareText: 'old bare', deps: new Set(['dep1']) });
		const registry = fakeRegistry([], fakeDependencyAccessor());
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'different bare'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['current line']);

		const result = detector.observe(target, 0);

		expect(result.newlySuppressedDepIds.size).toBe(0);
		expect(result.verifiedDepIds.size).toBe(0);
		expect(snapshotStore.computeBareText).toHaveBeenCalledWith('current line');
	});
});

describe('SuppressionDetector: marker comparison', () => {
	it('marks a marker newly suppressed when the prior value was non-null but the current read differs', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { read: () => null });
		const registry = fakeRegistry([idAccessor], fakeDependencyAccessor());
		const priorSnapshot = fakeLineSnapshot({
			bareText: 'task',
			markers: new Map([[MarkerType.Id, 'abc123']]),
		});
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.newlySuppressedTypes).toEqual(new Set([MarkerType.Id]));
		expect(result.verifiedTypes.size).toBe(0);
		expect(idAccessor.read).toHaveBeenCalledWith('task');
	});

	it('marks a marker verified when the prior value was non-null and the current read is unchanged', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { read: () => 'abc123' });
		const registry = fakeRegistry([idAccessor], fakeDependencyAccessor());
		const priorSnapshot = fakeLineSnapshot({
			bareText: 'task',
			markers: new Map([[MarkerType.Id, 'abc123']]),
		});
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.verifiedTypes).toEqual(new Set([MarkerType.Id]));
		expect(result.newlySuppressedTypes.size).toBe(0);
	});

	it('does not report a marker absent from the prior snapshot as suppressed or verified', () => {
		const priorityAccessor = fakeAccessor(MarkerType.Priority, { read: () => 'high' });
		const registry = fakeRegistry([priorityAccessor], fakeDependencyAccessor());
		const priorSnapshot = fakeLineSnapshot({
			bareText: 'task',
			markers: new Map(),
		});
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.newlySuppressedTypes.size).toBe(0);
		expect(result.verifiedTypes.size).toBe(0);
	});

	it('treats an empty-string prior marker value as present, not absent', () => {
		// Distinguishes the detector's `?? null` from `|| null`: an empty
		// string is falsy but not nullish, so only the nullish-coalescing
		// form leaves it eligible for comparison instead of skipping it.
		const dueAccessor = fakeAccessor(MarkerType.Due, { read: () => '' });
		const registry = fakeRegistry([dueAccessor], fakeDependencyAccessor());
		const priorSnapshot = fakeLineSnapshot({
			bareText: 'task',
			markers: new Map([[MarkerType.Due, '']]),
		});
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.verifiedTypes).toEqual(new Set([MarkerType.Due]));
	});

	it('splits multiple markers independently between suppressed and verified', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { read: () => 'abc123' });
		const dueAccessor = fakeAccessor(MarkerType.Due, { read: () => null });
		const registry = fakeRegistry([idAccessor, dueAccessor], fakeDependencyAccessor());
		const priorSnapshot = fakeLineSnapshot({
			bareText: 'task',
			markers: new Map([
				[MarkerType.Id, 'abc123'],
				[MarkerType.Due, '2024-01-01'],
			]),
		});
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.verifiedTypes).toEqual(new Set([MarkerType.Id]));
		expect(result.newlySuppressedTypes).toEqual(new Set([MarkerType.Due]));
	});
});

describe('SuppressionDetector: dependency comparison', () => {
	it('marks a dependency id newly suppressed when it is missing from the current read', () => {
		const dependency = fakeDependencyAccessor({ read: () => new Set<string>() });
		const registry = fakeRegistry([], dependency);
		const priorSnapshot = fakeLineSnapshot({ bareText: 'task', deps: new Set(['dep1']) });
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.newlySuppressedDepIds).toEqual(new Set(['dep1']));
		expect(result.verifiedDepIds.size).toBe(0);
		expect(dependency.read).toHaveBeenCalledWith('task');
	});

	it('marks a dependency id verified when it is still present in the current read', () => {
		const dependency = fakeDependencyAccessor({ read: () => new Set(['dep1']) });
		const registry = fakeRegistry([], dependency);
		const priorSnapshot = fakeLineSnapshot({ bareText: 'task', deps: new Set(['dep1']) });
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.verifiedDepIds).toEqual(new Set(['dep1']));
		expect(result.newlySuppressedDepIds.size).toBe(0);
	});

	it('splits multiple prior dependency ids independently between suppressed and verified', () => {
		const dependency = fakeDependencyAccessor({ read: () => new Set(['keep']) });
		const registry = fakeRegistry([], dependency);
		const priorSnapshot = fakeLineSnapshot({ bareText: 'task', deps: new Set(['keep', 'gone']) });
		const snapshotStore = fakeSnapshotStore({
			get: vi.fn(() => priorSnapshot),
			computeBareText: vi.fn(() => 'task'),
		});
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['task']);

		const result = detector.observe(target, 0);

		expect(result.verifiedDepIds).toEqual(new Set(['keep']));
		expect(result.newlySuppressedDepIds).toEqual(new Set(['gone']));
	});
});

describe('SuppressionDetector: indeterminate computation', () => {
	it('is false when cursorLine is negative, without reading the line', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { hasFragment: () => true });
		const registry = fakeRegistry([idAccessor], fakeDependencyAccessor());
		const snapshotStore = fakeSnapshotStore();
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['line']);

		const result = detector.observe(target, -1);

		expect(result.indeterminate).toBe(false);
		expect(idAccessor.hasFragment).not.toHaveBeenCalled();
	});

	it('is false when cursorLine is at the line count, without reading the line', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { hasFragment: () => true });
		const registry = fakeRegistry([idAccessor], fakeDependencyAccessor());
		const snapshotStore = fakeSnapshotStore();
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['line']);

		const result = detector.observe(target, 1);

		expect(result.indeterminate).toBe(false);
		expect(idAccessor.hasFragment).not.toHaveBeenCalled();
	});

	it('is true when a marker accessor reports a fragment on the cursor line', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { hasFragment: () => true });
		const dueAccessor = fakeAccessor(MarkerType.Due, { hasFragment: () => false });
		const dependency = fakeDependencyAccessor({ hasFragment: () => false });
		const registry = fakeRegistry([idAccessor, dueAccessor], dependency);
		const snapshotStore = fakeSnapshotStore();
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['line text']);

		const result = detector.observe(target, 0);

		expect(result.indeterminate).toBe(true);
		expect(idAccessor.hasFragment).toHaveBeenCalledWith('line text');
	});

	it('is true when the dependency accessor reports a fragment, even when no marker accessor does', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { hasFragment: () => false });
		const dependency = fakeDependencyAccessor({ hasFragment: () => true });
		const registry = fakeRegistry([idAccessor], dependency);
		const snapshotStore = fakeSnapshotStore();
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['line text']);

		const result = detector.observe(target, 0);

		expect(result.indeterminate).toBe(true);
		expect(dependency.hasFragment).toHaveBeenCalledWith('line text');
	});

	it('is false when neither marker accessors nor the dependency accessor report a fragment', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { hasFragment: () => false });
		const dependency = fakeDependencyAccessor({ hasFragment: () => false });
		const registry = fakeRegistry([idAccessor], dependency);
		const snapshotStore = fakeSnapshotStore();
		const detector = new SuppressionDetector(registry, snapshotStore);
		const target = createLineEditor(['line text']);

		const result = detector.observe(target, 0);

		expect(result.indeterminate).toBe(false);
	});
});
