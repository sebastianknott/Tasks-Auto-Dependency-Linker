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
		'!src/main.ts',
	],
	reporters: ['html', 'clear-text', 'progress'],
	thresholds: {
		high: 80,
		low: 60,
		break: 50,
	},
	concurrency: 4,
	cleanTempDir: 'always',
};
