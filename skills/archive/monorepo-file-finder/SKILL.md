---
name: monorepo-file-finder
description: Locate source files in a monorepo structure when relative paths fail
author: phus
version: 0.1.0-draft
trigger: Use when a file read fails with ENOENT and the project has a packages/
  or apps/ directory structure.
sourceSessionId: tui:tui
verified: false
---

# Monorepo File Finder

When a file_read or bash command fails with ENOENT in a monorepo:

1. Run `find . -type f -name '<basename>' 2>/dev/null` from the repo root.
2. Prefer paths under `*/src/` over `*/dist/`.
3. Use the full discovered path for subsequent reads.
4. If nothing is found, state that the file does not exist.

Do NOT retry the same relative path — it will fail again.
