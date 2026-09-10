/**
 * Derives, for a single pass, what the user did to the markers on the
 * cursor line.
 *
 * The detector is stateless. It compares the snapshot taken at the end
 * of the previous pass against the line as it reads right now and
 * reports the difference. It never remembers anything between calls and
 * never decides what to do with what it found. Accumulating suppression
 * across passes, rotating it when the caret or the file changes, and
 * refusing writes are all {@link LineWriteArbiter} decisions.
 *
 * That division is why the two suppression fields on
 * {@link PassObservation} are named `newlySuppressed*`. They hold what
 * this one comparison revealed, not the running total. Assigning them
 * straight onto the arbiter's accumulated sets would throw away every
 * earlier deletion the user made while the caret sat on the same line,
 * and the field names are there to make that mistake look wrong at the
 * call site.
 */

import { MarkerAccessorRegistry, MarkerType } from '../parsing/marker-accessor';
import { LineSnapshotStore, type LineSnapshot } from './line-snapshot-store';
import type { LineEditor } from '../types';

/**
 * One pass's reading of the cursor line.
 *
 * `verifiedTypes` and `verifiedDepIds` are evidence for this pass only:
 * the marker still holds the value the previous snapshot recorded, so
 * the user demonstrably did not touch it. `indeterminate` is true when
 * a glyph is present but its value does not parse, meaning the user is
 * mid-edit on it right now.
 */
export interface PassObservation {
	readonly newlySuppressedTypes: ReadonlySet<MarkerType>;
	readonly newlySuppressedDepIds: ReadonlySet<string>;
	readonly verifiedTypes: ReadonlySet<MarkerType>;
	readonly verifiedDepIds: ReadonlySet<string>;
	readonly indeterminate: boolean;
}

type Comparison = Omit<PassObservation, 'indeterminate'>;

interface SplitSets<T> {
	readonly suppressed: Set<T>;
	readonly verified: Set<T>;
}

export class SuppressionDetector {
	constructor(
		private readonly registry: MarkerAccessorRegistry,
		private readonly snapshotStore: LineSnapshotStore,
	) {}

	observe(target: LineEditor, cursorLine: number): PassObservation {
		return {
			...this.compare(target, cursorLine),
			indeterminate: this.computeIndeterminate(target, cursorLine),
		};
	}

	/**
	 * Yields an entirely empty comparison whenever the prior snapshot
	 * cannot be trusted, so an untrusted pass reports neither suppression
	 * nor verification rather than half of each.
	 */
	private compare(target: LineEditor, cursorLine: number): Comparison {
		const prior = this.trustedSnapshot(target, cursorLine);
		if (prior === null) {
			return {
				newlySuppressedTypes: new Set<MarkerType>(),
				newlySuppressedDepIds: new Set<string>(),
				verifiedTypes: new Set<MarkerType>(),
				verifiedDepIds: new Set<string>(),
			};
		}
		const currentLine = target.getLine(cursorLine);
		const markers = this.compareMarkers(prior, currentLine);
		const deps = this.compareDeps(prior, currentLine);
		return {
			newlySuppressedTypes: markers.suppressed,
			newlySuppressedDepIds: deps.suppressed,
			verifiedTypes: markers.verified,
			verifiedDepIds: deps.verified,
		};
	}

	/**
	 * The snapshot for the cursor line, but only when it still describes
	 * the same line. Its marker-free remainder must match the current
	 * line, otherwise the line changed underneath the snapshot (Enter
	 * split it, or an insertion shifted indices) and comparing the two
	 * would attribute someone else's edit to the user.
	 */
	private trustedSnapshot(target: LineEditor, cursorLine: number): LineSnapshot | null {
		if (cursorLine >= target.lineCount()) {
			return null;
		}
		const prior = this.snapshotStore.get(cursorLine);
		if (!prior) {
			return null;
		}
		const currentLine = target.getLine(cursorLine);
		if (prior.bareText !== this.snapshotStore.computeBareText(currentLine)) {
			return null;
		}
		return prior;
	}

	/**
	 * A marker whose value changed since the prior snapshot is suppressed;
	 * one whose value is unchanged is verified as untouched instead. A
	 * marker absent from the snapshot is neither, since there is nothing
	 * to compare it against.
	 */
	private compareMarkers(prior: LineSnapshot, currentLine: string): SplitSets<MarkerType> {
		const split: SplitSets<MarkerType> = { suppressed: new Set(), verified: new Set() };
		for (const accessor of this.registry.markers) {
			const priorValue = prior.markers.get(accessor.type) ?? null;
			if (priorValue === null) {
				continue;
			}
			if (accessor.read(currentLine) !== priorValue) {
				split.suppressed.add(accessor.type);
			} else {
				split.verified.add(accessor.type);
			}
		}
		return split;
	}

	private compareDeps(prior: LineSnapshot, currentLine: string): SplitSets<string> {
		const split: SplitSets<string> = { suppressed: new Set(), verified: new Set() };
		const currentDeps = this.registry.dependency.read(currentLine);
		for (const depId of prior.deps) {
			if (!currentDeps.has(depId)) {
				split.suppressed.add(depId);
			} else {
				split.verified.add(depId);
			}
		}
		return split;
	}

	/**
	 * True when the cursor line carries a glyph for some marker type
	 * (single-value or dependency) whose value does not fully parse.
	 * Computed fresh from the line's raw content, so it catches a
	 * mid-edit marker on the very first pass that sees it, without
	 * needing a prior snapshot to compare against.
	 */
	private computeIndeterminate(target: LineEditor, cursorLine: number): boolean {
		if (cursorLine < 0 || cursorLine >= target.lineCount()) {
			return false;
		}
		const line = target.getLine(cursorLine);
		return (
			this.registry.markers.some((accessor) => accessor.hasFragment(line)) ||
			this.registry.dependency.hasFragment(line)
		);
	}
}
