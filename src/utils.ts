/**
 * General-purpose utilities for the Tasks Auto-Dependency Linker plugin.
 */

/** Default debounce delay in milliseconds, per plugin requirements. */
export const DEFAULT_DEBOUNCE_DELAY = 300;

/**
 * Debounces a callback so it only fires after a quiet period.
 *
 * Each call to {@link call} resets the timer. The callback is invoked
 * only when no new call arrives within `delay` milliseconds.
 * Use {@link cancel} during plugin `onunload` to prevent stale firings.
 */
export class Debounce {
	private readonly callback: () => void;
	private readonly delay: number;
	private timerId: ReturnType<typeof setTimeout> | null = null;

	constructor(callback: () => void, delay: number = DEFAULT_DEBOUNCE_DELAY) {
		this.callback = callback;
		this.delay = delay;
	}

	/** Schedule (or reschedule) the callback after the delay. */
	call(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
		}
		this.timerId = setTimeout(() => {
			this.timerId = null;
			this.callback();
		}, this.delay);
	}

	/** Cancel any pending invocation. Safe to call when nothing is pending. */
	cancel(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}
}
