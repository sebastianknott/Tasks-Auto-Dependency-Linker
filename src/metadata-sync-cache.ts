/**
 * Tracks, per child task id, the metadata values most recently
 * inherited from that child's parent.
 *
 * This record lets the inheritance logic distinguish a child that still
 * holds the value it inherited (and should therefore receive the
 * parent's next change) from a child the user has deliberately given a
 * different value (which must be left alone). The cache is rebuilt from
 * the vault on load and refreshed per file on save, mirroring the
 * id and dependency caches.
 */

import type { FileEntry } from './id-engine';
import type { RelationshipAnalyzer } from './relationship-analyzer';
import type { TaskParser } from './task-parser';
import type { Priority, TaskMetadataParser } from './task-metadata-parser';

/** The set of metadata fields tracked for inheritance. */
export type MetadataField = 'due' | 'scheduled' | 'priority';

/** The last value inherited from a parent for each tracked field. */
export interface SyncedMetadata {
	due: string | null;
	scheduled: string | null;
	priority: Priority | null;
}

export class MetadataSyncCache {
	private readonly parser: TaskParser;
	private readonly metadataParser: TaskMetadataParser;
	private readonly relAnalyzer: RelationshipAnalyzer;

	/** childId to the last metadata inherited from its parent. */
	private readonly records: Map<string, SyncedMetadata> = new Map();

	/** filePath to the child ids that file currently contributes. */
	private readonly idsByFile: Map<string, Set<string>> = new Map();

	constructor(
		parser: TaskParser,
		metadataParser: TaskMetadataParser,
		relAnalyzer: RelationshipAnalyzer,
	) {
		this.parser = parser;
		this.metadataParser = metadataParser;
		this.relAnalyzer = relAnalyzer;
	}

	/** Returns the last-inherited metadata for a child, or undefined. */
	get(childId: string): SyncedMetadata | undefined {
		return this.records.get(childId);
	}

	/**
	 * Records a freshly propagated value for one field of a child,
	 * creating the record (with the other fields null) when absent.
	 */
	set(childId: string, field: MetadataField, value: string | null): void {
		const existing = this.records.get(childId) ?? {
			due: null,
			scheduled: null,
			priority: null,
		};
		const updated: SyncedMetadata = { ...existing, [field]: value };
		this.records.set(childId, updated);
	}

	/** Rebuilds the whole cache from scratch from the given files. */
	buildFromFiles(files: FileEntry[]): void {
		this.records.clear();
		this.idsByFile.clear();
		for (const file of files) {
			this.seedFile(file.path, file.content);
		}
	}

	/** Reseeds a single file, pruning its previously contributed ids. */
	updateForFile(filePath: string, content: string): void {
		this.pruneFile(filePath);
		this.seedFile(filePath, content);
	}

	/** Removes all records previously contributed by the given file. */
	pruneFile(filePath: string): void {
		const prefix = `${filePath}/`;
		for (const path of this.idsByFile.keys()) {
			if (path === filePath || path.startsWith(prefix)) {
				this.pruneExactPath(path);
			}
		}
	}

	private pruneExactPath(filePath: string): void {
		const previousIds = this.idsByFile.get(filePath);
		if (previousIds === undefined) {
			return;
		}
		for (const id of previousIds) {
			this.records.delete(id);
		}
		this.idsByFile.delete(filePath);
	}

	/**
	 * Walks one file's parent-child structure and seeds each child's
	 * last-inherited record. For every field the seed is the parent's
	 * value only when the child already holds a value of its own;
	 * otherwise it is null, so a value the parent gains later is still
	 * recognised as a change and propagated to the empty child.
	 */
	private seedFile(filePath: string, content: string): void {
		const lines = content.split('\n');
		const relationships = this.relAnalyzer.buildRelationshipMap(lines);
		const fileIds = new Set<string>();
		for (const [childIndex, parentIndex] of relationships) {
			const childLine = lines[childIndex]!;
			const childId = this.parser.getTaskId(childLine);
			if (childId === null) {
				continue;
			}
			const parentLine = lines[parentIndex]!;
			this.records.set(childId, {
				due: this.seedValue(
					this.metadataParser.getDueDate(parentLine),
					this.metadataParser.getDueDate(childLine),
				),
				scheduled: this.seedValue(
					this.metadataParser.getScheduledDate(parentLine),
					this.metadataParser.getScheduledDate(childLine),
				),
				priority: this.seedValue(
					this.metadataParser.getPriority(parentLine),
					this.metadataParser.getPriority(childLine),
				),
			});
			fileIds.add(childId);
		}
		this.idsByFile.set(filePath, fileIds);
	}

	/**
	 * Reconstructs the last-inherited value for one field on a cold seed.
	 * Records the parent's value when the child holds a value of its own
	 * (so a matching value keeps following the parent while a differing
	 * value stays protected), and null when the child holds nothing yet
	 * (so the parent's current value propagates on the next pass).
	 */
	private seedValue<T extends string>(parentValue: T | null, childValue: T | null): T | null {
		return childValue === null ? null : parentValue;
	}
}
