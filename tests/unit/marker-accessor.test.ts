import { describe, it, expect, vi } from 'vitest';
import type { TaskParser } from '../../src/parsing/task-parser';
import type { TaskMetadataParser } from '../../src/parsing/task-metadata-parser';
import {
	MarkerType,
	IdAccessor,
	DueAccessor,
	ScheduledAccessor,
	PriorityAccessor,
	DependencyAccessor,
	MarkerAccessorRegistry,
	type MarkerAccessor,
} from '../../src/parsing/marker-accessor';

const BARE_TASK = '- [ ] Task';

interface FakeTaskParser {
	getTaskId: ReturnType<typeof vi.fn>;
	addIdToLine: ReturnType<typeof vi.fn>;
	removeIdFromLine: ReturnType<typeof vi.fn>;
	getTaskDependencies: ReturnType<typeof vi.fn>;
	addDependencyToLine: ReturnType<typeof vi.fn>;
	removeDependencyFromLine: ReturnType<typeof vi.fn>;
}

function createFakeTaskParser(): FakeTaskParser {
	return {
		getTaskId: vi.fn(),
		addIdToLine: vi.fn(),
		removeIdFromLine: vi.fn(),
		getTaskDependencies: vi.fn(),
		addDependencyToLine: vi.fn(),
		removeDependencyFromLine: vi.fn(),
	};
}

function asTaskParser(fake: FakeTaskParser): TaskParser {
	return fake as unknown as TaskParser;
}

interface FakeTaskMetadataParser {
	getDueDate: ReturnType<typeof vi.fn>;
	setDueDate: ReturnType<typeof vi.fn>;
	removeDueDate: ReturnType<typeof vi.fn>;
	getScheduledDate: ReturnType<typeof vi.fn>;
	setScheduledDate: ReturnType<typeof vi.fn>;
	removeScheduledDate: ReturnType<typeof vi.fn>;
	getPriority: ReturnType<typeof vi.fn>;
	setPriority: ReturnType<typeof vi.fn>;
	removePriority: ReturnType<typeof vi.fn>;
}

function createFakeTaskMetadataParser(): FakeTaskMetadataParser {
	return {
		getDueDate: vi.fn(),
		setDueDate: vi.fn(),
		removeDueDate: vi.fn(),
		getScheduledDate: vi.fn(),
		setScheduledDate: vi.fn(),
		removeScheduledDate: vi.fn(),
		getPriority: vi.fn(),
		setPriority: vi.fn(),
		removePriority: vi.fn(),
	};
}

function asTaskMetadataParser(fake: FakeTaskMetadataParser): TaskMetadataParser {
	return fake as unknown as TaskMetadataParser;
}

describe('IdAccessor', () => {
	it('exposes its marker type', () => {
		const parser = createFakeTaskParser();
		const accessor = new IdAccessor(asTaskParser(parser));
		expect(accessor.type).toBe(MarkerType.Id);
	});

	it('reads the value the parser returns for the line', () => {
		const parser = createFakeTaskParser();
		parser.getTaskId.mockReturnValue('abc123');
		const accessor = new IdAccessor(asTaskParser(parser));
		const line = '- [ ] Task \u{1F194} abc123';

		expect(accessor.read(line)).toBe('abc123');
		expect(parser.getTaskId).toHaveBeenCalledWith(line);
	});

	it('reads null when the parser finds no id', () => {
		const parser = createFakeTaskParser();
		parser.getTaskId.mockReturnValue(null);
		const accessor = new IdAccessor(asTaskParser(parser));

		expect(accessor.read(BARE_TASK)).toBeNull();
	});

	it('applies a value by removing any existing id first, then adding the new one', () => {
		const parser = createFakeTaskParser();
		parser.removeIdFromLine.mockReturnValue('- [ ] Task stripped');
		parser.addIdToLine.mockReturnValue('- [ ] Task stripped \u{1F194} new');
		const accessor = new IdAccessor(asTaskParser(parser));

		const result = accessor.apply('- [ ] Task \u{1F194} old', 'new');

		expect(parser.removeIdFromLine).toHaveBeenCalledWith('- [ ] Task \u{1F194} old');
		expect(parser.addIdToLine).toHaveBeenCalledWith('- [ ] Task stripped', 'new');
		expect(result).toBe('- [ ] Task stripped \u{1F194} new');
	});

	it('removes the id via the parser', () => {
		const parser = createFakeTaskParser();
		parser.removeIdFromLine.mockReturnValue(BARE_TASK);
		const accessor = new IdAccessor(asTaskParser(parser));
		const line = '- [ ] Task \u{1F194} abc123';

		expect(accessor.remove(line)).toBe(BARE_TASK);
		expect(parser.removeIdFromLine).toHaveBeenCalledWith(line);
	});

	it('reports a fragment when the glyph is present but the parser cannot read a value', () => {
		const parser = createFakeTaskParser();
		parser.getTaskId.mockReturnValue(null);
		const accessor = new IdAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{1F194}')).toBe(true);
	});

	it('does not report a fragment when the glyph is present and the parser reads a value', () => {
		const parser = createFakeTaskParser();
		parser.getTaskId.mockReturnValue('abc123');
		const accessor = new IdAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{1F194} abc123')).toBe(false);
	});

	it('does not report a fragment when the glyph is absent, without asking the parser', () => {
		const parser = createFakeTaskParser();
		const accessor = new IdAccessor(asTaskParser(parser));

		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
		expect(parser.getTaskId).not.toHaveBeenCalled();
	});
});

describe('DueAccessor', () => {
	it('exposes its marker type', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));
		expect(accessor.type).toBe(MarkerType.Due);
	});

	it('reads the due date the metadata parser returns', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getDueDate.mockReturnValue('2025-01-15');
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));
		const line = '- [ ] Task \u{1F4C5} 2025-01-15';

		expect(accessor.read(line)).toBe('2025-01-15');
		expect(metadataParser.getDueDate).toHaveBeenCalledWith(line);
	});

	it('reads null when the metadata parser finds no due date', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getDueDate.mockReturnValue(null);
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.read(BARE_TASK)).toBeNull();
	});

	it('applies a due date via the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.setDueDate.mockReturnValue('- [ ] Task \u{1F4C5} 2025-06-01');
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));

		const result = accessor.apply(BARE_TASK, '2025-06-01');

		expect(metadataParser.setDueDate).toHaveBeenCalledWith(BARE_TASK, '2025-06-01');
		expect(result).toBe('- [ ] Task \u{1F4C5} 2025-06-01');
	});

	it('removes the due date via the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.removeDueDate.mockReturnValue(BARE_TASK);
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));
		const line = '- [ ] Task \u{1F4C5} 2025-01-15';

		expect(accessor.remove(line)).toBe(BARE_TASK);
		expect(metadataParser.removeDueDate).toHaveBeenCalledWith(line);
	});

	it('reports a fragment when the due glyph is present but the metadata parser cannot read a value', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getDueDate.mockReturnValue(null);
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment('- [ ] Task \u{1F4C5}')).toBe(true);
	});

	it('reports a fragment for a partially typed due date', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getDueDate.mockReturnValue(null);
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment('- [ ] Task \u{1F4C5} 2025-0')).toBe(true);
	});

	it('does not report a fragment when the due glyph is present and the metadata parser reads a value', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getDueDate.mockReturnValue('2025-01-15');
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment('- [ ] Task \u{1F4C5} 2025-01-15')).toBe(false);
	});

	it('does not report a fragment when there is no due glyph at all, without asking the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor = new DueAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
		expect(metadataParser.getDueDate).not.toHaveBeenCalled();
	});
});

describe('ScheduledAccessor', () => {
	it('exposes its marker type', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));
		expect(accessor.type).toBe(MarkerType.Scheduled);
	});

	it('reads the scheduled date the metadata parser returns', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getScheduledDate.mockReturnValue('2025-04-10');
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));
		const line = '- [ ] Task \u{23F3} 2025-04-10';

		expect(accessor.read(line)).toBe('2025-04-10');
		expect(metadataParser.getScheduledDate).toHaveBeenCalledWith(line);
	});

	it('reads null when the metadata parser finds no scheduled date', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getScheduledDate.mockReturnValue(null);
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.read(BARE_TASK)).toBeNull();
	});

	it('applies a scheduled date via the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.setScheduledDate.mockReturnValue('- [ ] Task \u{23F3} 2025-06-02');
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));

		const result = accessor.apply(BARE_TASK, '2025-06-02');

		expect(metadataParser.setScheduledDate).toHaveBeenCalledWith(BARE_TASK, '2025-06-02');
		expect(result).toBe('- [ ] Task \u{23F3} 2025-06-02');
	});

	it('removes the scheduled date via the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.removeScheduledDate.mockReturnValue(BARE_TASK);
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));
		const line = '- [ ] Task \u{23F3} 2025-04-10';

		expect(accessor.remove(line)).toBe(BARE_TASK);
		expect(metadataParser.removeScheduledDate).toHaveBeenCalledWith(line);
	});

	it('reports a fragment when the scheduled glyph is present but the metadata parser cannot read a value', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getScheduledDate.mockReturnValue(null);
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment('- [ ] Task \u{23F3}')).toBe(true);
	});

	it('reports a fragment for a partially typed scheduled date', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getScheduledDate.mockReturnValue(null);
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment('- [ ] Task \u{23F3} 2025-0')).toBe(true);
	});

	it('does not report a fragment when the scheduled glyph is present and the metadata parser reads a value', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getScheduledDate.mockReturnValue('2025-04-10');
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment('- [ ] Task \u{23F3} 2025-04-10')).toBe(false);
	});

	it('does not report a fragment when there is no scheduled glyph at all, without asking the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor = new ScheduledAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
		expect(metadataParser.getScheduledDate).not.toHaveBeenCalled();
	});
});

describe('PriorityAccessor', () => {
	it('exposes its marker type', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));
		expect(accessor.type).toBe(MarkerType.Priority);
	});

	it('reads the priority the metadata parser returns', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getPriority.mockReturnValue('high');
		const accessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));
		const line = '- [ ] Task \u{23EB}';

		expect(accessor.read(line)).toBe('high');
		expect(metadataParser.getPriority).toHaveBeenCalledWith(line);
	});

	it('reads null when the metadata parser finds no priority', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.getPriority.mockReturnValue(null);
		const accessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.read(BARE_TASK)).toBeNull();
	});

	it('applies a priority via the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.setPriority.mockReturnValue('- [ ] Task \u{23EB}');
		const accessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));

		const result = accessor.apply(BARE_TASK, 'high');

		expect(metadataParser.setPriority).toHaveBeenCalledWith(BARE_TASK, 'high');
		expect(result).toBe('- [ ] Task \u{23EB}');
	});

	it('removes the priority via the metadata parser', () => {
		const metadataParser = createFakeTaskMetadataParser();
		metadataParser.removePriority.mockReturnValue(BARE_TASK);
		const accessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));
		const line = '- [ ] Task \u{23EB}';

		expect(accessor.remove(line)).toBe(BARE_TASK);
		expect(metadataParser.removePriority).toHaveBeenCalledWith(line);
	});

	it('never reports a fragment, since a priority glyph is a single code point', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor: MarkerAccessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment('- [ ] Task \u{23EB}')).toBe(false);
	});

	it('does not report a fragment when no priority glyph is present', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor: MarkerAccessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));

		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
	});

	it('does not ask the metadata parser when checking for a fragment', () => {
		const metadataParser = createFakeTaskMetadataParser();
		const accessor: MarkerAccessor = new PriorityAccessor(asTaskMetadataParser(metadataParser));

		accessor.hasFragment('- [ ] Task \u{23EB}');

		expect(metadataParser.getPriority).not.toHaveBeenCalled();
	});
});

describe('DependencyAccessor', () => {
	it('reads the dependency id set the parser returns', () => {
		const parser = createFakeTaskParser();
		parser.getTaskDependencies.mockReturnValue(['abc', 'def']);
		const accessor = new DependencyAccessor(asTaskParser(parser));
		const line = '- [ ] Task \u{26D4} abc,def';

		expect(accessor.read(line)).toEqual(new Set(['abc', 'def']));
		expect(parser.getTaskDependencies).toHaveBeenCalledWith(line);
	});

	it('reads an empty set when the parser finds no dependencies', () => {
		const parser = createFakeTaskParser();
		parser.getTaskDependencies.mockReturnValue([]);
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.read(BARE_TASK)).toEqual(new Set());
	});

	it('applies a dependency id via the parser', () => {
		const parser = createFakeTaskParser();
		parser.addDependencyToLine.mockReturnValue('- [ ] Task \u{26D4} abc');
		const accessor = new DependencyAccessor(asTaskParser(parser));

		const result = accessor.apply(BARE_TASK, 'abc');

		expect(parser.addDependencyToLine).toHaveBeenCalledWith(BARE_TASK, 'abc');
		expect(result).toBe('- [ ] Task \u{26D4} abc');
	});

	it('removes one dependency id via the parser, leaving the rest to the parser to decide', () => {
		const parser = createFakeTaskParser();
		parser.removeDependencyFromLine.mockReturnValue('- [ ] Task \u{26D4} def');
		const accessor = new DependencyAccessor(asTaskParser(parser));
		const line = '- [ ] Task \u{26D4} abc,def';

		const result = accessor.remove(line, 'abc');

		expect(parser.removeDependencyFromLine).toHaveBeenCalledWith(line, 'abc');
		expect(result).toBe('- [ ] Task \u{26D4} def');
	});

	it('does not report a fragment when no dependency glyph is present at all', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment(BARE_TASK)).toBe(false);
	});

	it('reports a fragment for a bare glyph with nothing after it', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4}')).toBe(true);
	});

	it('reports a fragment when the first id of a list was deleted, leaving a leading comma', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4} ,def')).toBe(true);
	});

	it('reports a fragment when the last id of a list was deleted, leaving a trailing comma', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc,')).toBe(true);
	});

	it('reports a fragment when a middle id was deleted, leaving two adjacent commas', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc,,def')).toBe(true);
	});

	it('reports a fragment when the last id was deleted along with its leading space, leaving a space then a lone comma', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc ,')).toBe(true);
	});

	it('does not report a fragment when a comma only appears later in unrelated text after a well-formed single id', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc more, text')).toBe(false);
	});

	it('does not report a fragment for a single well-formed id', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc')).toBe(false);
	});

	it('does not report a fragment for a well-formed multi-id list', () => {
		const parser = createFakeTaskParser();
		const accessor = new DependencyAccessor(asTaskParser(parser));

		expect(accessor.hasFragment('- [ ] Task \u{26D4} abc,def')).toBe(false);
	});
});

describe('MarkerAccessorRegistry', () => {
	function createRegistry(): MarkerAccessorRegistry {
		return new MarkerAccessorRegistry(
			asTaskParser(createFakeTaskParser()),
			asTaskMetadataParser(createFakeTaskMetadataParser()),
		);
	}

	it('exposes one accessor per single-value marker type', () => {
		const registry = createRegistry();
		const types = registry.markers.map((accessor) => accessor.type);

		expect(types).toEqual([
			MarkerType.Id,
			MarkerType.Due,
			MarkerType.Scheduled,
			MarkerType.Priority,
		]);
	});

	it('exposes a dependency accessor', () => {
		const registry = createRegistry();

		expect(registry.dependency).toBeInstanceOf(DependencyAccessor);
	});

	it('exposes the inheritable markers (due, scheduled, priority) excluding id', () => {
		const registry = createRegistry();
		const types = registry.inheritable.map((accessor) => accessor.type);

		expect(types).toEqual([MarkerType.Due, MarkerType.Scheduled, MarkerType.Priority]);
	});

	it('reuses the same accessor instances between markers and inheritable', () => {
		const registry = createRegistry();
		const dueFromMarkers = registry.markers.find((accessor) => accessor.type === MarkerType.Due);
		const dueFromInheritable = registry.inheritable.find(
			(accessor) => accessor.type === MarkerType.Due,
		);

		expect(dueFromInheritable).toBe(dueFromMarkers);
	});
});
