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

/** Default config matching Obsidian's defaults (useTab: true, tabSize: 4). */
export const DEFAULT_INDENT_CONFIG: IndentConfig = {
	useTab: true,
	tabSize: 4,
};

/**
 * Parses and manipulates Obsidian Tasks lines.
 *
 * Immutable: each instance is bound to a fixed indentation config.
 * Create one per plugin lifecycle (or when settings change) and pass
 * it to the indentation handler.
 */
export class TaskParser {
	/** Matches a task line: optional whitespace, then `- [ ] ` or `* [ ] `. */
	static readonly TASK_REGEX = /^\s*([-*]\s\[.\]\s)/;

	/** Captures the 6-char lowercase alphanumeric ID after the `🆔` emoji. */
	static readonly ID_REGEX = /🆔\s([a-z0-9]{6})/;

	/** Captures each dependency ID after the `⛔` emoji (global). */
	static readonly DEP_REGEX = /⛔\s([a-z0-9]{6})/g;

	private readonly indentConfig: IndentConfig;

	constructor(indentConfig: IndentConfig = DEFAULT_INDENT_CONFIG) {
		this.indentConfig = indentConfig;
	}

	/** Returns true when the line is a task (has a checkbox marker). */
	isTaskLine(line: string): boolean {
		return TaskParser.TASK_REGEX.test(line);
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

	/** Extracts the 6-char ID from a `🆔` marker, or null. */
	getTaskId(line: string): string | null {
		const match = line.match(TaskParser.ID_REGEX);
		return match ? match[1]! : null;
	}

	/** Returns all dependency IDs (`⛔`) found on the line. */
	getTaskDependencies(line: string): string[] {
		return [...line.matchAll(TaskParser.DEP_REGEX)].map((m) => m[1]!);
	}

	/** Appends `🆔 <id>`. Returns unchanged if already present. */
	addIdToLine(line: string, id: string): string {
		if (this.getTaskId(line) === id) {
			return line;
		}
		return `${line} 🆔 ${id}`;
	}

	/** Appends `⛔ <id>`. Returns unchanged if already present. */
	addDependencyToLine(line: string, depId: string): string {
		if (this.getTaskDependencies(line).includes(depId)) {
			return line;
		}
		return `${line} ⛔ ${depId}`;
	}

	/** Removes a specific `⛔ <id>` dependency. Cleans up whitespace. */
	removeDependencyFromLine(line: string, depId: string): string {
		const pattern = new RegExp(`\\s?⛔\\s${depId}`);
		return line.replace(pattern, '').trimEnd();
	}
}
