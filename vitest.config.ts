import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
			'@codemirror/view': path.resolve(__dirname, 'tests/__mocks__/codemirror-view.ts'),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.{test,spec}.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.d.ts'],
		},
	},
});
