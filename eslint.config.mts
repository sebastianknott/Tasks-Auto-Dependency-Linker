import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		rules: {
			// Clean Code: cyclomatic complexity per function (default 20 is too generous)
			'complexity': ['error', { max: 10 }],

			// Clean Code: max lines per function (excluding blank lines and comments)
			'max-lines-per-function': ['error', {
				max: 50,
				skipBlankLines: true,
				skipComments: true,
			}],

			// Clean Code: max nesting depth per function
			'max-depth': ['error', { max: 4 }],

			// Clean Code: max function parameters (prefer options objects beyond 3)
			'max-params': ['error', { max: 3 }],

			// Clean Code: prevent mutation of function parameters (hidden side effects)
			'no-param-reassign': 'error',

			// TypeScript: enforce readonly on private members that are never reassigned
			'@typescript-eslint/prefer-readonly': 'error',
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"reports",
		"stryker.config.mjs",
		"vitest.config.ts",
		"tests",
	]),
);
