import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetadataInheritor } from '../../src/linking/metadata-inheritor';
import { MarkerType } from '../../src/parsing/marker-accessor';
import type { MarkerAccessorRegistry } from '../../src/parsing/marker-accessor';
import type { MetadataSyncCache } from '../../src/cache/metadata-sync-cache';

type AccessorStub = {
	type: MarkerType;
	read: ReturnType<typeof vi.fn>;
	apply: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
	hasFragment: ReturnType<typeof vi.fn>;
};

type SyncCacheStub = {
	get: ReturnType<typeof vi.fn>;
	set: ReturnType<typeof vi.fn>;
};

function fakeAccessor(type: MarkerType): AccessorStub {
	return {
		type,
		read: vi.fn((): string | null => null),
		// The default apply appends "::value" so a test can predict the
		// exact resulting line without re-deriving any marker syntax.
		apply: vi.fn((line: string, value: string): string => `${line}::${value}`),
		remove: vi.fn((line: string): string => line),
		hasFragment: vi.fn((): boolean => false),
	};
}

function fakeSyncCache(): SyncCacheStub {
	return {
		get: vi.fn((): unknown => undefined),
		set: vi.fn(),
	};
}

function registryWith(...accessors: AccessorStub[]): MarkerAccessorRegistry {
	return { inheritable: accessors } as unknown as MarkerAccessorRegistry;
}

function buildInheritor(syncCache: SyncCacheStub, ...accessors: AccessorStub[]): MetadataInheritor {
	return new MetadataInheritor(
		registryWith(...accessors),
		syncCache as unknown as MetadataSyncCache,
	);
}

describe('MetadataInheritor', () => {
	let syncCache: SyncCacheStub;

	beforeEach(() => {
		syncCache = fakeSyncCache();
	});

	describe('syncFromParent', () => {
		it('returns the child line unchanged when the registry has no inheritable accessors', () => {
			const inheritor = buildInheritor(syncCache);
			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');
			expect(result).toBe('child-line');
		});

		it("chains every inheritable accessor's transformation onto the previous accessor's result", () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			const schedAcc = fakeAccessor(MarkerType.Scheduled);
			dueAcc.read.mockImplementation((l: string) => (l === 'parent' ? '2025-01-01' : null));
			schedAcc.read.mockImplementation((l: string) => (l === 'parent' ? '2025-02-02' : null));
			const inheritor = buildInheritor(syncCache, dueAcc, schedAcc);

			const result = inheritor.syncFromParent('c1', 'child', 'parent');

			expect(result).toBe('child::2025-01-01::2025-02-02');
			// The second accessor must receive the FIRST accessor's output,
			// not the original child line, proving the loop threads the
			// result through rather than starting fresh each time.
			expect(schedAcc.apply).toHaveBeenCalledWith('child::2025-01-01', '2025-02-02');
		});

		it('skips a field whose line carries a fragment, without reading the parent or applying anything', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.hasFragment.mockReturnValue(true);
			// Even though the parent would otherwise supply a value, the
			// fragment guard must return before this is ever consulted.
			dueAcc.read.mockReturnValue('2025-05-05');
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line');
			expect(dueAcc.hasFragment).toHaveBeenCalledWith('child-line');
			expect(dueAcc.read).not.toHaveBeenCalled();
			expect(dueAcc.apply).not.toHaveBeenCalled();
		});

		it('does not propose a field when the parent line has no value for it', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			// The cache holds a stale, non-null value on purpose: if the
			// null-parent guard were skipped, the next comparison
			// (parentValue === lastSynced) would be null === '2025-01-01',
			// which is false, so the guard removal would be observable.
			syncCache.get.mockReturnValue({ due: '2025-01-01', scheduled: null, priority: null });
			dueAcc.read.mockImplementation((l: string) => (l === 'parent-line' ? null : 'SHOULD_NOT_BE_READ'));
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line');
			expect(dueAcc.read).toHaveBeenCalledTimes(1);
			expect(dueAcc.read).toHaveBeenCalledWith('parent-line');
			expect(dueAcc.apply).not.toHaveBeenCalled();
		});

		it('fills a field when the parent has a value and the child has none', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => (l === 'parent-line' ? '2025-01-01' : null));
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line::2025-01-01');
			expect(dueAcc.apply).toHaveBeenCalledWith('child-line', '2025-01-01');
		});

		it("does not propose a field when the parent's value already matches what was last synced", () => {
			syncCache.get.mockReturnValue({ due: '2025-01-01', scheduled: null, priority: null });
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => (l === 'parent-line' ? '2025-01-01' : 'SHOULD_NOT_BE_READ'));
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line');
			// Only the parent is read: the equal-to-lastSynced guard must
			// return before the child's own value is ever consulted.
			expect(dueAcc.read).toHaveBeenCalledTimes(1);
			expect(dueAcc.apply).not.toHaveBeenCalled();
		});

		it('protects a field the child has explicitly set to a value different from what was last synced', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => {
				if (l === 'parent-line') return '2025-01-01';
				if (l === 'child-line') return '2099-12-31';
				return null;
			});
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line');
			expect(dueAcc.read).toHaveBeenNthCalledWith(1, 'parent-line');
			expect(dueAcc.read).toHaveBeenNthCalledWith(2, 'child-line');
			expect(dueAcc.apply).not.toHaveBeenCalled();
		});

		it('proposes a field again when the child still holds exactly the previously synced value and the parent changed', () => {
			syncCache.get.mockReturnValue({ due: '2025-01-01', scheduled: null, priority: null });
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => {
				if (l === 'parent-line') return '2025-09-09';
				if (l === 'child-line') return '2025-01-01';
				return null;
			});
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line::2025-09-09');
			expect(dueAcc.apply).toHaveBeenCalledWith('child-line', '2025-09-09');
		});

		it('inherits a field fresh when the child has cleared its marker even though the cache remembers a stale value', () => {
			syncCache.get.mockReturnValue({ due: '2025-01-01', scheduled: null, priority: null });
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => (l === 'parent-line' ? '2025-09-09' : null));
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line::2025-09-09');
			expect(dueAcc.apply).toHaveBeenCalledWith('child-line', '2025-09-09');
		});

		it('treats an empty-string last-synced value as a real value, not as "no value"', () => {
			// If the nullish-coalescing default were replaced by a
			// falsy-check default, an empty-string lastSynced would be
			// treated as null, and the equal-to-stored-value comparison
			// below would then wrongly fail to match, blocking inheritance.
			syncCache.get.mockReturnValue({ due: '', scheduled: null, priority: null });
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => {
				if (l === 'parent-line') return '2025-09-09';
				if (l === 'child-line') return '';
				return null;
			});
			const inheritor = buildInheritor(syncCache, dueAcc);

			const result = inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			expect(result).toBe('child-line::2025-09-09');
			expect(dueAcc.apply).toHaveBeenCalledWith('child-line', '2025-09-09');
		});
	});

	describe('confirmWrite', () => {
		it('records nothing when nothing was proposed since construction', () => {
			const inheritor = buildInheritor(syncCache, fakeAccessor(MarkerType.Due));

			inheritor.confirmWrite('anything');

			expect(syncCache.set).not.toHaveBeenCalled();
		});

		it('records the field once the written-back line confirms the proposed value landed, and does not repeat on a later call', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => {
				if (l === 'parent-line') return '2025-09-09';
				if (l === 'written-line') return '2025-09-09';
				return null;
			});
			const inheritor = buildInheritor(syncCache, dueAcc);
			inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			inheritor.confirmWrite('written-line');

			expect(syncCache.set).toHaveBeenCalledWith('c1', 'due', '2025-09-09');
			expect(syncCache.set).toHaveBeenCalledTimes(1);

			inheritor.confirmWrite('written-line');

			// Pending was cleared by the first confirmWrite: a second call
			// with the same line must not repeat the recording.
			expect(syncCache.set).toHaveBeenCalledTimes(1);
		});

		it('does not record a field when the written-back line no longer matches what was proposed', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => {
				if (l === 'parent-line') return '2025-09-09';
				if (l === 'written-line') return '2025-01-01';
				return null;
			});
			const inheritor = buildInheritor(syncCache, dueAcc);
			inheritor.syncFromParent('c1', 'child-line', 'parent-line');

			inheritor.confirmWrite('written-line');

			expect(syncCache.set).not.toHaveBeenCalled();
		});

		it('confirms only the fields whose written-back line matches, leaving the others unrecorded', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			const schedAcc = fakeAccessor(MarkerType.Scheduled);
			const prioAcc = fakeAccessor(MarkerType.Priority);
			dueAcc.read.mockImplementation((l: string) => {
				if (l === 'parent') return '2025-09-09';
				if (l === 'written') return '2025-09-09';
				return null;
			});
			schedAcc.read.mockImplementation((l: string) => {
				if (l === 'parent') return '2025-05-05';
				if (l === 'written') return '2099-01-01';
				return null;
			});
			prioAcc.read.mockImplementation((l: string) => {
				if (l === 'parent') return 'highest';
				if (l === 'written') return 'highest';
				return null;
			});
			const inheritor = buildInheritor(syncCache, dueAcc, schedAcc, prioAcc);
			inheritor.syncFromParent('c1', 'child', 'parent');

			inheritor.confirmWrite('written');

			expect(syncCache.set).toHaveBeenCalledWith('c1', 'due', '2025-09-09');
			expect(syncCache.set).toHaveBeenCalledWith('c1', 'priority', 'highest');
			expect(syncCache.set).not.toHaveBeenCalledWith('c1', 'scheduled', expect.anything());
			expect(syncCache.set).toHaveBeenCalledTimes(2);
		});

		it('clears a pending proposal on the next syncFromParent call, so an unrelated confirmWrite cannot resurrect it', () => {
			const dueAcc = fakeAccessor(MarkerType.Due);
			dueAcc.read.mockImplementation((l: string) => {
				if (l === 'parent-with-due') return '2025-09-09';
				if (l === 'written-line') return '2025-09-09';
				return null;
			});
			const inheritor = buildInheritor(syncCache, dueAcc);

			// Pass 1: queues a due proposal for c1, never confirmed.
			inheritor.syncFromParent('c1', 'child-c1', 'parent-with-due');
			// Pass 2: an unrelated child whose parent has no due value at
			// all proposes nothing, resetting the pending list to empty.
			inheritor.syncFromParent('c2', 'child-c2', 'parent-empty');

			// If c1's stale proposal had leaked through, this line would
			// match it (accessor.read('written-line') === '2025-09-09')
			// and wrongly confirm it.
			inheritor.confirmWrite('written-line');

			expect(syncCache.set).not.toHaveBeenCalled();
		});
	});
});
