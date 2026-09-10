/**
 * Rewrites a proposed line so that it cannot undo an edit the user made
 * on the cursor line.
 *
 * This is the second half of the write gate. {@link SuppressionDetector}
 * reads what happened on the cursor line and {@link LineWriteArbiter}
 * decides how long that reading stays in force; this class applies the
 * result to one concrete proposal. It holds no state of its own: every
 * call receives the {@link CursorLineState} the arbiter currently
 * carries, so the same instance can serve any line, file or pass.
 *
 * The `indeterminate` flag deliberately does not reach here. A
 * mid-edit line is refused outright by the arbiter before any
 * reconciliation is attempted, so a reconciler that could see the flag
 * would only be able to duplicate a gate that already ran.
 */

import { MarkerAccessorRegistry, MarkerType } from '../parsing/marker-accessor';

/**
 * What the arbiter knows about the cursor line when it hands over a
 * proposal.
 *
 * The suppressed sets accumulate for as long as the caret stays on the
 * line: they name every marker type and dependency id the user removed
 * or altered by hand. The verified sets hold only this pass's positive
 * proof that a marker is an untouched carry-over from the prior
 * snapshot. A marker can sit in both at once, when the user deleted it
 * earlier and has since typed it back without leaving the line, and in
 * that case suppression wins.
 */
export interface CursorLineState {
	readonly suppressedTypes: ReadonlySet<MarkerType>;
	readonly suppressedDepIds: ReadonlySet<string>;
	readonly verifiedTypes: ReadonlySet<MarkerType>;
	readonly verifiedDepIds: ReadonlySet<string>;
}

export class ProposalReconciler {
	constructor(private readonly registry: MarkerAccessorRegistry) {}

	/**
	 * Reconciles a proposed line against the current one, marker by
	 * marker: a suppressed marker is always frozen at its current value.
	 * A proposed removal that is not suppressed is blocked too, unless
	 * this pass positively verified the marker as untouched by the user
	 * (see {@link CursorLineState.verifiedTypes}), in which case the
	 * removal is allowed to stand, e.g. a cleanup pass dropping an id
	 * that just became orphaned on the line the caret happens to sit on.
	 */
	reconcile(current: string, proposed: string, state: CursorLineState): string {
		let corrected = proposed;
		for (const accessor of this.registry.markers) {
			const currentValue = accessor.read(current);
			const blocked = accessor.read(proposed) === null && !state.verifiedTypes.has(accessor.type);
			if (state.suppressedTypes.has(accessor.type) || blocked) {
				corrected =
					currentValue === null
						? accessor.remove(corrected)
						: accessor.apply(corrected, currentValue);
			}
		}
		return this.correctDeps(current, proposed, corrected, state);
	}

	/**
	 * Dependency ids are read off the untouched `current` and `proposed`
	 * lines, never off `corrected`. Marker correction has already
	 * rewritten `corrected` by this point, and deciding presence from a
	 * line the arbiter itself just edited would let a marker rewrite
	 * change a dependency verdict.
	 */
	private correctDeps(
		current: string,
		proposed: string,
		corrected: string,
		state: CursorLineState,
	): string {
		const currentDeps = this.registry.dependency.read(current);
		const proposedDeps = this.registry.dependency.read(proposed);
		const ids = new Set<string>([...currentDeps, ...proposedDeps, ...state.suppressedDepIds]);
		let result = corrected;
		for (const depId of ids) {
			const currentHas = currentDeps.has(depId);
			const dropsIt = currentHas && !proposedDeps.has(depId);
			const desired = this.desiredDepPresence(depId, currentHas, dropsIt, state);
			const has = this.registry.dependency.read(result).has(depId);
			if (desired && !has) {
				result = this.registry.dependency.apply(result, depId);
			} else if (!desired && has) {
				result = this.registry.dependency.remove(result, depId);
			}
		}
		return result;
	}

	/**
	 * A suppressed id is always frozen at its current presence. Otherwise,
	 * a removal proposed by a cleanup pass is blocked unless this pass
	 * positively verified the id as an untouched carry-over from the
	 * prior snapshot (see {@link CursorLineState.verifiedDepIds}).
	 * Anything else feeding the id set this is called against (an add,
	 * or a keep) is always meant to be present here.
	 */
	private desiredDepPresence(
		depId: string,
		currentHas: boolean,
		proposalDropsIt: boolean,
		state: CursorLineState,
	): boolean {
		if (state.suppressedDepIds.has(depId)) {
			return currentHas;
		}
		if (proposalDropsIt) {
			return !state.verifiedDepIds.has(depId);
		}
		return true;
	}
}
