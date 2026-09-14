import { describe, it, expect, vi, type Mock } from 'vitest';
import { ProposalReconciler } from '../../src/editing/proposal-reconciler';
import { MarkerType } from '../../src/parsing/marker-accessor';
import type { MarkerAccessor, MarkerAccessorRegistry } from '../../src/parsing/marker-accessor';
import type { CursorLineState } from '../../src/editing/proposal-reconciler';

const CURRENT = 'CURRENT';
const PROPOSED = 'PROPOSED';

interface FakeAccessor extends MarkerAccessor {
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

/**
 * `apply` and `remove` return a labelled derivative of their input rather
 * than a realistic task line. The label makes the accumulator visible: a
 * test can tell which accessor rewrote the line, in which order, and what
 * it was handed.
 */
function fakeAccessor(type: MarkerType, reads: Record<string, string | null> = {}): FakeAccessor {
	return {
		type,
		read: vi.fn((line: string) => reads[line] ?? null),
		apply: vi.fn((line: string, value: string) => `${line}|ap:${type}=${value}`),
		remove: vi.fn((line: string) => `${line}|rm:${type}`),
		hasFragment: vi.fn(() => false),
	};
}

function fakeDependency(reads: Record<string, string[]> = {}): FakeDependency {
	return {
		read: vi.fn((line: string) => new Set(reads[line] ?? [])),
		apply: vi.fn((line: string, depId: string) => `${line}|+${depId}`),
		remove: vi.fn((line: string, depId: string) => `${line}|-${depId}`),
		hasFragment: vi.fn(() => false),
	};
}

function buildReconciler(markers: FakeAccessor[], dependency: FakeDependency): ProposalReconciler {
	const registry = {
		markers,
		inheritable: markers,
		dependency,
	} as unknown as MarkerAccessorRegistry;
	return new ProposalReconciler(registry);
}

function stateOf(overrides: Partial<CursorLineState> = {}): CursorLineState {
	return {
		suppressedTypes: new Set<MarkerType>(),
		suppressedDepIds: new Set<string>(),
		verifiedTypes: new Set<MarkerType>(),
		verifiedDepIds: new Set<string>(),
		...overrides,
	};
}

describe('ProposalReconciler: marker arbitration', () => {
	it('leaves a proposal that still carries the marker untouched', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: 'a1' });
		const dependency = fakeDependency();

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(result).toBe(PROPOSED);
		expect(id.apply).not.toHaveBeenCalled();
		expect(id.remove).not.toHaveBeenCalled();
		expect(id.read).toHaveBeenCalledWith(CURRENT);
		expect(id.read).toHaveBeenCalledWith(PROPOSED);
	});

	it('restores the current value when the proposal drops an unverified marker', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const dependency = fakeDependency();

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(id.apply).toHaveBeenCalledWith(PROPOSED, 'a1');
		expect(result).toBe('PROPOSED|ap:id=a1');
	});

	it('lets the removal stand when the marker was verified this pass', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const dependency = fakeDependency();
		const state = stateOf({ verifiedTypes: new Set([MarkerType.Id]) });

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(result).toBe(PROPOSED);
		expect(id.apply).not.toHaveBeenCalled();
		expect(id.remove).not.toHaveBeenCalled();
	});

	it('freezes a suppressed marker at its current value even when the proposal only changed it', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: 'b2' });
		const dependency = fakeDependency();
		const state = stateOf({ suppressedTypes: new Set([MarkerType.Id]) });

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(id.apply).toHaveBeenCalledWith(PROPOSED, 'a1');
		expect(result).toBe('PROPOSED|ap:id=a1');
	});

	it('lets suppression outrank verification for the same marker', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const dependency = fakeDependency();
		const state = stateOf({
			suppressedTypes: new Set([MarkerType.Id]),
			verifiedTypes: new Set([MarkerType.Id]),
		});

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(result).toBe('PROPOSED|ap:id=a1');
	});

	it('removes the marker from the proposal when the current line holds none', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: null, [PROPOSED]: null });
		const dependency = fakeDependency();

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(id.remove).toHaveBeenCalledWith(PROPOSED);
		expect(result).toBe('PROPOSED|rm:id');
	});

	it('never blocks a marker the proposal adds', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: null, [PROPOSED]: 'new1' });
		const dependency = fakeDependency();

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(result).toBe(PROPOSED);
		expect(id.apply).not.toHaveBeenCalled();
		expect(id.remove).not.toHaveBeenCalled();
	});

	it('decides each marker type independently within one call', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const due = fakeAccessor(MarkerType.Due, { [CURRENT]: 'd1', [PROPOSED]: 'd1' });
		const dependency = fakeDependency();

		const result = buildReconciler([id, due], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(result).toBe('PROPOSED|ap:id=a1');
		expect(due.apply).not.toHaveBeenCalled();
		expect(due.remove).not.toHaveBeenCalled();
	});

	it('threads each correction into the next while still reading the untouched lines', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const due = fakeAccessor(MarkerType.Due, { [CURRENT]: 'd1', [PROPOSED]: null });
		const dependency = fakeDependency();

		const result = buildReconciler([id, due], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(due.apply).toHaveBeenCalledWith('PROPOSED|ap:id=a1', 'd1');
		expect(due.read).toHaveBeenCalledWith(CURRENT);
		expect(due.read).toHaveBeenCalledWith(PROPOSED);
		expect(result).toBe('PROPOSED|ap:id=a1|ap:due=d1');
	});
});

describe('ProposalReconciler: dependency arbitration', () => {
	it('touches nothing when the proposal keeps every dependency the current line has', () => {
		const dependency = fakeDependency({
			[CURRENT]: ['d1'],
			[PROPOSED]: ['d1'],
		});

		const result = buildReconciler([], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(result).toBe(PROPOSED);
		expect(dependency.apply).not.toHaveBeenCalled();
		expect(dependency.remove).not.toHaveBeenCalled();
	});

	it('restores a dependency the proposal dropped without verification', () => {
		const dependency = fakeDependency({ [CURRENT]: ['d1'], [PROPOSED]: [] });

		const result = buildReconciler([], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(dependency.apply).toHaveBeenCalledWith(PROPOSED, 'd1');
		expect(result).toBe('PROPOSED|+d1');
	});

	it('lets a verified dependency removal stand', () => {
		const dependency = fakeDependency({ [CURRENT]: ['d1'], [PROPOSED]: [] });
		const state = stateOf({ verifiedDepIds: new Set(['d1']) });

		const result = buildReconciler([], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(result).toBe(PROPOSED);
		expect(dependency.apply).not.toHaveBeenCalled();
		expect(dependency.remove).not.toHaveBeenCalled();
	});

	it('freezes a suppressed dependency that the current line holds, outranking verification', () => {
		const dependency = fakeDependency({ [CURRENT]: ['d1'], [PROPOSED]: [] });
		const state = stateOf({
			suppressedDepIds: new Set(['d1']),
			verifiedDepIds: new Set(['d1']),
		});

		const result = buildReconciler([], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(dependency.apply).toHaveBeenCalledWith(PROPOSED, 'd1');
		expect(result).toBe('PROPOSED|+d1');
	});

	it('freezes a suppressed dependency the current line lacks by stripping it back out', () => {
		const dependency = fakeDependency({
			[CURRENT]: [],
			[PROPOSED]: ['d1'],
		});
		const state = stateOf({ suppressedDepIds: new Set(['d1']) });

		const result = buildReconciler([], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(dependency.remove).toHaveBeenCalledWith(PROPOSED, 'd1');
		expect(result).toBe('PROPOSED|-d1');
	});

	it('re-adds a kept dependency that the marker correction stripped off the line', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const corrected = 'PROPOSED|ap:id=a1';
		const dependency = fakeDependency({
			[CURRENT]: ['d1'],
			[PROPOSED]: ['d1'],
			[corrected]: [],
		});

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, stateOf());

		expect(dependency.apply).toHaveBeenCalledWith(corrected, 'd1');
		expect(result).toBe(`${corrected}|+d1`);
	});

	it('considers a suppressed id that neither the current nor the proposed line mentions', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const corrected = 'PROPOSED|ap:id=a1';
		const dependency = fakeDependency({
			[CURRENT]: [],
			[PROPOSED]: [],
			[corrected]: ['d9'],
		});
		const state = stateOf({ suppressedDepIds: new Set(['d9']) });

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(dependency.remove).toHaveBeenCalledWith(corrected, 'd9');
		expect(result).toBe(`${corrected}|-d9`);
	});

	it('decides dependency presence from the untouched proposal, not from the corrected line', () => {
		const id = fakeAccessor(MarkerType.Id, { [CURRENT]: 'a1', [PROPOSED]: null });
		const corrected = 'PROPOSED|ap:id=a1';
		const dependency = fakeDependency({
			[CURRENT]: ['d1'],
			[PROPOSED]: ['d1'],
			[corrected]: ['d1'],
		});
		const state = stateOf({ verifiedDepIds: new Set(['d1']) });

		const result = buildReconciler([id], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(dependency.read).toHaveBeenCalledWith(CURRENT);
		expect(dependency.read).toHaveBeenCalledWith(PROPOSED);
		expect(dependency.remove).not.toHaveBeenCalled();
		expect(result).toBe(corrected);
	});

	it('resolves two dependency ids independently within one call', () => {
		const dependency = fakeDependency({ [CURRENT]: ['keep', 'drop'], [PROPOSED]: [] });
		const state = stateOf({ verifiedDepIds: new Set(['drop']) });

		const result = buildReconciler([], dependency).reconcile(CURRENT, PROPOSED, state);

		expect(dependency.apply).toHaveBeenCalledTimes(1);
		expect(dependency.apply).toHaveBeenCalledWith(PROPOSED, 'keep');
		expect(result).toBe('PROPOSED|+keep');
	});
});
