import { describe, it, expect } from 'vitest';
import { LineSnapshotStore } from '../src/line-snapshot-store';
import { MarkerAccessorRegistry, MarkerType } from '../src/marker-accessor';
import { TaskParser } from '../src/task-parser';
import { TaskMetadataParser } from '../src/task-metadata-parser';
import { createLineEditor } from './fixtures/editor';

function createStore(): LineSnapshotStore {
	const registry = new MarkerAccessorRegistry(new TaskParser(), new TaskMetadataParser());
	return new LineSnapshotStore(registry);
}

describe('LineSnapshotStore: get', () => {
	it('returns undefined for a line with no snapshot entry yet', () => {
		const store = createStore();

		expect(store.get(0)).toBeUndefined();
	});

	it('returns the entry captured by rebuildAll', () => {
		const store = createStore();
		const target = createLineEditor(['- [ ] Task \u{1F194} abc']);

		store.rebuildAll(target, -1, false);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('abc');
	});
});

describe('LineSnapshotStore: reset', () => {
	it('discards every snapshot entry', () => {
		const store = createStore();
		const target = createLineEditor(['- [ ] Task \u{1F194} abc']);
		store.rebuildAll(target, -1, false);
		expect(store.get(0)).not.toBeUndefined();

		store.reset();

		expect(store.get(0)).toBeUndefined();
	});
});

describe('LineSnapshotStore: rebuildAll', () => {
	it('builds a fresh snapshot per line from the target', () => {
		const store = createStore();
		const target = createLineEditor(['- [ ] A \u{1F194} aaa', '- [ ] B \u{1F194} bbb']);

		store.rebuildAll(target, -1, false);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('aaa');
		expect(store.get(1)?.markers.get(MarkerType.Id)).toBe('bbb');
	});

	it('captures the dependency ids and bareText for each line', () => {
		const store = createStore();
		const target = createLineEditor(['- [ ] Parent \u26D4 abc,def']);

		store.rebuildAll(target, -1, false);

		expect(store.get(0)?.deps).toEqual(new Set(['abc', 'def']));
		expect(store.get(0)?.bareText).toBe('- [ ] Parent');
	});

	it('retains the previous snapshot for the cursor line while it is indeterminate', () => {
		const store = createStore();
		const target1 = createLineEditor(['- [ ] Task \u{1F194} abc']);
		store.rebuildAll(target1, -1, false);

		// The glyph is left bare mid-deletion: a fragment that must not
		// overwrite the last well-formed snapshot for this line.
		const target2 = createLineEditor(['- [ ] Task \u{1F194}']);
		store.rebuildAll(target2, 0, true);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('abc');
	});

	it('builds fresh for a non-cursor line even while the cursor line elsewhere is indeterminate', () => {
		const store = createStore();
		const target1 = createLineEditor(['- [ ] A \u{1F194} aaa', '- [ ] B \u{1F194} bbb']);
		store.rebuildAll(target1, -1, false);

		// Line 0 changed (not the cursor line, which is line 1 and is
		// indeterminate); line 0 must still be rebuilt fresh.
		const target2 = createLineEditor(['- [ ] A', '- [ ] B \u{1F194}']);
		store.rebuildAll(target2, 1, true);

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBeNull();
	});

	it('builds fresh for the cursor line when indeterminate but nothing was retained yet', () => {
		const store = createStore();
		const target = createLineEditor(['- [ ] Parent \u26D4 ,def']);

		store.rebuildAll(target, 0, true);

		expect(store.get(0)?.deps).toEqual(new Set());
	});
});

describe('LineSnapshotStore: seed', () => {
	it('builds a snapshot entry per line from raw text', () => {
		const store = createStore();

		store.seed('- [ ] A \u{1F194} aaa\n- [ ] B \u{1F194} bbb');

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBe('aaa');
		expect(store.get(1)?.markers.get(MarkerType.Id)).toBe('bbb');
	});

	it('overwrites whatever the store held before', () => {
		const store = createStore();
		const target = createLineEditor(['- [ ] Task \u{1F194} abc']);
		store.rebuildAll(target, -1, false);

		store.seed('- [ ] Task');

		expect(store.get(0)?.markers.get(MarkerType.Id)).toBeNull();
	});
});

describe('LineSnapshotStore: computeBareText', () => {
	it('strips a single-value marker', () => {
		const store = createStore();

		expect(store.computeBareText('- [ ] Task \u{1F194} abc')).toBe('- [ ] Task');
	});

	it('strips dependency markers', () => {
		const store = createStore();

		expect(store.computeBareText('- [ ] Task \u26D4 abc,def')).toBe('- [ ] Task');
	});

	it('collapses whitespace left on both sides of a bare dependency glyph mid-deletion', () => {
		const store = createStore();

		expect(store.computeBareText('Task \u26D4  more text')).toBe('Task more text');
	});
});
