import base from './stryker.config.mjs';

// The unit-only mutation gate. Same mutants as the full run, but only
// tests/unit/ may kill them, which is what makes "every source file reaches
// 100 percent from the unit tests alone" measurable.
//
// thresholds.break is a ratchet: every commit raises it to the integer floor of
// the score that commit achieved and never lowers it. The floor keeps the gate
// from flapping on the two-decimal rounding in Stryker's report. The final
// commit sets it to 100.
//
// incrementalFile and the two report paths must differ from the full run's,
// otherwise the two runs overwrite each other's state and both report nonsense.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	...base,
	vitest: { ...base.vitest, configFile: 'vitest.unit.config.ts' },
	thresholds: { ...base.thresholds, break: 96 },
	incrementalFile: 'reports/stryker-incremental-unit.json',
	jsonReporter: { fileName: 'reports/mutation/mutation-unit.json' },
	htmlReporter: { fileName: 'reports/mutation/mutation-unit.html' },
};
