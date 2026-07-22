#!/bin/bash
# Bump version, update CHANGELOG, commit, tag, and push.
# Usage: ./scripts/release.sh [patch|minor|major|<exact-version>]

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUMP="${1:-patch}"

current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "ERROR: must be on main branch (currently on $current_branch)" >&2
  exit 1
fi

if [ -n "$(git status --short)" ]; then
  echo "ERROR: working directory is not clean" >&2
  git status --short
  exit 1
fi

CURRENT=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT"

if [ "$BUMP" = "patch" ] || [ "$BUMP" = "minor" ] || [ "$BUMP" = "major" ]; then
  NEW=$(node -p "
    const [major, minor, patch] = '$CURRENT'.split('.').map(Number);
    if ('$BUMP' === 'major') console.log(\`\${major + 1}.0.0\`);
    else if ('$BUMP' === 'minor') console.log(\`\${major}.\${minor + 1}.0\`);
    else console.log(\`\${major}.\${minor}.\${patch + 1}\`);
  " | tail -1)
else
  NEW="$BUMP"
fi

if [ -z "$NEW" ]; then
  echo "ERROR: could not determine new version" >&2
  exit 1
fi

echo "New version: $NEW"

# Bump every workspace package.json in lockstep. Stage 5 of the
# monorepo split pins a single workspace version across root + apps/cli
# + packages/* (proposal §10 question #4: fixed semver in v1).
# @phus/shared is in this list because @phus/core, @phus/runtime, and
# @phus/tui all depend on it; without bumping it in lockstep the
# published `workspace:*` rewrite would pin to a stale version.
PACKAGES=(
  package.json
  apps/cli/package.json
  packages/core/package.json
  packages/runtime/package.json
  packages/tui/package.json
  packages/shared/package.json
)

for f in "${PACKAGES[@]}"; do
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$f', 'utf-8'));
    pkg.version = '$NEW';
    fs.writeFileSync('$f', JSON.stringify(pkg, null, 2) + '\n');
  "
done

# Update CHANGELOG
TODAY=$(date +%Y-%m-%d)
if [ ! -f CHANGELOG.md ]; then
  echo "# Changelog" > CHANGELOG.md
fi

# Collect commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  CHANGES=$(git log "$LAST_TAG"..HEAD --pretty=format:'- %s' | grep -v '^- release:' || true)
else
  CHANGES=$(git log --pretty=format:'- %s' | grep -v '^- release:' || true)
fi

if [ -z "$CHANGES" ]; then
  CHANGES="- Maintenance release"
fi

SECTION="\n## [$NEW] - $TODAY\n\n### Added\n$CHANGES\n"

# Prepend after the first line (# Changelog)
{
  head -1 CHANGELOG.md
  printf "%b" "$SECTION"
  tail -n +2 CHANGELOG.md
} > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

# Commit and tag
git add package.json apps/cli/package.json packages/core/package.json packages/runtime/package.json packages/tui/package.json packages/shared/package.json CHANGELOG.md
git commit -m "release: v$NEW"
git tag "v$NEW"

echo ""
echo "Pushing commit and tag..."
git push origin main
git push origin "v$NEW"

echo ""
echo "✓ Released v$NEW"
echo "GitHub Actions will now publish npm, GitHub Release, and Docker image."
