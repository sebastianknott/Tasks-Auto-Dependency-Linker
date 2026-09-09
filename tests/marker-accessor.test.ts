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

describe('IdAccessor', () => {
	const accessor = new IdAccessor(new TaskParser());

	it('exposes its marker type', () => {
		expect(accessor.type).toBe(MarkerType.Id);
	});

	it('reads the id from a line', () => {
		expect(accessor.read('- [ ] Task \u{1F194} abc123')).toBe('abc123');
	});

	it('reads null when no id is present', () => {
		expect(accessor.read('- [ ] Task')).toBeNull();
	});

	it('applies an id to a line with none', () => {
		expect(accessor.apply('- [ ] Task', 'abc123')).toBe(
			'- [ ] Task \u{1F194} abc123',
		);
	});

	it('replaces an existing id rather than appending a second marker', () => {
		expect(accessor.apply('- [ ] Task \u{1F194} old', 'new')).toBe(
			'- [ ] Task \u{1F194} new',
		);
	});

	it('removes an id from a line', () => {
		expect(accessor.remove('- [ ] Task \u{1F194} abc123')).toBe('- [ ] Task');
	});

	it('reports a fragment when the glyph is present but the id text is gone', () => {
		expect(accessor.hasFragment('- [ ] Task \u{1F194}')).toBe(true);
	});

	it('reports a fragment for a bare glyph with a trailing space and no id', () => {
		expect(accessor.hasFragment('- [ ] Task \u{1F194} ')).toBe(true);
	});

	it('does not report a fragment when the id is well-formed', () => {
		expect(accessor.hasFragment('- [ ] Task \u{1F194} abc123')).toBe(false);
	});

	it('does not report a fragment when there is no id marker at all', () => {
		expect(accessor.hasFragment('- [ ] Task')).toBe(false);
	});
});

describe('DueAccessor', () => {
	const accessor = new DueAccessor(new TaskMetadataParser());

	it('exposes its marker type', () => {
		expect(accessor.type).toBe(MarkerType.Due);
	});

	it('reads the due date from a line', () => {
		expect(accessor.read('- [ ] Task \u{1F4C5} 2025-01-15')).toBe(
			'2025-01-15',
		);
	});

	it('reads null when no due date is present', () => {
		expect(accessor.read('- [ ] Task')).toBeNull();
	});

	it('applies a due date to a line with none', () => {
		expect(accessor.apply('- [ ] Task', '2025-06-01')).toBe(
			'- [ ] Task \u{1F4C5} 2025-06-01',
		);
	});

	it('replaces an existing due date in place', () => {
		expect(
			accessor.apply('- [ ] Task \u{1F4C5} 2025-01-01', '2025-06-01'),
		).toBe('- [ ] Task \u{1F4C5} 2025-06-01');
	});

	it('removes a due date from a line', () => {
		expect(accessor.remove('- [ ] Task \u{1F4C5} 2025-01-15')).toBe(
			'- [ ] Task',
		);
	});

	it('reports a fragment when the glyph is present but the date is incomplete', () => {
		expect(accessor.hasFragment('- [ ] Task \u{1F4C5} 2025-0')).toBe(true);
	});

	it('reports a fragment for a bare due glyph with nothing after it', () => {
		expect(accessor.hasFragment('- [ ] Task \u{1F4C5}')).toBe(true);
	});

	it('does not report a fragment when the due date is well-formed', () => {
		expect(accessor.hasFragment('- [ ] Task \u{1F4C5} 2025-01-15')).toBe(false);
	});

	it('does not report a fragment when there is no due marker at all', () => {
		expect(accessor.hasFragment('- [ ] Task')).toBe(false);
	});
});

describe('ScheduledAccessor', () => {
	const accessor = new ScheduledAccessor(new TaskMetadataParser());

	it('exposes its marker type', () => {
		expect(accessor.type).toBe(MarkerType.Scheduled);
	});

	it('reads the scheduled date from a line', () => {
		expect(accessor.read('- [ ] Task \u{23F3} 2025-04-10')).toBe(
			'2025-04-10',
		);
	});

	it('reads null when no scheduled date is present', () => {
		expect(accessor.read('- [ ] Task')).toBeNull();
	});

	it('applies a scheduled date to a line with none', () => {
		expect(accessor.apply('- [ ] Task', '2025-06-02')).toBe(
			'- [ ] Task \u{23F3} 2025-06-02',
		);
	});

	it('replaces an existing scheduled date in place', () => {
		expect(
			accessor.apply('- [ ] Task \u{23F3} 2025-01-01', '2025-06-02'),
		).toBe('- [ ] Task \u{23F3} 2025-06-02');
	});

	it('removes a scheduled date from a line', () => {
		expect(accessor.remove('- [ ] Task \u{23F3} 2025-04-10')).toBe(
			'- [ ] Task',
		);
	});

	it('reports a fragment when the glyph is present but the date is incomplete', () => {
		expect(accessor.hasFragment('- [ ] Task \u{23F3} 2025-0')).toBe(true);
	});

	it('reports a fragment for a bare scheduled glyph with nothing after it', () => {
		expect(accessor.hasFragment('- [ ] Task \u{23F3}')).toBe(true);
	});

	it('does not report a fragment when the scheduled date is well-formed', () => {
		expect(accessor.hasFragment('- [ ] Task \u{23F3} 2025-04-10')).toBe(false);
	});

	it('does not report a fragment when there is no scheduled marker at all', () => {
		expect(accessor.hasFragment('- [ ] Task')).toBe(false);
	});
});

describe('PriorityAccessor', () => {
	// Typed as the interface on purpose: PriorityAccessor narrows
	// `hasFragment` to zero parameters, and the tests below assert that the
	// contract still answers false for any line callers hand it.
	const accessor: MarkerAccessor = new PriorityAccessor(new TaskMetadataParser());

	it('exposes its marker type', () => {
		expect(accessor.type).toBe(MarkerType.Priority);
	});

	it('reads the priority from a line', () => {
		expect(accessor.read('- [ ] Task \u{23EB}')).toBe('high');
	});

	it('reads null when no priority is present', () => {
		expect(accessor.read('- [ ] Task')).toBeNull();
	});

	it('applies a priority to a line with none', () => {
		expect(accessor.apply('- [ ] Task', 'high')).toBe(
			'- [ ] Task \u{23EB}',
		);
	});

	it('replaces an existing priority glyph in place', () => {
		expect(accessor.apply('- [ ] Task \u{1F53D}', 'highest')).toBe(
			'- [ ] Task \u{1F53A}',
		);
	});

	it('removes a priority glyph from a line', () => {
		expect(accessor.remove('- [ ] Task \u{23EB}')).toBe('- [ ] Task');
	});

	it('never reports a fragment, since a priority glyph is a single code point', () => {
		expect(accessor.hasFragment('- [ ] Task \u{23EB}')).toBe(false);
	});

	it('does not report a fragment when no priority glyph is present', () => {
		expect(accessor.hasFragment('- [ ] Task')).toBe(false);
	});
});

describe('DependencyAccessor', () => {
	const accessor = new DependencyAccessor(new TaskParser());

	it('reads the dependency id set from a line', () => {
		expect(accessor.read('- [ ] Task \u{26D4} abc,def')).toEqual(
			new Set(['abc', 'def']),
		);
	});

	it('reads an empty set when no dependency is present', () => {
		expect(accessor.read('- [ ] Task')).toEqual(new Set());
	});

	it('applies a dependency id to a line with none', () => {
		expect(accessor.apply('- [ ] Task', 'abc')).toBe(
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
		expect(accessor.hasFragment('- [ ] Task')).toBe(false);
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
