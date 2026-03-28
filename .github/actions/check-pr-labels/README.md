# Check PR Labels

This composite action validates that a pull request has exactly one version bump label assigned for proper semantic versioning.

## Features

- ✅ Validates PR has required labels
- ✅ Enforces exactly one label from allowed list
- ✅ Fails build if labels are missing or incorrect
- ✅ Supports custom label sets

## Usage

### Basic Usage

```yaml
- name: Check PR labels
  uses: ./.github/actions/check-pr-labels
```

This validates that the PR has exactly ONE of: `patch`, `minor`, or `major`

### Custom Allowed Labels

```yaml
- name: Check custom labels
  uses: ./.github/actions/check-pr-labels
  with:
    allowed-labels: 'bugfix, feature, breaking'
```

### Require Multiple Labels

```yaml
- name: Require two labels
  uses: ./.github/actions/check-pr-labels
  with:
    count: '2'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `allowed-labels` | Comma-separated list of allowed labels | No | `patch, minor, major` |
| `count` | Required number of labels from the allowed list | No | `1` |

## Label Meanings (Semantic Versioning)

| Label | Bump Type | Description | Example |
|-------|-----------|-------------|---------|
| `patch` | Patch release | Bug fixes, minor changes | 1.2.3 → 1.2.4 |
| `minor` | Minor release | New features, backwards compatible | 1.2.3 → 1.3.0 |
| `major` | Major release | Breaking changes | 1.2.3 → 2.0.0 |

## Examples

### In a Pull Request Workflow

```yaml
name: PR Validation

on:
  pull_request:
    branches:
      - master

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check PR has version bump label
        uses: ./.github/actions/check-pr-labels
```

### Workflow Behavior

**✅ Valid PR:** Has exactly one label (`patch`, `minor`, or `major`)
```
Labels: patch
Status: ✅ Pass
```

**❌ Invalid PR:** No labels
```
Labels: (none)
Status: ❌ Fail - "Required label missing"
```

**❌ Invalid PR:** Multiple version labels
```
Labels: patch, minor
Status: ❌ Fail - "Too many labels from allowed set"
```

**✅ Valid PR:** Has version label + other labels
```
Labels: patch, documentation, good first issue
Status: ✅ Pass - Only counts allowed labels
```

## How to Add Labels to PRs

### Via GitHub UI

1. Open your pull request
2. Click on "Labels" in the right sidebar
3. Select exactly ONE of: `patch`, `minor`, or `major`
4. The workflow will re-run automatically

### Via GitHub CLI

```bash
# Add patch label
gh pr edit <PR-NUMBER> --add-label "patch"

# Add minor label
gh pr edit <PR-NUMBER> --add-label "minor"

# Add major label
gh pr edit <PR-NUMBER> --add-label "major"
```

### Creating Labels (Repository Maintainers)

If the labels don't exist in your repository:

```bash
# Create semantic version labels
gh label create "patch" --description "Patch release (bug fixes)" --color "0e8a16"
gh label create "minor" --description "Minor release (new features)" --color "fbca04"
gh label create "major" --description "Major release (breaking changes)" --color "d73a4a"
```

## Integration with Release Workflow

This action is typically used together with version calculation:

1. **PR Opened:** Label validation runs (this action)
2. **PR Merged:** Label is read to calculate next version
3. **Release Created:** Version bump applied based on label

## Common Issues

### "Required label missing"

**Cause:** PR has no label or wrong label type

**Solution:** Add one of `patch`, `minor`, or `major` labels to the PR

### "Too many labels"

**Cause:** PR has multiple version bump labels (e.g., both `patch` and `minor`)

**Solution:** Remove all but one version bump label

## Notes

- Only labels from the allowed list are counted
- Other labels (e.g., `documentation`, `bug`) are ignored
- The check runs on PR events: opened, synchronize, reopened, labeled, unlabeled
- Repository must have the required labels created
