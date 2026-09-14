import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Mirrors vitest.config.ts and overrides `include` so the run sees only the
// unit suites. stryker.unit.mjs and npm run test:unit both point at this file,
// which is what makes "every source file reaches 100 percent from the unit
// tests alone" measurable rather than aspirational.
//
// The override is a spread, not mergeConfig: mergeConfig concatenates arrays,
// so it would leave tests/integration in `include` and the gate would measure
// nothing.
export default defineConfig({
	...base,
	test: {
		...base.test,
		include: ['tests/unit/**/*.{test,spec}.ts'],
	},
});
