# Tasks Auto-Dependency Linker

Automatically manage [Obsidian Tasks](https://publish.obsidian.md/tasks/) dependencies based on indentation. **Indent a task = block its parent. Outdent = unblock.**

## How it works

When you indent a task beneath another task, the plugin automatically:

1. Assigns a unique ID to the child task (if it doesn't have one)
2. Adds a dependency marker to the parent task pointing to that child

```markdown
<!-- Before indenting -->
- [ ] Build backend
- [ ] Design API schema

<!-- After indenting "Design API schema" under "Build backend" -->
- [ ] Build backend ⛔ abc123
	- [ ] Design API schema 🆔 abc123
```

The parent task (`Build backend`) is now **blocked** by the child task (`Design API schema`) using the [Obsidian Tasks](https://publish.obsidian.md/tasks/) dependency syntax.

### Outdenting

When you outdent a task, the plugin automatically cleans up stale markers:

1. The `⛔` reference to the child is removed from the former parent
2. If the task is re-indented under a new parent, a `⛔` is added to that new parent
3. If no task anywhere in the vault references the child's `🆔` via a `⛔`, the `🆔` is removed too

```markdown
<!-- Before: child is indented under "Build backend" -->
- [ ] Build backend ⛔ abc123
	- [ ] Design API schema 🆔 abc123

<!-- After outdenting "Design API schema" to root level -->
- [ ] Build backend
- [ ] Design API schema
```

Moving a task from one parent to another is handled seamlessly:

```markdown
<!-- Before: child is under "Build backend" -->
- [ ] Build backend ⛔ abc123
	- [ ] Design API schema 🆔 abc123
- [ ] Write tests

<!-- After: the plugin moves the ⛔ to "Write tests" -->
- [ ] Build backend
- [ ] Write tests ⛔ abc123
	- [ ] Design API schema 🆔 abc123
```

```markdown
<!-- Before: child is under "Build backend" -->
- [ ] Write tests ⛔ abc444
    - [ ] Build backend 🆔 abc444 ⛔ abc123
        - [ ] Design API schema 🆔 abc123

<!-- After: the plugin moves the ⛔ to "Write tests" -->
- [ ] Write tests ⛔ abc444,abc123
    - [ ] Build backend 🆔 abc444
    - [ ] Design API schema 🆔 abc123
```

### Rules

- **Parent-child only.** Only direct parent-child relationships are tracked. Siblings are independent.
- **List-scoped.** The plugin only manages dependencies between tasks in the same contiguous list. Lists separated by blank lines, headings, or non-list content are treated independently and never interfere with each other.
- **Non-task lines are ignored.** Plain text, bullets without checkboxes, and headings are never modified. Non-task list items (plain bullets like `- item`) are part of the same list block but are not given dependency markers.
- **Automatic cleanup.** Orphaned `🆔` markers (not referenced by any `⛔` in the entire vault) and stale `⛔` markers (pointing to tasks that are no longer children within the same list) are removed automatically. Cross-file and cross-list dependency references are always preserved.
- **Vault-wide unique IDs.** Generated IDs are 6-character lowercase alphanumeric strings, unique across your entire vault.
- **Broad ID compatibility.** The plugin generates lowercase alphanumeric IDs, but correctly parses and preserves IDs created by the Tasks plugin that contain uppercase letters, hyphens, underscores, or have different lengths.

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

- [Obsidian Tasks](https://publish.obsidian.md/tasks/) plugin must be installed **and enabled**. The plugin automatically detects whether Tasks is active and disables itself silently if it is not.

## Development

```bash
npm install         # Install dependencies
npm run dev         # Start esbuild in watch mode
npm run build       # Type-check and build for production
npm test            # Run unit tests + mutation testing (StrykerJS)
npm run lint        # Run ESLint
npm run check       # Run all CI checks locally
```
