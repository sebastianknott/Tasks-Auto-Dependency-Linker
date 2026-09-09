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

### Metadata inheritance

When a task becomes a subtask (the moment it is indented under a parent, or moved from one parent to another), it inherits the parent's **due date** (`📅`), **scheduled date** (`⏳`), and **priority** (`🔺 ⏫ 🔼 🔽 ⏬`):

```markdown
<!-- Before indenting "Design API schema" under "Build backend" -->
- [ ] Build backend 📅 2025-06-01 ⏳ 2025-05-20 ⏫
- [ ] Design API schema

<!-- After indenting -->
- [ ] Build backend 📅 2025-06-01 ⏳ 2025-05-20 ⏫ ⛔ abc123
	- [ ] Design API schema 🆔 abc123 📅 2025-06-01 ⏳ 2025-05-20 ⏫
```

Each field is **inherited until you override it**, evaluated independently per field:

- **First inheritance.** When a task is newly indented under a parent, or moved to a different parent, it picks up that parent's metadata for any field it does not already have.
- **Changes follow the parent.** While a child still holds the value it inherited (or has none of its own), changing that field on the parent updates the child too. This includes a field the parent gains later: add a scheduled date to a parent after its subtasks already exist, and those subtasks pick it up. If you push the parent's due date back, a child that still carried the parent's old due date moves with it.
- **Your edits win.** Once you give the child its own value for a field, the plugin treats that field as yours and never overwrites it again, no matter how the parent changes later.
- **Clearing the parent leaves the child alone.** Removing a field from the parent does not remove it from the child.
- The **start date** (`🛫`) is intentionally **not** inherited.

### Deleting a marker while you're editing

Delete a `🆔`, `⛔`, `📅`, `⏳`, or priority marker on the line your cursor is currently on, and it stays deleted. The plugin recomputes markers on every keystroke, but it never silently restores something you just removed from the line you're actively editing.

Move the cursor to a different line, and normal processing resumes there: a missing `🆔` gets minted again, an inherited date reapplies, and so on. The protection covers only the line under the cursor, not the rest of the file.

### Editing an ID by hand

Change a child's `🆔` value and the parent's `⛔` follows it. That happens per keystroke, so backspacing through `abc123` rewrites the parent's blocker at `abc12`, then `abc1`, and so on until you stop. Each intermediate value is a valid ID as far as the plugin can tell, and it has no way to know you are not finished yet.

The alternative would be to hold the cascade until you move the cursor off the line. That was considered and dropped: rename an ID, then close Obsidian before touching anything else, and the parent would keep pointing at the old value on disk. Churning the undo history is the lesser problem.

Delete the value entirely, leaving a bare `🆔` glyph, and the parent's `⛔` is held intact until you finish typing the new one.

### Rules

- **Parent-child only.** Only direct parent-child relationships are tracked. Siblings are independent.
- **List-scoped.** The plugin only manages dependencies between tasks in the same contiguous list. Lists separated by blank lines, headings, or non-list content are treated independently and never interfere with each other.
- **Non-task lines are ignored.** Plain text, bullets without checkboxes, and headings are never modified. Non-task list items (plain bullets like `- item`) are part of the same list block but are not given dependency markers.
- **Automatic cleanup.** Orphaned `🆔` markers (not referenced by any `⛔` in the entire vault) and stale `⛔` markers (pointing to tasks that are no longer children within the same list) are removed automatically. Cross-file and cross-list dependency references are always preserved, including across file and folder renames. Deleting a file removes its IDs from the vault-wide index, so dependencies pointing into it get cleaned up too.
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
