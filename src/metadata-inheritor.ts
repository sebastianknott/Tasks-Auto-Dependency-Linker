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
 *
 * Syncing a field is a two-step propose-then-confirm process, because
 * the line {@link syncFromParent} returns is only a proposal: whatever
 * writes it to the document (typically a `LineWriteArbiter`) may refuse
 * the write outright or correct part of it. Recording a sync in the
 * {@link MetadataSyncCache} before knowing whether it actually landed
 * would let the cache and the document disagree about what the child
 * holds. Callers must therefore call {@link confirmWrite} with the line
 * the document actually ended up holding after the write was attempted,
 * so only the syncs that truly landed are recorded.
 *
 * A date should only be inherited by the child from the parent, and
 * only when the child does not have a valid date of its own, and only
 * when the parent's date is valid. The second half of that rule needs
 * an explicit guard: a marker the child is still typing (a fragment
 * such as `📅 2026-0`) is indistinguishable from "no value" to a plain
 * read, and a `MetadataSyncCache` reseed triggered by an autosave taken
 * mid-edit resets that field's `lastSynced` to null. Together those two
 * facts would otherwise unlock a proposal onto a line whose own marker
 * does not parse, and `TaskMetadataParser.setDueDate` /
 * `setScheduledDate` can only append a second glyph in that case rather
 * than replace the first. See {@link proposeField} for the guard.
 */

import type { MarkerAccessor, MarkerAccessorRegistry, MarkerType } from './marker-accessor';
import type { MetadataField, MetadataSyncCache } from './metadata-sync-cache';

/** One field sync proposed by {@link MetadataInheritor.syncFromParent}, awaiting confirmation. */
interface PendingSync {
	readonly childId: string;
	readonly field: MetadataField;
	readonly accessor: MarkerAccessor;
	readonly proposedValue: string;
}

export class MetadataInheritor {
	private readonly registry: MarkerAccessorRegistry;
	private readonly syncCache: MetadataSyncCache;
	private pending: PendingSync[] = [];

	constructor(registry: MarkerAccessorRegistry, syncCache: MetadataSyncCache) {
		this.registry = registry;
		this.syncCache = syncCache;
	}

	/**
	 * Proposes syncing every inheritable field (due, scheduled, priority)
	 * from the parent line onto the child line, returning the (possibly
	 * updated) child line. Does NOT record anything in the sync cache;
	 * call {@link confirmWrite} with the line the caller's write actually
	 * produced to record only the syncs that landed. Discards whatever
	 * was left pending from a previous call that was never confirmed.
	 */
	syncFromParent(childId: string, childLine: string, parentLine: string): string {
		this.pending = [];
		let result = childLine;
		for (const accessor of this.registry.inheritable) {
			result = this.proposeField(childId, accessor, parentLine, result);
		}
		return result;
	}

	/**
	 * Confirms which of the syncs proposed by the most recent
	 * {@link syncFromParent} call actually made it into the document, and
	 * records only those in the sync cache. `writtenLine` must be read
	 * back from the editor after the caller attempted the write that
	 * `syncFromParent`'s return value proposed, since the write may have
	 * been refused outright or partially corrected. Always clears the
	 * pending list, whether or not anything was confirmed, so a stale
	 * proposal can never be confirmed by an unrelated later write.
	 */
	confirmWrite(writtenLine: string): void {
		for (const sync of this.pending) {
			if (sync.accessor.read(writtenLine) === sync.proposedValue) {
				this.syncCache.set(sync.childId, sync.field, sync.proposedValue);
			}
		}
		this.pending = [];
	}

	/**
	 * Proposes one field's parent value onto the child line when the
	 * child still holds the previously inherited value (or none) and the
	 * parent value has actually changed since the last sync. Queues the
	 * proposal for later confirmation and returns the (possibly updated)
	 * line; never writes to the sync cache directly.
	 */
	/**
	 * Proposes one field's parent value onto the child line when the
	 * child still holds the previously inherited value (or none) and the
	 * parent value has actually changed since the last sync. Queues the
	 * proposal for later confirmation and returns the (possibly updated)
	 * line; never writes to the sync cache directly.
	 *
	 * The very first check skips the field outright when the child line
	 * carries an unparseable fragment of this marker (the user is
	 * mid-typing or mid-deleting it): `accessor.read` cannot tell a
	 * fragment apart from "no marker at all", both return null, so
	 * without this guard a fragment reads as an empty field ready to be
	 * filled. That alone would be survivable, except an autosave taken
	 * mid-edit runs `MetadataSyncCache.updateForFile`, which reseeds
	 * `lastSynced` for the field to null because the fragment does not
	 * parse either. With `lastSynced` reset to null, the parent value no
	 * longer equals it, so the proposal goes ahead: `accessor.apply`
	 * hands the fragment-bearing line to `TaskMetadataParser.setDueDate`
	 * / `setScheduledDate`, which cannot find a well-formed existing
	 * value to replace and appends a second glyph instead. This guard is
	 * checked before `accessor.read(parentLine)` on purpose: whether the
	 * child is mid-edit on this field has nothing to do with what the
	 * parent holds.
	 *
	 * There is no matching guard for the parent side because none is
	 * needed: a fragmentary parent marker already makes
	 * `accessor.read(parentLine)` return null, and the existing
	 * `parentValue === null` check just below skips the field for that
	 * reason alone.
	 */
	private proposeField(
		childId: string,
		accessor: MarkerAccessor,
		parentLine: string,
		line: string,
	): string {
		if (accessor.hasFragment(line)) {
			return line;
		}
		const parentValue = accessor.read(parentLine);
		if (parentValue === null) {
			return line;
		}
		const field = MetadataInheritor.toField(accessor.type);
		const lastSynced = this.syncCache.get(childId)?.[field] ?? null;
		if (parentValue === lastSynced) {
			return line;
		}
		const childValue = accessor.read(line);
		if (childValue !== null && childValue !== lastSynced) {
			return line;
		}
		this.pending.push({ childId, field, accessor, proposedValue: parentValue });
		return accessor.apply(line, parentValue);
	}

	/**
	 * Converts a marker type into its sync-cache field. Only ever called
	 * for markers in {@link MarkerAccessorRegistry.inheritable}, whose
	 * string values are, by construction, exactly the ones the
	 * MetadataField union names ('due' | 'scheduled' | 'priority').
	 */
	private static toField(type: MarkerType): MetadataField {
		return type as unknown as MetadataField;
	}
}
