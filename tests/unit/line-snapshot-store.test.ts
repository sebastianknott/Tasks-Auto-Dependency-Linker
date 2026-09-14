import { describe, it, expect, vi, type Mock } from 'vitest';
import { LineSnapshotStore } from '../../src/editing/line-snapshot-store';
import { MarkerType } from '../../src/parsing/marker-accessor';
import type { MarkerAccessorRegistry } from '../../src/parsing/marker-accessor';
import { createLineEditor } from '../fixtures/editor';

interface FakeAccessor {
	type: MarkerType;
	read: Mock<(line: string) => string | null>;
	apply: Mock<(line: string, value: string) => string>;
	remove: Mock<(line: string) => string>;
	hasFragment: Mock<(line: string) => boolean>;
}

interface FakeDependency {
	read: Mock<(line: string) => Set<string>>;
	apply: Mock<(line: string, depId: string) => string>;
	remove: Mock<(line: string, depId: string) => string>;
	hasFragment: Mock<(line: string) => boolean>;
}

interface AccessorBehaviour {
	read?: (line: string) => string | null;
	remove?: (line: string) => string;
}

interface DependencyBehaviour {
	read?: (line: string) => Set<string>;
	remove?: (line: string, depId: string) => string;
}

function fakeAccessor(type: MarkerType, behaviour: AccessorBehaviour = {}): FakeAccessor {
	return {
		type,
		read: vi.fn(behaviour.read ?? ((): string | null => null)),
		apply: vi.fn((line: string) => line),
		remove: vi.fn(behaviour.remove ?? ((line: string) => line)),
		hasFragment: vi.fn(() => false),
	};
}

function fakeDependency(behaviour: DependencyBehaviour = {}): FakeDependency {
	return {
		read: vi.fn(behaviour.read ?? (() => new Set<string>())),
		apply: vi.fn((line: string) => line),
		remove: vi.fn(behaviour.remove ?? ((line: string) => line)),
		hasFragment: vi.fn(() => false),
	};
}

function buildStore(
	markers: FakeAccessor[] = [],
	dependency: FakeDependency = fakeDependency(),
): LineSnapshotStore {
	const registry = {
		markers,
		inheritable: markers,
		dependency,
	} as unknown as MarkerAccessorRegistry;
	return new LineSnapshotStore(registry);
}

describe('LineSnapshotStore: get', () => {
	it('returns undefined for a line with no snapshot entry yet', () => {
		const store = buildStore();

		expect(store.get(0)).toBeUndefined();
	});

	it('returns the entry captured by rebuildAll', () => {
		const store = buildStore([fakeAccessor(MarkerType.Id, { read: () => 'abc' })]);

		store.rebuildAll(createLineEditor(['TASK']), -1, false);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('abc');
	});
});

describe('LineSnapshotStore: reset', () => {
	it('discards every snapshot entry', () => {
		const store = buildStore();
		store.rebuildAll(createLineEditor(['TASK']), -1, false);
		expect(store.get(0)).not.toBeUndefined();

		store.reset();

		expect(store.get(0)).toBeUndefined();
	});
});

describe('LineSnapshotStore: rebuildAll', () => {
	it('builds one entry per line, each from that line own text', () => {
		const store = buildStore([fakeAccessor(MarkerType.Id, { read: (line) => line })]);

		store.rebuildAll(createLineEditor(['A', 'B']), -1, false);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('A');
		expect(store.get(1)?.markers.get(MarkerType.Id)).toBe('B');
		expect(store.get(2)).toBeUndefined();
	});

	it('records the marker value of every registered accessor, keyed by its type', () => {
		const idAccessor = fakeAccessor(MarkerType.Id, { read: () => 'aaa' });
		const dueAccessor = fakeAccessor(MarkerType.Due, { read: () => '2026-01-01' });
		const store = buildStore([idAccessor, dueAccessor]);

		store.rebuildAll(createLineEditor(['TASK']), -1, false);

		const markers = store.get(0)?.markers;
		expect(markers?.size).toBe(2);
		expect(markers?.get(MarkerType.Id)).toBe('aaa');
		expect(markers?.get(MarkerType.Due)).toBe('2026-01-01');
	});

	it('captures the dependency ids the accessor reports for the line', () => {
		const dependency = fakeDependency({ read: () => new Set(['abc', 'def']) });
		const store = buildStore([], dependency);

		store.rebuildAll(createLineEditor(['PARENT']), -1, false);

		expect(store.get(0)?.deps).toEqual(new Set(['abc', 'def']));
	});

	it('captures the bare text of the line', () => {
		const store = buildStore([fakeAccessor(MarkerType.Id, { remove: () => 'STRIPPED' })]);

		store.rebuildAll(createLineEditor(['TASK']), -1, false);

		expect(store.get(0)?.bareText).toBe('STRIPPED');
	});

	it('retains the previous entry for the cursor line while it is indeterminate', () => {
		const accessor = fakeAccessor(MarkerType.Id, { read: () => 'abc' });
		const store = buildStore([accessor]);
		store.rebuildAll(createLineEditor(['TASK']), -1, false);
		accessor.read.mockReturnValue('fragment');

		store.rebuildAll(createLineEditor(['TASK']), 0, true);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('abc');
	});

	it('builds the cursor line fresh when it is not indeterminate', () => {
		const accessor = fakeAccessor(MarkerType.Id, { read: () => 'abc' });
		const store = buildStore([accessor]);
		store.rebuildAll(createLineEditor(['TASK']), -1, false);
		accessor.read.mockReturnValue('xyz');

		store.rebuildAll(createLineEditor(['TASK']), 0, false);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('xyz');
	});

	it('builds a non-cursor line fresh even while the cursor line elsewhere is indeterminate', () => {
		const accessor = fakeAccessor(MarkerType.Id, { read: (line) => line });
		const store = buildStore([accessor]);
		store.rebuildAll(createLineEditor(['A', 'B']), -1, false);

		store.rebuildAll(createLineEditor(['CHANGED', 'B']), 1, true);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('CHANGED');
	});

	it('builds the cursor line fresh when it is indeterminate but nothing was retained yet', () => {
		const store = buildStore([fakeAccessor(MarkerType.Id, { read: (line) => line })]);

		store.rebuildAll(createLineEditor(['FRAGMENT']), 0, true);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('FRAGMENT');
	});
});

describe('LineSnapshotStore: seed', () => {
	it('builds one entry per newline-separated line of the raw text', () => {
		const store = buildStore([fakeAccessor(MarkerType.Id, { read: (line) => line })]);

		store.seed('A\nB');

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('A');
		expect(store.get(1)?.markers.get(MarkerType.Id)).toBe('B');
		expect(store.get(2)).toBeUndefined();
	});

	it('overwrites whatever the store held before', () => {
		const store = buildStore([fakeAccessor(MarkerType.Id, { read: (line) => line })]);
		store.rebuildAll(createLineEditor(['A', 'B']), -1, false);

		store.seed('C');

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('C');
		expect(store.get(1)).toBeUndefined();
	});
});

describe('LineSnapshotStore: computeBareText', () => {
	it('threads the line through every marker accessor in registry order', () => {
		const first = fakeAccessor(MarkerType.Id, { remove: (line) => `${line}|rm:id` });
		const second = fakeAccessor(MarkerType.Due, { remove: (line) => `${line}|rm:due` });
		const store = buildStore([first, second]);

		expect(store.computeBareText('LINE')).toBe('LINE|rm:id|rm:due');
		expect(second.remove).toHaveBeenCalledWith('LINE|rm:id');
	});

	it('reads the dependency ids from the marker-stripped line', () => {
		const dependency = fakeDependency();
		const store = buildStore([fakeAccessor(MarkerType.Id, { remove: (line) => `${line}|rm:id` })], dependency);

		store.computeBareText('LINE');

		expect(dependency.read).toHaveBeenCalledWith('LINE|rm:id');
	});

	it('threads the line through a removal for every reported dependency id', () => {
		const dependency = fakeDependency({
			read: () => new Set(['a', 'b']),
			remove: (line, depId) => `${line}|-${depId}`,
		});
		const store = buildStore([], dependency);

		expect(store.computeBareText('LINE')).toBe('LINE|-a|-b');
		expect(dependency.remove).toHaveBeenNthCalledWith(1, 'LINE', 'a');
		expect(dependency.remove).toHaveBeenNthCalledWith(2, 'LINE|-a', 'b');
	});

	it('trims the surrounding whitespace off the result', () => {
		const store = buildStore();

		expect(store.computeBareText('  LINE  ')).toBe('LINE');
	});

	it('collapses a bare dependency glyph the accessor could not parse', () => {
		const store = buildStore();

		expect(store.computeBareText('Task \u26D4 more text')).toBe('Task more text');
	});

	it('collapses a bare id glyph the accessor could not parse', () => {
		const store = buildStore();

		expect(store.computeBareText('Task \u{1F194} more text')).toBe('Task more text');
	});

	it('collapses a bare due glyph the accessor could not parse', () => {
		const store = buildStore();

		expect(store.computeBareText('Task \u{1F4C5} more text')).toBe('Task more text');
	});

	it('collapses a bare scheduled glyph the accessor could not parse', () => {
		const store = buildStore();

		expect(store.computeBareText('Task \u{23F3} more text')).toBe('Task more text');
	});
});
