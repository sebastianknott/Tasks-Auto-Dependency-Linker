/**
 * Propagates a parent task's metadata onto its child, honouring the
 * "inherited until overridden" rule.
 *
 * A child receives the parent's due date, scheduled date, and priority
 * when it has none of its own, and keeps receiving the parent's changes
 * as long as it still holds the previously inherited value. A value the
 * user changed on the child is left alone, and clearing the parent's
 * field never removes the child's value. Start dates (`🛫`) are not
 * inherited.
 */

import type { MetadataField, MetadataSyncCache } from './metadata-sync-cache';
import type { TaskMetadataParser } from './task-metadata-parser';

export class MetadataInheritor {
	private readonly metadataParser: TaskMetadataParser;
	private readonly syncCache: MetadataSyncCache;

	constructor(metadataParser: TaskMetadataParser, syncCache: MetadataSyncCache) {
		this.metadataParser = metadataParser;
		this.syncCache = syncCache;
	}

	/**
	 * Synchronises every tracked field from the parent line onto the
	 * child line, returning the (possibly updated) child line.
	 */
	syncFromParent(childId: string, childLine: string, parentLine: string): string {
		let result = childLine;
		result = this.syncField(
			childId,
			'due',
			this.metadataParser.getDueDate(parentLine),
			this.metadataParser.getDueDate(result),
			(line, value) => this.metadataParser.setDueDate(line, value),
			result,
		);
		result = this.syncField(
			childId,
			'scheduled',
			this.metadataParser.getScheduledDate(parentLine),
			this.metadataParser.getScheduledDate(result),
			(line, value) => this.metadataParser.setScheduledDate(line, value),
			result,
		);
		result = this.syncField(
			childId,
			'priority',
			this.metadataParser.getPriority(parentLine),
			this.metadataParser.getPriority(result),
			(line, value) => this.metadataParser.setPriority(line, value),
			result,
		);
		return result;
	}

	/**
	 * Propagates one field's parent value onto the child line when the
	 * child still holds the previously inherited value (or none) and the
	 * parent value has actually changed since the last sync. Records the
	 * new value on success and returns the (possibly updated) line.
	 */
	// eslint-disable-next-line max-params
	private syncField<T extends string>(
		childId: string,
		field: MetadataField,
		parentValue: T | null,
		childValue: T | null,
		apply: (line: string, value: T) => string,
		line: string,
	): string {
		if (parentValue === null) {
			return line;
		}
		const lastSynced = this.syncCache.get(childId)?.[field] ?? null;
		if (parentValue === lastSynced) {
			return line;
		}
		if (childValue !== null && childValue !== lastSynced) {
			return line;
		}
		this.syncCache.set(childId, field, parentValue);
		return apply(line, parentValue);
	}
}
