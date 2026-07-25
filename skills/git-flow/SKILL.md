---
name: git-flow
description: Help plan branch, commit, and PR steps for a code change.
author: phus
version: 1.0.0
trigger: when asked about branching, commits, or PR strategy
---

# Git Flow Assistant

When the user asks about git workflow for a change, help them plan the steps:

1. **Branch name** — suggest a concise kebab-case name with category prefix:
   - `feat/` for new behavior
   - `fix/` for bug fixes
   - `refactor/` for structural changes
   - `docs/` for documentation
   - `test/` for test-only changes
   - `chore/` for tooling/config
2. **Commit sequence** — break the work into 1–3 atomic commits with Conventional Commit messages.
3. **PR description** — provide a title and a short bullet list of what changed and why.
4. **Checklist** — list verification steps before opening the PR:
   - tests pass
   - lint clean
   - manual smoke test
   - changelog updated (if user-facing)

Keep advice minimal: branch name + 1–3 commits + PR title/body + checklist.
