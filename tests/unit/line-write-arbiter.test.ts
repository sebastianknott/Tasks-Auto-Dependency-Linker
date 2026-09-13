import { describe, it, expect, vi, type Mock } from 'vitest';
import { LineWriteArbiter } from '../../src/editing/line-write-arbiter';
import { MarkerType } from '../../src/parsing/marker-accessor';
import type { MarkerAccessorRegistry } from '../../src/parsing/marker-accessor';
import type { LineSnapshotStore, LineSnapshot } from '../../src/editing/line-snapshot-store';
import type { SuppressionDetector, PassObservation } from '../../src/editing/suppression-detector';
import type { ProposalReconciler, CursorLineState } from '../../src/editing/proposal-reconciler';
import type { LineEditor } from '../../src/types';
import { createLineEditor, createCorrectingEditor } from '../fixtures/editor';

type FakeSnapshotStore = {
	reset: Mock<() => void>;
	seed: Mock<(text: string) => void>;
	rebuildAll: Mock<(target: LineEditor, cursorLine: number, indeterminate: boolean) => void>;
	get: Mock<(lineIndex: number) => LineSnapshot | undefined>;
};

function createFakeSnapshotStore(overrides: Partial<FakeSnapshotStore> = {}): FakeSnapshotStore {
	return {
		reset: vi.fn(),
		seed: vi.fn(),
		rebuildAll: vi.fn(),
		get: vi.fn((): LineSnapshot | undefined => undefined),
		...overrides,
	};
}

/** Builds a PassObservation with harmless defaults, so a test states only what it cares about. */
function observationOf(overrides: Partial<PassObservation> = {}): PassObservation {
	return {
		newlySuppressedTypes: new Set<MarkerType>(),
		newlySuppressedDepIds: new Set<string>(),
		verifiedTypes: new Set<MarkerType>(),
		verifiedDepIds: new Set<string>(),
		indeterminate: false,
		...overrides,
	};
}

type FakeDetector = {
	observe: Mock<(target: LineEditor, cursorLine: number) => PassObservation>;
};

function createFakeDetector(overrides: Partial<FakeDetector> = {}): FakeDetector {
	return {
		observe: vi.fn((): PassObservation => observationOf()),
		...overrides,
	};
}

type FakeReconciler = {
	reconcile: Mock<(current: string, proposed: string, state: CursorLineState) => string>;
};

function createFakeReconciler(overrides: Partial<FakeReconciler> = {}): FakeReconciler {
	return {
		// Default: pass the proposal through untouched, so a test that does not
		// care about reconciliation still gets a predictable, non-throwing setLine.
		reconcile: vi.fn((current: string, proposed: string): string => proposed),
		...overrides,
	};
}

/**
 * The registry is never touched: all three real collaborator defaults are
 * overridden explicitly on every construction below, so their default
 * expressions (which would otherwise build a real MarkerAccessorRegistry
 * consumer) never evaluate.
 */
const STUB_REGISTRY = {} as unknown as MarkerAccessorRegistry;

interface Fakes {
	snapshotStore?: FakeSnapshotStore;
	detector?: FakeDetector;
	reconciler?: FakeReconciler;
}

interface Built {
	arbiter: LineWriteArbiter;
	snapshotStore: FakeSnapshotStore;
	detector: FakeDetector;
	reconciler: FakeReconciler;
}

function buildArbiter(fakes: Fakes = {}): Built {
	const snapshotStore = fakes.snapshotStore ?? createFakeSnapshotStore();
	const detector = fakes.detector ?? createFakeDetector();
	const reconciler = fakes.reconciler ?? createFakeReconciler();
	const arbiter = new LineWriteArbiter(
		STUB_REGISTRY,
		snapshotStore as unknown as LineSnapshotStore,
		detector as unknown as SuppressionDetector,
		reconciler as unknown as ProposalReconciler,
	);
	return { arbiter, snapshotStore, detector, reconciler };
}

/**
 * Reads the CursorLineState the reconciler was called with on its most
 * recent invocation. Indexing `mock.calls` directly does not type-check
 * under `noUncheckedIndexedAccess`, so presence is validated before return.
 */
function lastReconcileState(reconciler: FakeReconciler): CursorLineState {
	const calls = reconciler.reconcile.mock.calls;
	const lastCall = calls[calls.length - 1];
	if (!lastCall) {
		throw new Error('reconciler.reconcile was never called');
	}
	const state = lastCall[2];
	if (!state) {
		throw new Error('reconciler.reconcile call is missing its cursorLineState argument');
	}
	return state;
}

describe('LineWriteArbiter: beginPass', () => {
	it('calls detector.observe with the target and the cursor line, exactly as given', () => {
		const { arbiter, detector } = buildArbiter();
		const target = createLineEditor(['a']);

		arbiter.beginPass(target, 3, 'file.md');

		expect(detector.observe).toHaveBeenCalledWith(target, 3);
	});

	it('resets the snapshot store and clears suppression when the file path changes', () => {
		const observe = vi.fn((): PassObservation => observationOf());
		observe.mockReturnValueOnce(
			observationOf({
				newlySuppressedTypes: new Set([MarkerType.Id]),
				newlySuppressedDepIds: new Set(['abc']),
			}),
		);
		observe.mockReturnValueOnce(observationOf());
		const detector = createFakeDetector({ observe });
		const { arbiter, snapshotStore } = buildArbiter({ detector });
		const target = createLineEditor(['line']);

		arbiter.beginPass(target, 0, 'fileA.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
		expect(arbiter.getSuppressedDepIds().has('abc')).toBe(true);

		// The first beginPass call above already triggered a reset, since the
		// arbiter's internal file path starts out null and any real path
		// counts as "changed" against that. Clear the spy so the assertion
		// below is about the fileA -> fileB transition specifically.
		snapshotStore.reset.mockClear();

		arbiter.beginPass(target, 0, 'fileB.md');

		expect(snapshotStore.reset).toHaveBeenCalledTimes(1);
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
		expect(arbiter.getSuppressedDepIds().has('abc')).toBe(false);
	});

	it('clears suppression without resetting the snapshot store when only the cursor line changes', () => {
		const observe = vi.fn((): PassObservation => observationOf());
		observe.mockReturnValueOnce(observationOf({ newlySuppressedTypes: new Set([MarkerType.Id]) }));
		observe.mockReturnValueOnce(observationOf());
		observe.mockReturnValueOnce(observationOf());
		const detector = createFakeDetector({ observe });
		const { arbiter, snapshotStore } = buildArbiter({ detector });
		const target = createLineEditor(['a', 'b']);

		arbiter.beginPass(target, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);

		// The first beginPass call above already reset the store once, since
		// the internal file path starts out null. Clear the spy so the
		// assertions below are about the cursor-line-only transitions.
		snapshotStore.reset.mockClear();

		arbiter.beginPass(target, 1, 'file.md');
		expect(snapshotStore.reset).not.toHaveBeenCalled();

		// Cursor moves back to line 0. If suppression had not been cleared when
		// the cursor first left line 0, this pass's empty observation would
		// still show line 0 as suppressed, since nothing would ever have
		// discarded the earlier entry.
		arbiter.beginPass(target, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
	});

	it('accumulates suppression but replaces verification when neither the path nor the cursor line changes', () => {
		const observe = vi.fn((): PassObservation => observationOf());
		observe.mockReturnValueOnce(
			observationOf({
				newlySuppressedTypes: new Set([MarkerType.Id]),
				newlySuppressedDepIds: new Set(['abc']),
				verifiedTypes: new Set([MarkerType.Due]),
				verifiedDepIds: new Set(['def']),
			}),
		);
		observe.mockReturnValueOnce(
			observationOf({
				newlySuppressedTypes: new Set([MarkerType.Priority]),
			}),
		);
		const detector = createFakeDetector({ observe });
		const reconciler = createFakeReconciler();
		const { arbiter, snapshotStore } = buildArbiter({ detector, reconciler });
		const target = createLineEditor(['a']);

		arbiter.beginPass(target, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);

		// The first beginPass call above already reset the store once, since
		// the internal file path starts out null. Clear the spy so the
		// assertion below is about the same-path, same-cursor-line pass.
		snapshotStore.reset.mockClear();

		// Same path, same cursor line: neither clearing branch fires.
		arbiter.beginPass(target, 0, 'file.md');
		expect(snapshotStore.reset).not.toHaveBeenCalled();

		// Suppression from the first pass survives (accumulates)...
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
		// ...and the newly suppressed type from the second pass is folded in too.
		expect(arbiter.isSuppressed(0, MarkerType.Priority)).toBe(true);

		// ...but verification from the first pass does not survive: the second
		// pass's observation carried no verified types or dep ids, so the
		// state handed to the reconciler must reflect that empty set, not the
		// one from the pass before.
		arbiter.setLine(0, 'proposed');
		const state = lastReconcileState(reconciler);
		expect(state.verifiedTypes.has(MarkerType.Due)).toBe(false);
		expect(state.verifiedDepIds.has('def')).toBe(false);
	});
});

describe('LineWriteArbiter: lineCount and getLine delegate to the target', () => {
	it('lineCount returns the target line count', () => {
		const { arbiter } = buildArbiter();
		const target = createLineEditor(['a', 'b', 'c']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.lineCount()).toBe(3);
	});

	it('getLine returns the target line content', () => {
		const { arbiter } = buildArbiter();
		const target = createLineEditor(['first', 'second']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getLine(1)).toBe('second');
	});
});

describe('LineWriteArbiter: setLine', () => {
	it('writes a non-cursor line straight through, unreconciled', () => {
		const reconciler = createFakeReconciler();
		const { arbiter } = buildArbiter({ reconciler });
		const target = createLineEditor(['cursor line', 'other line']);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(1, 'new text');

		expect(result).toBe('new text');
		expect(target.setLine).toHaveBeenCalledWith(1, 'new text');
		expect(reconciler.reconcile).not.toHaveBeenCalled();
	});

	it('returns the current line and never writes when the cursor line is indeterminate', () => {
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const reconciler = createFakeReconciler();
		const { arbiter } = buildArbiter({ detector, reconciler });
		const target = createLineEditor(['current text']);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, 'proposed text');

		expect(result).toBe('current text');
		expect(target.setLine).not.toHaveBeenCalled();
		expect(reconciler.reconcile).not.toHaveBeenCalled();
	});

	it('returns current and does not write when the reconciled text equals the current text', () => {
		const reconciler = createFakeReconciler({ reconcile: vi.fn(() => 'current text') });
		const { arbiter } = buildArbiter({ reconciler });
		const target = createLineEditor(['current text']);
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, 'proposed text');

		expect(result).toBe('current text');
		expect(target.setLine).not.toHaveBeenCalled();
	});

	it('writes the corrected text, not the raw proposal, and returns whatever the target reports back', () => {
		const reconciler = createFakeReconciler({ reconcile: vi.fn(() => 'corrected text') });
		const { arbiter } = buildArbiter({ reconciler });
		const lines = ['current text'];
		// createCorrectingEditor proves the return value is the editor's own
		// answer, not the "corrected" string setLine handed it: the editor
		// here ignores its input entirely and reports something else.
		const target = createCorrectingEditor(lines, () => 'editor-reported text');
		arbiter.beginPass(target, 0, 'file.md');

		const result = arbiter.setLine(0, 'proposed text');

		expect(target.setLine).toHaveBeenCalledWith(0, 'corrected text');
		expect(result).toBe('editor-reported text');
	});
});

describe('LineWriteArbiter: cursorLineState bundle passed to the reconciler', () => {
	it('bundles all four accumulated sets exactly as accumulated', () => {
		const detector = createFakeDetector({
			observe: vi.fn(() =>
				observationOf({
					newlySuppressedTypes: new Set([MarkerType.Id]),
					newlySuppressedDepIds: new Set(['dep1']),
					verifiedTypes: new Set([MarkerType.Due]),
					verifiedDepIds: new Set(['dep2']),
				}),
			),
		});
		const reconciler = createFakeReconciler();
		const { arbiter } = buildArbiter({ detector, reconciler });
		const target = createLineEditor(['- [ ] Task']);
		arbiter.beginPass(target, 0, 'file.md');

		arbiter.setLine(0, 'proposed text');

		const state = lastReconcileState(reconciler);
		expect(state.suppressedTypes).toEqual(new Set([MarkerType.Id]));
		expect(state.suppressedDepIds).toEqual(new Set(['dep1']));
		expect(state.verifiedTypes).toEqual(new Set([MarkerType.Due]));
		expect(state.verifiedDepIds).toEqual(new Set(['dep2']));
	});
});

describe('LineWriteArbiter: endPass', () => {
	it('rebuilds the snapshot store with the target, cursor line, and indeterminate flag, in that order', () => {
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter, snapshotStore } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		arbiter.endPass();

		expect(snapshotStore.rebuildAll).toHaveBeenCalledWith(target, 0, true);
	});

	it('passes indeterminate as false when the pass observation says so', () => {
		const { arbiter, snapshotStore } = buildArbiter();
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		arbiter.endPass();

		expect(snapshotStore.rebuildAll).toHaveBeenCalledWith(target, 0, false);
	});
});

describe('LineWriteArbiter: seedFromText', () => {
	it('is a no-op when the path already matches: seed is not called and suppression is not cleared', () => {
		const detector = createFakeDetector({
			observe: vi.fn(() => observationOf({ newlySuppressedTypes: new Set([MarkerType.Id]) })),
		});
		const { arbiter, snapshotStore } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);

		arbiter.seedFromText('file.md', 'unused text');

		expect(snapshotStore.seed).not.toHaveBeenCalled();
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
	});

	it('seeds the snapshot store and clears suppression accumulated on a previous path', () => {
		const detector = createFakeDetector({
			observe: vi.fn(() =>
				observationOf({
					newlySuppressedTypes: new Set([MarkerType.Id]),
					newlySuppressedDepIds: new Set(['abc']),
				}),
			),
		});
		const { arbiter, snapshotStore } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'fileA.md');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
		expect(arbiter.getSuppressedDepIds().has('abc')).toBe(true);

		arbiter.seedFromText('fileB.md', 'raw text');

		expect(snapshotStore.seed).toHaveBeenCalledWith('raw text');
		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
		expect(arbiter.getSuppressedDepIds().has('abc')).toBe(false);
	});

	it('makes a later beginPass for the same path take the cursor-line branch, not the file-path branch', () => {
		const { arbiter, snapshotStore } = buildArbiter();
		arbiter.seedFromText('file.md', 'raw text');

		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(snapshotStore.reset).not.toHaveBeenCalled();
	});
});

describe('LineWriteArbiter: isSuppressed', () => {
	it('is false when the type is not suppressed, even on the cursor line', () => {
		const { arbiter } = buildArbiter();
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
	});

	it('is false when the line index is not the cursor line, even if the type is suppressed there', () => {
		const detector = createFakeDetector({
			observe: vi.fn(() => observationOf({ newlySuppressedTypes: new Set([MarkerType.Id]) })),
		});
		const { arbiter } = buildArbiter({ detector });
		const target = createLineEditor(['a', 'b']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(1, MarkerType.Id)).toBe(false);
	});

	it('is true only when both the line index matches the cursor line and the type is suppressed', () => {
		const detector = createFakeDetector({
			observe: vi.fn(() => observationOf({ newlySuppressedTypes: new Set([MarkerType.Id]) })),
		});
		const { arbiter } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
	});
});

describe('LineWriteArbiter: blocksIdMinting', () => {
	it('blocks minting when the id marker is suppressed on a determinate line', () => {
		const detector = createFakeDetector({
			observe: vi.fn(() => observationOf({ newlySuppressedTypes: new Set([MarkerType.Id]), indeterminate: false })),
		});
		const { arbiter } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(true);
		expect(arbiter.isIndeterminate(0)).toBe(false);
		expect(arbiter.blocksIdMinting(0)).toBe(true);
	});

	it('allows minting when neither the id marker is suppressed nor the line is indeterminate', () => {
		const { arbiter } = buildArbiter();
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
		expect(arbiter.isIndeterminate(0)).toBe(false);
		expect(arbiter.blocksIdMinting(0)).toBe(false);
	});

	it('blocks minting when the line is indeterminate even though nothing is suppressed', () => {
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isSuppressed(0, MarkerType.Id)).toBe(false);
		expect(arbiter.isIndeterminate(0)).toBe(true);
		expect(arbiter.blocksIdMinting(0)).toBe(true);
	});
});

describe('LineWriteArbiter: isIndeterminate', () => {
	it('is false for the cursor line when the pass observation was not indeterminate', () => {
		const { arbiter } = buildArbiter();
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(false);
	});

	it('is false for a non-cursor line even when the cursor line itself is indeterminate', () => {
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ detector });
		const target = createLineEditor(['a', 'b']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(1)).toBe(false);
	});

	it('is true only when the line index matches the cursor line and it is indeterminate', () => {
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.isIndeterminate(0)).toBe(true);
	});
});

describe('LineWriteArbiter: getFrozenDepsForIndeterminateLine', () => {
	it('returns an empty set and never consults the snapshot store when not indeterminate', () => {
		const snapshotStore = createFakeSnapshotStore();
		const { arbiter } = buildArbiter({ snapshotStore });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getFrozenDepsForIndeterminateLine()).toEqual(new Set());
		expect(snapshotStore.get).not.toHaveBeenCalled();
	});

	it('returns the snapshot deps when indeterminate and a snapshot exists for the cursor line', () => {
		const deps = new Set(['abc', 'def']);
		const snapshot: LineSnapshot = { bareText: '', markers: new Map(), deps };
		const snapshotStore = createFakeSnapshotStore({ get: vi.fn(() => snapshot) });
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ snapshotStore, detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getFrozenDepsForIndeterminateLine()).toBe(deps);
	});

	it('returns an empty set when indeterminate but the snapshot store has no entry for the cursor line', () => {
		const snapshotStore = createFakeSnapshotStore({ get: vi.fn(() => undefined) });
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ snapshotStore, detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getFrozenDepsForIndeterminateLine()).toEqual(new Set());
	});
});

describe('LineWriteArbiter: getFrozenIdForCursorLine', () => {
	it('returns null and never consults the snapshot store when not indeterminate', () => {
		const snapshotStore = createFakeSnapshotStore();
		const { arbiter } = buildArbiter({ snapshotStore });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
		expect(snapshotStore.get).not.toHaveBeenCalled();
	});

	it('returns the snapshot id when indeterminate and the snapshot holds one', () => {
		const markers = new Map<MarkerType, string | null>([[MarkerType.Id, 'abc123']]);
		const snapshot: LineSnapshot = { bareText: '', markers, deps: new Set() };
		const snapshotStore = createFakeSnapshotStore({ get: vi.fn(() => snapshot) });
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ snapshotStore, detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getFrozenIdForCursorLine()).toBe('abc123');
	});

	it('returns null when indeterminate but the snapshot store has no entry for the cursor line', () => {
		const snapshotStore = createFakeSnapshotStore({ get: vi.fn(() => undefined) });
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ snapshotStore, detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
	});

	it('returns null when the snapshot exists but holds no id value at all', () => {
		const markers = new Map<MarkerType, string | null>([[MarkerType.Id, null]]);
		const snapshot: LineSnapshot = { bareText: '', markers, deps: new Set() };
		const snapshotStore = createFakeSnapshotStore({ get: vi.fn(() => snapshot) });
		const detector = createFakeDetector({ observe: vi.fn(() => observationOf({ indeterminate: true })) });
		const { arbiter } = buildArbiter({ snapshotStore, detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		expect(arbiter.getFrozenIdForCursorLine()).toBeNull();
	});
});

describe('LineWriteArbiter: getSuppressedDepIds', () => {
	it('returns a copy: mutating the result does not affect a later call', () => {
		const detector = createFakeDetector({
			observe: vi.fn(() => observationOf({ newlySuppressedDepIds: new Set(['abc']) })),
		});
		const { arbiter } = buildArbiter({ detector });
		const target = createLineEditor(['a']);
		arbiter.beginPass(target, 0, 'file.md');

		const first = arbiter.getSuppressedDepIds();
		first.add('zzz');

		const second = arbiter.getSuppressedDepIds();
		expect(second.has('zzz')).toBe(false);
		expect(second.has('abc')).toBe(true);
	});
});
