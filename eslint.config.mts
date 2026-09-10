import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import globals from "globals";
import { globalIgnores } from "eslint/config";

/**
 * The layer folders under `src/`, ordered from the most depended-upon to the
 * least. A module may import from its own folder, from any folder earlier in
 * this list, and from `types.ts` or `utils.ts`. It may never import from a
 * folder later in the list.
 *
 *     obsidian -> processing -> editing -> linking -> cache -> parsing
 *
 * `main.ts` is the composition root. It appears in no zone target below, so it
 * stays free to reach every layer.
 */
const LAYERS = ['parsing', 'cache', 'linking', 'editing', 'processing', 'obsidian'];

/**
 * One `import-x/no-restricted-paths` zone per layer that has something above it,
 * forbidding every folder that sits later in {@link LAYERS}. `obsidian` is the
 * top layer and gets no zone, since nothing is above it to forbid.
 */
const layerZones = LAYERS.slice(0, -1).map((layer, index) => ({
	target: `./src/${layer}`,
	from: LAYERS.slice(index + 1).map((higher) => `./src/${higher}`),
	message: `src/${layer} may not import from a higher layer. Layer order: ${LAYERS.join(' <- ')}.`,
}));

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
			'import-x': importX,
		},
		settings: {
			// `no-cycle` walks the import graph by parsing each imported file,
			// and skips any file whose extension is missing from this list. The
			// default is `.js`, `.mjs` and `.cjs`, so leaving it out turns the
			// rule into a silent no-op on a TypeScript-only codebase.
			'import-x/extensions': ['.ts', '.mjs', '.cjs', '.js'],

			// The bundled node resolver defaults to `.mjs`, `.cjs`, `.js`,
			// `.json` and `.node`. Without `.ts` in that list every relative
			// import in this project stays unresolved, and both rules below
			// bail out before they compare anything, which makes them silent
			// no-ops rather than failures.
			'import-x/resolver-next': [
				createNodeResolver({
					extensions: ['.ts', '.mjs', '.cjs', '.js', '.json', '.node'],
				}),
			],
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

			// Clean Code: max function parameters (constructors exempt via inline disable)
			'max-params': ['error', { max: 5 }],

			// Clean Code: prevent mutation of function parameters (hidden side effects)
			'no-param-reassign': 'error',

			// TypeScript: enforce readonly on private members that are never reassigned
			'@typescript-eslint/prefer-readonly': 'error',

			// Architecture: keep every import inside src/ pointing down the layer
			// order. See the LAYERS comment at the top of this file.
			'import-x/no-restricted-paths': ['error', {
				zones: [
					...layerZones,
					{
						target: './src',
						from: './src/main.ts',
						message: 'main.ts is the composition root. Nothing may import it.',
					},
				],
			}],

			// Architecture: no import cycles, at any depth.
			'import-x/no-cycle': 'error',
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
