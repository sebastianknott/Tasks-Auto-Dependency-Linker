# Calculate Next Version

This composite action calculates the next semantic version based on the bump type (patch, minor, or major) using the existing git tags.

## Features

- ✅ Automatically determines current version from git tags
- ✅ Calculates next version using semantic versioning
- ✅ Supports patch, minor, and major version bumps
- ✅ Returns both prefixed and non-prefixed version strings
- ✅ Creates git tag for the new version

## Usage

### Basic Usage

```yaml
- name: Calculate next version
  id: version
  uses: ./.github/actions/calculate-version
  with:
    bump: 'patch'
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Use version
  run: |
    echo "New version: ${{ steps.version.outputs.version }}"
    echo "Version number: ${{ steps.version.outputs.version-number }}"
```

### With Different Bump Types

```yaml
# Patch bump (1.2.3 → 1.2.4)
- uses: ./.github/actions/calculate-version
  with:
    bump: 'patch'
    github-token: ${{ secrets.GITHUB_TOKEN }}

# Minor bump (1.2.3 → 1.3.0)
- uses: ./.github/actions/calculate-version
  with:
    bump: 'minor'
    github-token: ${{ secrets.GITHUB_TOKEN }}

# Major bump (1.2.3 → 2.0.0)
- uses: ./.github/actions/calculate-version
  with:
    bump: 'major'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Custom Version Prefix

```yaml
- name: Calculate version without v prefix
  uses: ./.github/actions/calculate-version
  with:
    bump: 'minor'
    prefix: ''
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `bump` | Type of version bump (patch, minor, major) | Yes | - |
| `prefix` | Version prefix (usually 'v') | No | `v` |
| `github-token` | GitHub token for creating tags | Yes | - |

## Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `version` | New version with prefix | `v1.2.4` |
| `version-number` | New version without prefix | `1.2.4` |

## Semantic Versioning Rules

Version format: `MAJOR.MINOR.PATCH`

| Bump Type | Change | Example | Use When |
|-----------|--------|---------|----------|
| `patch` | Increment patch number | 1.2.3 → 1.2.4 | Bug fixes, minor changes |
| `minor` | Increment minor, reset patch | 1.2.3 → 1.3.0 | New features (backwards compatible) |
| `major` | Increment major, reset minor & patch | 1.2.3 → 2.0.0 | Breaking changes |

## Examples

### In Release Workflow

```yaml
name: Create Release

on:
  push:
    branches:
      - master

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Need full history for version calculation
      
      - name: Determine bump type from PR label
        id: bump
        run: |
          # Logic to extract label from last merged PR
          echo "type=minor" >> $GITHUB_OUTPUT
      
      - name: Calculate next version
        id: version
        uses: ./.github/actions/calculate-version
        with:
          bump: ${{ steps.bump.outputs.type }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Create release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ steps.version.outputs.version }}
          name: Release ${{ steps.version.outputs.version }}
```

### Output Examples

**Current tags:** `v1.2.3`

**Patch bump:**
```
version: v1.2.4
version-number: 1.2.4
```

**Minor bump:**
```
version: v1.3.0
version-number: 1.3.0
```

**Major bump:**
```
version: v2.0.0
version-number: 2.0.0
```

## How It Works

1. **Fetch existing tags:** Retrieves all git tags from the repository
2. **Find latest version:** Identifies the most recent semantic version tag
3. **Calculate next version:** Applies bump type to determine next version
4. **Create tag:** Creates a new git tag with the calculated version
5. **Return outputs:** Provides both prefixed and non-prefixed versions

## Prerequisites

- Repository must have at least one existing version tag (e.g., `v0.1.0`, `v1.0.0`)
- Checkout must include full git history (`fetch-depth: 0`)
- GitHub token must have permissions to create tags

## First Version

If no tags exist in the repository, the action will default to:
- `v0.1.0` for minor/patch bumps
- `v1.0.0` for major bumps

You can manually create the first tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Permissions

The GitHub token requires the following permissions:
```yaml
permissions:
  contents: write  # Required to create tags
```

## Notes

- Tags are created automatically by this action
- The action uses annotated tags for better tracking
- Version calculation respects semantic versioning strictly
- Pre-release and build metadata are not supported (e.g., `1.0.0-alpha`, `1.0.0+build`)
