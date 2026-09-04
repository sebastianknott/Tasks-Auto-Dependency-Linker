/**
 * Small per-marker-type wrappers over {@link TaskParser} and
 * {@link TaskMetadataParser}, giving the line write arbiter a uniform
 * `read` / `apply` / `remove` surface for every marker it can suppress.
 *
 * Kept in its own file, separate from the arbiter itself, so the state
 * machine in `line-write-arbiter.ts` stays within the FTA complexity
 * budget. Five marker types times three operations in one file would
 * not.
 *
 * `apply` always force-sets: the line ends up holding exactly the given
 * value for that marker, replacing any existing value rather than
 * appending a second marker alongside it. Exception: a date accessor's
 * `apply` cannot replace a fragmentary existing value (one `read`
 * cannot parse), since `setDueDate` / `setScheduledDate` fall back to
 * appending when there is nothing well-formed to replace. Callers who
 * must not append onto a fragment should check `hasFragment` first.
 */
import { TaskParser } from './task-parser';
import { TaskMetadataParser, type Priority } from './task-metadata-parser';

/** The single-value marker types the arbiter can suppress per line. */
export enum MarkerType {
	Id = 'id',
	Due = 'due',
	Scheduled = 'scheduled',
	Priority = 'priority',
}

/**
 * Reads, force-sets, and removes one single-value marker type on a
 * task line.
 */
export interface MarkerAccessor {
	readonly type: MarkerType;
	read(line: string): string | null;
	apply(line: string, value: string): string;
	remove(line: string): string;
	/**
	 * True when the line carries this marker's glyph but the text after
	 * it does not parse into a well-formed value: the user is mid-way
	 * through typing or deleting it. `read` alone cannot tell this
	 * apart from "no marker at all", since both return null.
	 */
	hasFragment(line: string): boolean;
}

/** `🆔` accessor. */
export class IdAccessor implements MarkerAccessor {
	readonly type = MarkerType.Id;

	constructor(private readonly parser: TaskParser) {}

	read(line: string): string | null {
		return this.parser.getTaskId(line);
	}

	apply(line: string, value: string): string {
		return this.parser.addIdToLine(this.parser.removeIdFromLine(line), value);
	}

	remove(line: string): string {
		return this.parser.removeIdFromLine(line);
	}

	hasFragment(line: string): boolean {
		return line.includes('\u{1F194}') && this.read(line) === null;
	}
}

/** `📅` accessor. */
export class DueAccessor implements MarkerAccessor {
	readonly type = MarkerType.Due;

	constructor(private readonly metadataParser: TaskMetadataParser) {}

	read(line: string): string | null {
		return this.metadataParser.getDueDate(line);
	}

	apply(line: string, value: string): string {
		return this.metadataParser.setDueDate(line, value);
	}

	remove(line: string): string {
		return this.metadataParser.removeDueDate(line);
	}

	hasFragment(line: string): boolean {
		return TaskMetadataParser.DUE_GLYPH_REGEX.test(line) && this.read(line) === null;
	}
}

/** `⏳` accessor. */
export class ScheduledAccessor implements MarkerAccessor {
	readonly type = MarkerType.Scheduled;

	constructor(private readonly metadataParser: TaskMetadataParser) {}

	read(line: string): string | null {
		return this.metadataParser.getScheduledDate(line);
	}

	apply(line: string, value: string): string {
		return this.metadataParser.setScheduledDate(line, value);
	}

	remove(line: string): string {
		return this.metadataParser.removeScheduledDate(line);
	}

	hasFragment(line: string): boolean {
		return TaskMetadataParser.SCHEDULED_GLYPH_REGEX.test(line) && this.read(line) === null;
	}
}

/** Priority glyph accessor. */
export class PriorityAccessor implements MarkerAccessor {
	readonly type = MarkerType.Priority;

	constructor(private readonly metadataParser: TaskMetadataParser) {}

	read(line: string): string | null {
		return this.metadataParser.getPriority(line);
	}

	apply(line: string, value: string): string {
		return this.metadataParser.setPriority(line, value as Priority);
	}

	remove(line: string): string {
		return this.metadataParser.removePriority(line);
	}

	/**
	 * Always false: a priority glyph is a single code point, so it is
	 * either fully present or fully absent. There is no partially-typed
	 * state for `read` to miss, unlike the date and id markers.
	 */
	hasFragment(): boolean {
		return false;
	}
}

/**
 * `⛔` accessor. Works on the dependency id *set* rather than a single
 * value, since a line can hold several dependencies at once and the
 * arbiter must be able to freeze one id while letting another through.
 */
export class DependencyAccessor {
	constructor(private readonly parser: TaskParser) {}

	read(line: string): Set<string> {
		return new Set(this.parser.getTaskDependencies(line));
	}

	apply(line: string, depId: string): string {
		return this.parser.addDependencyToLine(line, depId);
	}

	remove(line: string, depId: string): string {
		return this.parser.removeDependencyFromLine(line, depId);
	}

	/**
	 * True when a `⛔` glyph is present but the text after it is not a
	 * clean, fully-consumed comma-separated id list: the user is
	 * mid-edit (a bare glyph, a leading/trailing/doubled comma left by
	 * deleting one id out of a list). {@link TaskParser.DEP_REGEX} stops
	 * consuming at the first malformed id, so a leftover fragment can
	 * survive right after an otherwise well-formed match; checking the
	 * remainder catches that case that `read` alone would miss.
	 */
	hasFragment(line: string): boolean {
		if (!line.includes('\u26D4')) {
			return false;
		}
		const match = line.match(TaskParser.DEP_REGEX);
		if (!match) {
			return true;
		}
		const remainder = line.slice(match.index! + match[0].length);
		return /^\s*,/.test(remainder);
	}
}

/**
 * Registry of every marker accessor, constructed once and injected into
 * the arbiter. The arbiter iterates {@link markers} for the four
 * single-value marker types and consults {@link dependency} separately
 * for per-id suppression.
 */
export class MarkerAccessorRegistry {
	readonly markers: readonly MarkerAccessor[];
	readonly inheritable: readonly MarkerAccessor[];
	readonly dependency: DependencyAccessor;

	constructor(parser: TaskParser, metadataParser: TaskMetadataParser) {
		const due = new DueAccessor(metadataParser);
		const scheduled = new ScheduledAccessor(metadataParser);
		const priority = new PriorityAccessor(metadataParser);
		this.markers = [new IdAccessor(parser), due, scheduled, priority];
		this.inheritable = [due, scheduled, priority];
		this.dependency = new DependencyAccessor(parser);
	}
}
