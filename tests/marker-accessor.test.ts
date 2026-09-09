import { describe, it, expect } from 'vitest';
import { TaskParser } from '../src/task-parser';
import { TaskMetadataParser } from '../src/task-metadata-parser';
import {
	MarkerType,
	IdAccessor,
	DueAccessor,
	ScheduledAccessor,
	PriorityAccessor,
	DependencyAccessor,
	MarkerAccessorRegistry,
	type MarkerAccessor,
} from '../src/marker-accessor';

// Every scalar contract row starts from and reduces back to this line, so
// it is a shared constant rather than two more identical table columns.
const BARE_TASK = '- [ ] Task';

interface ScalarAccessorContract {
	name: string;
	factory: () => MarkerAccessor;
	type: MarkerType;
	// markedLine doubles as the remove() input, because reading a value out
	// of a line and stripping that same value back off it are inverses.
	markedLine: string;
	readValue: string;
	applyValue: string;
	applyResult: string;
	replaceBase: string;
	replaceValue: string;
	replaceResult: string;
}

const scalarAccessorContracts: ScalarAccessorContract[] = [
	{
		name: 'IdAccessor',
		factory: () => new IdAccessor(new TaskParser()),
		type: MarkerType.Id,
		markedLine: '- [ ] Task \u{1F194} abc123',
		readValue: 'abc123',
		applyValue: 'abc123',
		applyResult: '- [ ] Task \u{1F194} abc123',
		replaceBase: '- [ ] Task \u{1F194} old',
		replaceValue: 'new',
		replaceResult: '- [ ] Task \u{1F194} new',
	},
	{
		name: 'DueAccessor',
		factory: () => new DueAccessor(new TaskMetadataParser()),
		type: MarkerType.Due,
		markedLine: '- [ ] Task \u{1F4C5} 2025-01-15',
		readValue: '2025-01-15',
		applyValue: '2025-06-01',
		applyResult: '- [ ] Task \u{1F4C5} 2025-06-01',
		replaceBase: '- [ ] Task \u{1F4C5} 2025-01-01',
		replaceValue: '2025-06-01',
		replaceResult: '- [ ] Task \u{1F4C5} 2025-06-01',
	},
	{
		name: 'ScheduledAccessor',
		factory: () => new ScheduledAccessor(new TaskMetadataParser()),
		type: MarkerType.Scheduled,
		markedLine: '- [ ] Task \u{23F3} 2025-04-10',
		readValue: '2025-04-10',
		applyValue: '2025-06-02',
		applyResult: '- [ ] Task \u{23F3} 2025-06-02',
		replaceBase: '- [ ] Task \u{23F3} 2025-01-01',
		replaceValue: '2025-06-02',
		replaceResult: '- [ ] Task \u{23F3} 2025-06-02',
	},
	{
		name: 'PriorityAccessor',
		// Return type is the interface, not the class: PriorityAccessor
		// narrows hasFragment to zero parameters, so the factory must
		// return MarkerAccessor for this shared contract table to
		// type-check against the interface's one-parameter hasFragment.
		factory: () => new PriorityAccessor(new TaskMetadataParser()),
		type: MarkerType.Priority,
		markedLine: '- [ ] Task \u{23EB}',
		readValue: 'high',
		applyValue: 'high',
		applyResult: '- [ ] Task \u{23EB}',
		replaceBase: '- [ ] Task \u{1F53D}',
		replaceValue: 'highest',
		replaceResult: '- [ ] Task \u{1F53A}',
	},
];

describe.each(scalarAccessorContracts)('$name', (contract) => {
	const accessor = contract.factory();

	it('exposes its marker type', () => {
		expect(accessor.type).toBe(contract.type);
	});

	it('reads the value from a line', () => {
		expect(accessor.read(contract.markedLine)).toBe(contract.readValue);
	});

	it('reads null when no value is present', () => {
		expect(accessor.read(BARE_TASK)).toBeNull();
	});

	it('applies a value to a line with none', () => {
		expect(accessor.apply(BARE_TASK, contract.applyValue)).toBe(
			contract.applyResult,
		);
	});

	it('replaces an existing value in place', () => {
		expect(
			accessor.apply(contract.replaceBase, contract.replaceValue),
		).toBe(contract.replaceResult);
	});

	it('removes the value from a line', () => {
		expect(accessor.remove(contract.markedLine)).toBe(BARE_TASK);
	});
});

interface FragmentAccessorContract {
	name: string;
	factory: () => MarkerAccessor;
	incompleteLine: string;
	bareLine: string;
	wellFormedLine: string;
}

const fragmentAccessorContracts: FragmentAccessorContract[] = [
	{
		name: 'IdAccessor',
		factory: () => new IdAccessor(new TaskParser()),
		incompleteLine: '- [ ] Task \u{1F194}',
		bareLine: '- [ ] Task \u{1F194} ',
		wellFormedLine: '- [ ] Task \u{1F194} abc123',
	},
	{
		name: 'DueAccessor',
		factory: () => new DueAccessor(new TaskMetadataParser()),
		incompleteLine: '- [ ] Task \u{1F4C5} 2025-0',
		bareLine: '- [ ] Task \u{1F4C5}',
		wellFormedLine: '- [ ] Task \u{1F4C5} 2025-01-15',
	},
	{
		name: 'ScheduledAccessor',
		factory: () => new ScheduledAccessor(new TaskMetadataParser()),
		incompleteLine: '- [ ] Task \u{23F3} 2025-0',
		bareLine: '- [ ] Task \u{23F3}',
		wellFormedLine: '- [ ] Task \u{23F3} 2025-04-10',
	},
];

describe.each(fragmentAccessorContracts)('$name hasFragment', (contract) => {
	const accessor = contract.factory();

	it('reports a fragment when the glyph is present but the value is incomplete or gone', () => {
		expect(accessor.hasFragment(contract.incompleteLine)).toBe(true);
	});

	it('reports a fragment for a bare glyph with nothing after it', () => {
		expect(accessor.hasFragment(contract.bareLine)).toBe(true);
	});

	it('does not report a fragment when the value is well-formed', () => {
		expect(accessor.hasFragment(contract.wellFormedLine)).toBe(false);
	});

	it('does not report a fragment when there is no marker at all', () => {
		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
	});
});

describe('PriorityAccessor hasFragment', () => {
	// A priority glyph is a single code point, so PriorityAccessor has no
	// "incomplete" or "bare" state to represent. It cannot supply the rows
	// the fragmentAccessorContracts table above requires, so its two
	// hasFragment behaviors stay as standalone assertions.
	const accessor: MarkerAccessor = new PriorityAccessor(new TaskMetadataParser());

	it('never reports a fragment, since a priority glyph is a single code point', () => {
		expect(accessor.hasFragment('- [ ] Task \u{23EB}')).toBe(false);
	});

	it('does not report a fragment when no priority glyph is present', () => {
		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
	});
});

describe('DependencyAccessor', () => {
	// Multi-value accessor: read() returns a Set and apply()/remove() act
	// on one id within a list rather than a single scalar value, so none
	// of the contract tables above apply to this shape.
	const accessor = new DependencyAccessor(new TaskParser());

	it('reads the dependency id set from a line', () => {
		expect(accessor.read('- [ ] Task \u{26D4} abc,def')).toEqual(
			new Set(['abc', 'def']),
		);
	});

	it('reads an empty set when no dependency is present', () => {
		expect(accessor.read(BARE_TASK)).toEqual(new Set());
	});

	it('applies a dependency id to a line with none', () => {
		expect(accessor.apply(BARE_TASK, 'abc')).toBe(
			'- [ ] Task \u{26D4} abc',
		);
	});

	it('removes one dependency id, leaving the rest', () => {
		expect(accessor.remove('- [ ] Task \u{26D4} abc,def', 'abc')).toBe(
			'- [ ] Task \u{26D4} def',
		);
	});

	it('reports a fragment for a bare glyph with nothing after it', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4}')).toBe(true);
	});

	it('reports a fragment when the first id of a list was deleted, leaving a leading comma', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4} ,def')).toBe(true);
	});

	it('reports a fragment when the last id of a list was deleted, leaving a trailing comma', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc,')).toBe(true);
	});

	it('reports a fragment when a middle id was deleted, leaving two adjacent commas', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc,,def')).toBe(true);
	});

	it('reports a fragment when the last id was deleted along with its leading space, leaving a space then a lone comma', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc ,')).toBe(true);
	});

	it('does not report a fragment when a comma only appears later in unrelated text after a well-formed single id', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc more, text')).toBe(false);
	});

	it('does not report a fragment for a single well-formed id', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc')).toBe(false);
	});

	it('does not report a fragment for a well-formed multi-id list', () => {
		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc,def')).toBe(false);
	});

	it('does not report a fragment when no dependency marker is present at all', () => {
		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
	});
});

describe('MarkerAccessorRegistry', () => {
	const registry = new MarkerAccessorRegistry(
		new TaskParser(),
		new TaskMetadataParser(),
	);

	it('exposes one accessor per single-value marker type', () => {
		const types = registry.markers.map((accessor: MarkerAccessor) => accessor.type);
		expect(types).toEqual([
			MarkerType.Id,
			MarkerType.Due,
			MarkerType.Scheduled,
			MarkerType.Priority,
		]);
	});

	it('exposes a dependency accessor', () => {
		expect(registry.dependency).toBeInstanceOf(DependencyAccessor);
	});

	it('exposes the inheritable markers (due, scheduled, priority) excluding id', () => {
		const types = registry.inheritable.map((accessor: MarkerAccessor) => accessor.type);
		expect(types).toEqual([MarkerType.Due, MarkerType.Scheduled, MarkerType.Priority]);
	});

	it('reuses the same accessor instances between markers and inheritable', () => {
		const dueFromMarkers = registry.markers.find(
			(accessor: MarkerAccessor) => accessor.type === MarkerType.Due,
		);
		const dueFromInheritable = registry.inheritable.find(
			(accessor: MarkerAccessor) => accessor.type === MarkerType.Due,
		);
		expect(dueFromInheritable).toBe(dueFromMarkers);
	});
});
