/**
 * Indentation-based dependency linking for the Tasks Auto-Dependency Linker.
 *
 * Detects parent-child relationships from indentation and automatically
 * adds `🆔` / `⛔` markers using {@link TaskParser} and {@link IdEngine}.
 */

import { TaskParser } from './task-parser';
import { IdEngine } from './id-engine';
import type { RelationshipAnalyzer } from './relationship-analyzer';
import type { MetadataInheritor } from './metadata-inheritor';
import type { LineEditor } from './types';

/**
 * Processes indentation changes and manages task dependency markers.
 *
 * Instantiate with a {@link TaskParser}, {@link IdEngine},
 * {@link RelationshipAnalyzer}, and {@link MetadataInheritor}, then call
 * {@link processLine} on each line that may have changed indentation.
 */
export class IndentationHandler {
	private readonly parser: TaskParser;
	private readonly relAnalyzer: RelationshipAnalyzer;
	private readonly idEngine: IdEngine;
	private readonly inheritor: MetadataInheritor;
	/** Snapshot of editor lines set once before each link pass. */
	private snapshot: string[] = new Array<string>();

	constructor(
		parser: TaskParser,
		idEngine: IdEngine,
		relAnalyzer: RelationshipAnalyzer,
		inheritor: MetadataInheritor,
	) {
		this.parser = parser;
		this.idEngine = idEngine;
		this.relAnalyzer = relAnalyzer;
		this.inheritor = inheritor;
	}

	/**
	 * Reads all editor lines into the internal snapshot.
	 *
	 * Call once before the link-pass loop so that every subsequent
	 * {@link processLine} call can find parent tasks from the snapshot
	 * in O(1) per line rather than rebuilding the full array on each call.
	 */
	prepareForLinkPass(editor: LineEditor): void {
		const count = editor.lineCount();
		this.snapshot = [];
		for (let i = 0; i < count; i++) {
			this.snapshot.push(editor.getLine(i));
		}
	}

	/**
	 * Processes a single line: if it is an indented task with a parent,
	 * ensures the child has a `🆔` and the parent has a `⛔` for that ID,
	 * then synchronises the parent's metadata onto the child.
	 *
	 * The child inherits the parent's due date, scheduled date, and
	 * priority when it has none of its own, and later receives the
	 * parent's changes as long as it still holds the previously inherited
	 * value. A value the user has changed on the child is left alone. See
	 * {@link syncMetadataFromParent}.
	 *
	 * The link between a freshly minted child id and the parent's matching
	 * `⛔` entry is atomic: both are written or neither is. When a new id
	 * had to be minted for the child, this method checks whether the
	 * parent's dependency list, as it actually reads after the write, ends
	 * up containing that id. If the parent's write was refused (for
	 * example because its `⛔` marker is a mid-edit fragment on the cursor
	 * line) and the id did not land, the whole operation is abandoned: the
	 * child line is left untouched, metadata inheritance does not run, and
	 * the minted id is discarded without ever being written anywhere. The
	 * next link pass mints a fresh id and repeats the same check, so once
	 * the parent's fragment resolves the link is established normally.
	 * When the child already carried an id before this call, the linkage
	 * already exists and this check is skipped: today's behaviour
	 * (inheritance still runs, the child write still happens) is
	 * unchanged even if the parent's write is refused.
	 *
	 * Never mutates `existingIds`. Returns the newly minted id only when
	 * that id was actually committed to the document together with the
	 * parent's dependency. Returns `null` both when no new id was minted
	 * and when a mint was abandoned because the parent refused the link.
	 */
	processLine(
		editor: LineEditor,
		lineIndex: number,
		existingIds: ReadonlySet<string>,
	): string | null {
		const parentIndex = this.relAnalyzer.findParentTask(this.snapshot, lineIndex);
		if (parentIndex === null) {
			return null;
		}

		let childLine = editor.getLine(lineIndex);
		let childId = this.parser.getTaskId(childLine);
		let mintedId: string | null = null;
		if (!childId) {
			childId = this.idEngine.generateUniqueId(existingIds);
			childLine = this.parser.addIdToLine(childLine, childId);
			mintedId = childId;
		}

		const parentLine = editor.getLine(parentIndex);
		const updatedParentLine = this.parser.addDependencyToLine(
			parentLine,
			childId,
		);
		if (updatedParentLine !== parentLine) {
			const writtenParentLine = editor.setLine(parentIndex, updatedParentLine);
			if (
				mintedId !== null &&
				!this.parser.getTaskDependencies(writtenParentLine).includes(mintedId)
			) {
				return null;
			}
		}

		childLine = this.inheritor.syncFromParent(childId, childLine, parentLine);

		if (childLine !== editor.getLine(lineIndex)) {
			editor.setLine(lineIndex, childLine);
		}
		this.inheritor.confirmWrite(editor.getLine(lineIndex));

		return mintedId;
	}


	/**
	 * Removes `⛔` markers from a task line that are not in the desired
	 * set of dependency IDs. Returns the updated line.
	 *
	 * When `managedIds` is provided, only deps whose ID is in that set
	 * are considered for removal. Deps referencing IDs outside the set
	 * (e.g. cross-list references) are left untouched.
	 */
	removeStaleDeps(
		line: string,
		desiredDeps: Set<string>,
		managedIds?: Set<string>,
	): string {
		let result = line;
		for (const dep of this.parser.getTaskDependencies(line)) {
			if (managedIds && !managedIds.has(dep)) {
				continue;
			}
			if (!desiredDeps.has(dep)) {
				result = this.parser.removeDependencyFromLine(result, dep);
			}
		}
		return result;
	}

	/**
	 * Returns true if the given ID is referenced as a `⛔` dependency
	 * on any line in the provided array.
	 */
	isIdReferencedAsDep(lines: string[], id: string): boolean {
		for (const line of lines) {
			if (this.parser.getTaskDependencies(line).includes(id)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Removes `⛔` markers that reference IDs with no corresponding `🆔`
	 * in the document. Returns the updated line.
	 *
	 * A `⛔` is considered dangling when the ID it references does not
	 * appear as a `🆔` marker anywhere in the provided `knownIds` set.
	 * This handles the case where a child task was deleted entirely.
	 *
	 * Uses the live document IDs (not the vault cache) as the source of
	 * truth, because the vault cache may be stale for the current file
	 * during an editing session.
	 */
	removeDanglingDeps(
		line: string,
		knownIds: Set<string>,
	): string {
		let result = line;
		for (const dep of this.parser.getTaskDependencies(line)) {
			if (!knownIds.has(dep)) {
				result = this.parser.removeDependencyFromLine(result, dep);
			}
		}
		return result;
	}
}
