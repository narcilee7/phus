---
name: release-notes
description: Draft release notes from git log, PR titles, or change summaries.
author: phus
version: 1.0.0
trigger: when asked to write release notes, a changelog, or a release summary
---

# Release Notes

When asked to draft release notes, produce a Keep-a-Changelog style entry:

```markdown
## [Unreleased] / [X.Y.Z] — YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Deprecated
- ...

### Removed
- ...

### Security
- ...
```

Rules:
- One bullet per user-visible change.
- Write for end users, not commit authors ("Fixed crash on startup" not "fix null pointer").
- Link PR/issue numbers when provided.
- Group items under the correct heading. If a change is internal only, put it under `### Changed` or omit it.
- If the input is just a git log, infer categories from commit prefixes (`feat:`, `fix:`, `docs:`, etc.).
