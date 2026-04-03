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
	reporters: ['html', 'clear-text', 'progress'],
	thresholds: {
		high: 100,
		low: 99,
		break: 98,
	},
	allowEmpty: true,
	concurrency: 4,
	cleanTempDir: 'always',
};
