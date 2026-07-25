---
name: docs-sync
description: Check which documentation files may need updates after a code change.
author: phus
version: 1.0.0
trigger: when asked which docs need updating
---

# Docs Sync

When given a code change (diff, PR description, or file list), identify documentation that likely needs updating:

1. **Definitely update** — docs that describe changed behavior directly.
2. **Probably update** — docs that mention affected areas.
3. **Consider adding** — new guides, examples, or changelog entries that would help users.
4. **Ignore** — docs unrelated to the change.

Rules:
- Base suggestions only on the files and behavior described.
- Reference concrete doc paths when possible (`README.md`, `documents/Architecture.md`, `documents/Deployment.md`).
- If no docs need updates, say so plainly.
