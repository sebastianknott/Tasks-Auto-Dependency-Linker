/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	testRunner: 'vitest',
	vitest: {
		configFile: 'vitest.config.ts',
	},
	checkers: ['typescript'],
	tsconfigFile: 'tsconfig.json',
	mutate: [
		'src/**/*.ts',
		'!src/**/*.test.ts',
		'!src/**/*.spec.ts',
		'!src/**/*.d.ts',
	],
	// The json reporter writes reports/mutation/mutation.json, which records
	// per-mutant which tests killed it. Run stryker with disableBail: true to
	// get every killer rather than only the first one.
	reporters: ['html', 'clear-text', 'progress', 'json'],
	thresholds: {
		high: 100,
		low: 99,
		break: 98,
	},
	allowEmpty: true,
	concurrency: 4,
	cleanTempDir: 'always',
};
