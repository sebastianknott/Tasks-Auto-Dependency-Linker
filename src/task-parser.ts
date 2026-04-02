/**
 * Regex-based task line parsing for the Tasks Auto-Dependency Linker plugin.
 *
 * Exposes the {@link TaskParser} class which detects, inspects, and modifies
 * Obsidian Tasks lines (checkboxes with `- [ ]` or `* [ ]` syntax).
 */

/**
 * Configuration for indentation detection, derived from
 * Obsidian vault config (`useTab`, `tabSize`).
 */
export interface IndentConfig {
	readonly useTab: boolean;
	readonly tabSize: number;
}

/**
 * Parses and manipulates Obsidian Tasks lines.
 *
 * Immutable: each instance is bound to a fixed indentation config.
 * Create one per plugin lifecycle (or when settings change) and pass
 * it to the indentation handler.
 */
export class TaskParser {
	/** Default config matching Obsidian's defaults (useTab: true, tabSize: 4). */
	static readonly DEFAULT_CONFIG: IndentConfig = {
		useTab: true,
		tabSize: 4,
	};

	/** Matches a task line: optional whitespace, then `- [ ] ` or `* [ ] `. */
	static readonly TASK_REGEX = /^\s*([-*]\s\[.\]\s)/;

	/** Matches any list item: optional whitespace, then `- ` or `* `. */
	static readonly LIST_ITEM_REGEX = /^\s*[-*]\s/;

	/** Captures the ID after the `🆔` emoji. Tolerates `[a-zA-Z0-9_-]+`. */
	static readonly ID_REGEX = /🆔\s([a-zA-Z0-9_-]+)/;

	/**
	 * Captures the comma-separated dependency ID list after a single `⛔` emoji.
	 * Matches format: `⛔ id1,id2,id3` (with optional spaces around commas).
	 * Tolerates `[a-zA-Z0-9_-]+` for each ID.
	 * No `$` anchor because the `⛔` marker may appear before a `🆔` marker.
	 */
	static readonly DEP_REGEX = /⛔\s([a-zA-Z0-9_-]+(?:\s*,\s*[a-zA-Z0-9_-]+)*)/;

	private readonly indentConfig: IndentConfig;

	constructor(indentConfig: IndentConfig = TaskParser.DEFAULT_CONFIG) {
		this.indentConfig = indentConfig;
	}

	/** Returns true when the line is a task (has a checkbox marker). */
	isTaskLine(line: string): boolean {
		return TaskParser.TASK_REGEX.test(line);
	}

	/** Returns true when the line is any list item (bullet or task). */
	isListItem(line: string): boolean {
		return TaskParser.LIST_ITEM_REGEX.test(line);
	}

	/**
	 * Returns the indent level of a line.
	 *
	 * Handles tabs, spaces, and mixed indentation. Each leading tab
	 * counts as one full indent level. When `useTab` is false,
	 * remaining leading spaces are divided by `tabSize` (floored).
	 */
	getIndentLevel(line: string): number {
		const match = line.match(/^(\s+)/);
		if (!match) {
			return 0;
		}
		const whitespace = match[1]!;

		let tabs = 0;
		let spaces = 0;
		for (const ch of whitespace) {
			if (ch === '\t') {
				tabs++;
			} else {
				spaces++;
			}
		}

		if (this.indentConfig.useTab) {
			return tabs;
		}

		return tabs + Math.floor(spaces / this.indentConfig.tabSize);
	}

	/** Extracts the ID from a `🆔` marker, or null. */
	getTaskId(line: string): string | null {
		const match = line.match(TaskParser.ID_REGEX);
		return match ? match[1]! : null;
	}

	/** Returns all dependency IDs (`⛔`) found on the line as an array. */
	getTaskDependencies(line: string): string[] {
		const match = line.match(TaskParser.DEP_REGEX);
		if (!match) {
			return [];
		}
		return match[1]!.split(',').map((id) => id.trim());
	}

	/** Appends `🆔 <id>`. Returns unchanged if already present. */
	addIdToLine(line: string, id: string): string {
		if (this.getTaskId(line) === id) {
			return line;
		}
		return `${line} 🆔 ${id}`;
	}

	/**
	 * Adds a dependency ID to the line. If the line already has a `⛔` marker,
	 * appends the ID to the comma-separated list. Otherwise, appends `⛔ <id>`.
	 * Returns unchanged if the dependency already exists.
	 */
	addDependencyToLine(line: string, depId: string): string {
		if (this.getTaskDependencies(line).includes(depId)) {
			return line;
		}
		const match = line.match(TaskParser.DEP_REGEX);
		if (match) {
			const insertAt = match.index! + match[0].length;
			return (
				line.substring(0, insertAt) +
				`,${depId}` +
				line.substring(insertAt)
			);
		}
		return `${line} ⛔ ${depId}`;
	}

	/**
	 * Removes a single dependency ID from the comma-separated list.
	 * If it was the last ID, removes the entire `⛔ ...` marker.
	 * Returns unchanged if the dependency does not exist.
	 */
	removeDependencyFromLine(line: string, depId: string): string {
		const match = line.match(TaskParser.DEP_REGEX);
		if (!match) {
			return line;
		}
		const deps = match[1]!.split(',').map((id) => id.trim());
		if (!deps.includes(depId)) {
			return line;
		}
		const remaining = deps.filter((id) => id !== depId);
		// Strip the ⛔ marker using the match position, preserving any suffix
		const markerStart = match.index!;
		const markerEnd = markerStart + match[0].length;
		const prefix = line.substring(0, markerStart).trimEnd();
		const suffix = line.substring(markerEnd);
		if (remaining.length === 0) {
			return (prefix + suffix).trimEnd();
		}
		return `${prefix} ⛔ ${remaining.join(',')}${suffix}`;
	}

	/** Removes the `🆔 <id>` marker from a line. Cleans up whitespace. */
	removeIdFromLine(line: string): string {
		const pattern = /\s?🆔\s[a-zA-Z0-9_-]+/;
		return line.replace(pattern, '').trimEnd();
	}
}
