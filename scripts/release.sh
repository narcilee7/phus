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

# Update package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  pkg.version = '$NEW';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

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
git add package.json CHANGELOG.md
git commit -m "release: v$NEW"
git tag "v$NEW"

echo ""
echo "Pushing commit and tag..."
git push origin main
git push origin "v$NEW"

echo ""
echo "✓ Released v$NEW"
echo "GitHub Actions will now publish npm, GitHub Release, and Docker image."
