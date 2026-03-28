# Tasks Auto-Dependency Linker

Automatically manage [Obsidian Tasks](https://publish.obsidian.md/tasks/) dependencies based on indentation. **Indent a task = block its parent. Outdent = unblock.**

## How it works

When you indent a task beneath another task, the plugin automatically:

1. Assigns a unique ID to the parent task (if it doesn't have one)
2. Adds a dependency marker to the child task pointing to that parent

```markdown
<!-- Before indenting -->
- [ ] Build backend
- [ ] Design API schema

<!-- After indenting "Design API schema" under "Build backend" -->
- [ ] Build backend 🆔 abc123
	- [ ] Design API schema ⛔ abc123
```

The parent task (`Build backend`) is now **blocked** by the child task (`Design API schema`) using the [Obsidian Tasks](https://publish.obsidian.md/tasks/) dependency syntax.

### Outdenting

When you outdent a task, the dependency on the old parent is removed. If a new parent exists at the new indentation level, a new dependency is created automatically.

### Rules

- **Parent-child only.** Only direct parent-child relationships are tracked. Siblings are independent.
- **Non-task lines are ignored.** Plain text, bullets without checkboxes, and headings are never modified.
- **Existing IDs are preserved.** The plugin never removes a `🆔` marker. Manual `⛔` markers pointing to other tasks are also left intact.
- **Vault-wide unique IDs.** Generated IDs are 6-character lowercase alphanumeric strings, unique across your entire vault.

## Installation

### From Obsidian Community Plugins

1. Open **Settings > Community plugins**
2. Click **Browse** and search for "Tasks Auto-Dependency Linker"
3. Click **Install**, then **Enable**

### With BRAT (for beta testing)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Add `sebastianknott/Tasks-Auto-Dependency-Linker` as a beta plugin

### Manual

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/sebastianknott/Tasks-Auto-Dependency-Linker/releases)
2. Create a folder `.obsidian/plugins/tasks-auto-dependency-linker/` in your vault
3. Copy both files into that folder
4. Restart Obsidian and enable the plugin in **Settings > Community plugins**

## Configuration

No configuration needed. The plugin reads your vault's indentation settings (tabs or spaces) automatically.

- **Indent using tabs** (Obsidian default): each tab = one indent level
- **Indent using spaces**: the plugin respects your configured tab size (2, 4, etc.)

## Requirements

- [Obsidian Tasks](https://publish.obsidian.md/tasks/) plugin must be installed for the `🆔` and `⛔` markers to function as dependencies.

## Development

```bash
npm install         # Install dependencies
npm run dev         # Start esbuild in watch mode
npm run build       # Type-check and build for production
npm test            # Run unit tests + mutation testing (StrykerJS)
npm run lint        # Run ESLint
npm run check       # Run all CI checks locally
```

## License

[MIT](LICENSE)
