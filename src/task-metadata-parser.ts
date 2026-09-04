/**
 * Parses and applies Obsidian Tasks metadata markers that subtasks
 * inherit from their parent: due date, scheduled date, and priority.
 *
 * Separate from {@link TaskParser} (which handles `🆔` / `⛔` markers)
 * so each file stays within the FTA complexity budget and keeps a
 * single responsibility.
 *
 * Read regexes tolerate the alternate glyphs that the Tasks plugin
 * itself accepts (for example `📆` and `🗓` for due dates), mirroring
 * the plugin's "broad compatibility" philosophy. Write methods always
 * emit the canonical glyph.
 */
/** Obsidian Tasks priority levels that have an emoji signifier. */
export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export class TaskMetadataParser {
	/**
	 * Captures a due date `YYYY-MM-DD` after a due-date glyph.
	 * Tolerates the calendar (`📅`), tear-off calendar (`📆`), and
	 * spiral calendar (`🗓`) glyphs. No `$` anchor: the marker may
	 * appear anywhere on the task line.
	 */
	static readonly DUE_REGEX = /[\u{1F4C5}\u{1F4C6}\u{1F5D3}]\s(\d{4}-\d{2}-\d{2})/u;


	/**
	 * Matches any due-date glyph regardless of what follows it. Used to
	 * detect a due marker that is present but not yet a well-formed date
	 * (mid-deletion, or mid-typing), which {@link DUE_REGEX} alone cannot
	 * distinguish from "no due marker at all".
	 */
	static readonly DUE_GLYPH_REGEX = /[\u{1F4C5}\u{1F4C6}\u{1F5D3}]/u;

	/** Extracts the due date from a line, or null when absent. */
	getDueDate(line: string): string | null {
		const match = line.match(TaskMetadataParser.DUE_REGEX);
		return match ? match[1]! : null;
	}

	/**
	 * Removes a due-date marker (including tolerated alternate glyphs)
	 * from the line. Cleans up the surrounding whitespace so a mid-line
	 * removal does not leave a double space. Returns the line unchanged
	 * when no due date is present.
	 */
	removeDueDate(line: string): string {
		const pattern = /\s?[\u{1F4C5}\u{1F4C6}\u{1F5D3}]\s\d{4}-\d{2}-\d{2}/u;
		if (!pattern.test(line)) {
			return line;
		}
		return line.replace(pattern, '').trimEnd();
	}

	/**
	 * Captures a scheduled date `YYYY-MM-DD` after a scheduled-date glyph.
	 * Tolerates the hourglass-flowing (`⏳`) and hourglass-done (`⌛`)
	 * glyphs. No `$` anchor: the marker may appear anywhere on the line.
	 */
	static readonly SCHEDULED_REGEX = /[\u{23F3}\u{231B}]\s(\d{4}-\d{2}-\d{2})/u;


	/**
	 * Matches any scheduled-date glyph regardless of what follows it. Used
	 * to detect a scheduled marker that is present but not yet a
	 * well-formed date, which {@link SCHEDULED_REGEX} alone cannot
	 * distinguish from "no scheduled marker at all".
	 */
	static readonly SCHEDULED_GLYPH_REGEX = /[\u{23F3}\u{231B}]/u;

	/** Extracts the scheduled date from a line, or null when absent. */
	getScheduledDate(line: string): string | null {
		const match = line.match(TaskMetadataParser.SCHEDULED_REGEX);
		return match ? match[1]! : null;
	}

	/**
	 * Removes a scheduled-date marker (including the tolerated alternate
	 * glyph) from the line. Cleans up the surrounding whitespace so a
	 * mid-line removal does not leave a double space. Returns the line
	 * unchanged when no scheduled date is present.
	 */
	removeScheduledDate(line: string): string {
		const pattern = /\s?[\u{23F3}\u{231B}]\s\d{4}-\d{2}-\d{2}/u;
		if (!pattern.test(line)) {
			return line;
		}
		return line.replace(pattern, '').trimEnd();
	}

	/**
	 * Maps each {@link Priority} level to its canonical Tasks glyph.
	 * Normal priority has no glyph and is therefore absent from this map.
	 * Used in both directions: reading (which glyph is on a line) and
	 * writing (which glyph to append for a given level).
	 */
	static readonly GLYPH_BY_PRIORITY: ReadonlyMap<Priority, string> = new Map([
		['highest', '\u{1F53A}'],
		['high', '\u{23EB}'],
		['medium', '\u{1F53C}'],
		['low', '\u{1F53D}'],
		['lowest', '\u{23EC}'],
	]);

	/** Extracts the priority level from a line, or null when absent. */
	getPriority(line: string): Priority | null {
		for (const [priority, glyph] of TaskMetadataParser.GLYPH_BY_PRIORITY) {
			if (line.includes(glyph)) {
				return priority;
			}
		}
		return null;
	}

	/**
	 * Appends a canonical due-date marker (`📅 <date>`) to the line.
	 * Returns the line unchanged when it already has a due date, so an
	 * inherited value never overwrites one the user set themselves.
	 */
	applyDueDate(line: string, date: string): string {
		if (this.getDueDate(line) !== null) {
			return line;
		}
		return `${line} \u{1F4C5} ${date}`;
	}

	/**
	 * Sets the due date on the line, replacing any existing due-date
	 * marker (including tolerated alternate glyphs) with the canonical
	 * `📅 <date>`. Appends a new marker when none is present. Unlike
	 * {@link applyDueDate}, this overwrites an existing value; it is used
	 * to propagate a changed parent value to a child that still holds the
	 * previously inherited value.
	 */
	setDueDate(line: string, date: string): string {
		if (this.getDueDate(line) === null) {
			return this.applyDueDate(line, date);
		}
		return line.replace(
			TaskMetadataParser.DUE_REGEX,
			`\u{1F4C5} ${date}`,
		);
	}

	/**
	 * Appends a canonical scheduled-date marker (`⏳ <date>`) to the line.
	 * Returns the line unchanged when it already has a scheduled date.
	 */
	applyScheduledDate(line: string, date: string): string {
		if (this.getScheduledDate(line) !== null) {
			return line;
		}
		return `${line} \u{23F3} ${date}`;
	}

	/**
	 * Sets the scheduled date on the line, replacing any existing
	 * scheduled-date marker (including the tolerated alternate glyph)
	 * with the canonical `⏳ <date>`. Appends a new marker when none is
	 * present. Unlike {@link applyScheduledDate}, this overwrites an
	 * existing value to propagate a changed parent value.
	 */
	setScheduledDate(line: string, date: string): string {
		if (this.getScheduledDate(line) === null) {
			return this.applyScheduledDate(line, date);
		}
		return line.replace(
			TaskMetadataParser.SCHEDULED_REGEX,
			`\u{23F3} ${date}`,
		);
	}

	/**
	 * Appends the canonical priority glyph to the line. Returns the line
	 * unchanged when it already carries any priority, so an inherited
	 * priority never overwrites one the user set themselves.
	 */
	applyPriority(line: string, priority: Priority): string {
		if (this.getPriority(line) !== null) {
			return line;
		}
		const glyph = TaskMetadataParser.GLYPH_BY_PRIORITY.get(priority)!;
		return `${line} ${glyph}`;
	}

	/**
	 * Sets the priority on the line, replacing any existing priority
	 * glyph with the canonical glyph for the given level. Appends a new
	 * glyph when none is present. Unlike {@link applyPriority}, this
	 * overwrites an existing value to propagate a changed parent value.
	 */
	setPriority(line: string, priority: Priority): string {
		const current = this.getPriority(line);
		const glyph = TaskMetadataParser.GLYPH_BY_PRIORITY.get(priority)!;
		if (current === null) {
			return `${line} ${glyph}`;
		}
		const currentGlyph = TaskMetadataParser.GLYPH_BY_PRIORITY.get(current)!;
		return line.replace(currentGlyph, glyph);
	}


	/**
	 * Removes the priority glyph from the line, whichever level it is.
	 * Cleans up the surrounding whitespace so a mid-line removal does
	 * not leave a double space. Returns the line unchanged when no
	 * priority is present.
	 */
	removePriority(line: string): string {
		const current = this.getPriority(line);
		if (current === null) {
			return line;
		}
		const glyph = TaskMetadataParser.GLYPH_BY_PRIORITY.get(current)!;
		const pattern = new RegExp(`\\s?${glyph}`);
		return line.replace(pattern, '').trimEnd();
	}
}
