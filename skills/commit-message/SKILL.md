---
name: commit-message
description: "Write a Conventional Commit message (type(scope): subject) from a diff or change description."
author: human
version: 1.0.0
---

# Write Commit Message

When asked to write a commit message, produce one in **Conventional Commits** format:

```
<type>(<optional-scope>): <subject>

<body (optional, wrap at 72 chars)>

<footer (optional)>
```

**Allowed types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

**Subject rules**:
- ≤ 50 chars
- Imperative mood ("add", not "added")
- No trailing period
- Lowercase

**Body rules** (include only if non-obvious):
- Explain *what* and *why*, not *how*
- Wrap at 72 chars

If the user gave a diff, infer the type from the changed paths:
- `*.test.ts`, `*.spec.ts` → `test`
- `*.md`, `docs/` → `docs`
- `package.json`, lockfiles → `build` or `chore`
- anything else → `feat` (new behavior) or `fix` (bug)
