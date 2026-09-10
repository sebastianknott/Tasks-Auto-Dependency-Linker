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

			// Clean Code: max function parameters (constructors exempt via inline disable, see AGENTS.md)
			'max-params': ['error', { max: 5 }],

			// Clean Code: prevent mutation of function parameters (hidden side effects)
			'no-param-reassign': 'error',

			// TypeScript: enforce readonly on private members that are never reassigned
			'@typescript-eslint/prefer-readonly': 'error',
		},
	},
	{
		// Tests are linted, but not held to the src/ Clean Code budgets: every
		// `describe` callback counts as a function, so a 50-line cap would fail
		// on nearly every file without saying anything about test quality.
		files: ['tests/**/*.ts'],
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		rules: {
			'max-lines-per-function': 'off',
			'complexity': 'off',

			// Tests reach into mock internals that the real Obsidian API does not
			// expose (`_vaultEmitter`, `_layoutReadyCb`) and into private fields of
			// the plugin class. That traffic is deliberately typed as `any`, so the
			// type-aware `no-unsafe-*` family fires on every dereference without
			// finding a real defect. Same call made by obsidian-tasks and by
			// obsidian-test-mocks; typescript-eslint sanctions it under the
			// "When Not To Use It" section of the no-unsafe-member-access docs.
			// `tsc -p tests/tsconfig.json` remains the type safety net for tests.
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',

			// Passing a spy by reference (`expect(mock.setLine)`) is the normal way
			// to assert on it, and carries none of the `this`-binding risk the rule
			// guards against.
			'@typescript-eslint/unbound-method': 'off',
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
		".stryker-tmp",
	]),
);
