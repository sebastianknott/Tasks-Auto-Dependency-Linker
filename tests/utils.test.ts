import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Debounce } from '../src/utils';

describe('Debounce', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('call', () => {
		it('does not invoke the callback immediately', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.call();

			expect(callback).not.toHaveBeenCalled();
		});

		it('invokes the callback after the default delay', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.call();
			vi.advanceTimersByTime(300);

			expect(callback).toHaveBeenCalledOnce();
		});

		it('invokes the callback after a custom delay', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback, 500);

			debounce.call();
			vi.advanceTimersByTime(499);
			expect(callback).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1);
			expect(callback).toHaveBeenCalledOnce();
		});

		it('resets the timer when called again within the delay', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.call();
			vi.advanceTimersByTime(200);
			debounce.call();
			vi.advanceTimersByTime(200);

			expect(callback).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100);
			expect(callback).toHaveBeenCalledOnce();
		});

		it('only invokes the callback once after rapid calls', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.call();
			debounce.call();
			debounce.call();
			debounce.call();
			debounce.call();

			vi.advanceTimersByTime(300);

			expect(callback).toHaveBeenCalledOnce();
		});

		it('can fire multiple times if delay elapses between calls', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.call();
			vi.advanceTimersByTime(300);
			expect(callback).toHaveBeenCalledTimes(1);

			debounce.call();
			vi.advanceTimersByTime(300);
			expect(callback).toHaveBeenCalledTimes(2);
		});
	});

	describe('cancel', () => {
		it('prevents the pending callback from firing', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.call();
			debounce.cancel();
			vi.advanceTimersByTime(300);

			expect(callback).not.toHaveBeenCalled();
		});

		it('does nothing if no call is pending', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.cancel();
			vi.advanceTimersByTime(300);

			expect(callback).not.toHaveBeenCalled();
		});

		it('allows new calls after cancellation', () => {
			const callback = vi.fn();
			const debounce = new Debounce(callback);

			debounce.call();
			debounce.cancel();
			debounce.call();
			vi.advanceTimersByTime(300);

			expect(callback).toHaveBeenCalledOnce();
		});
	});
});
