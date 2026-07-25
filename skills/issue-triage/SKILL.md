---
name: issue-triage
description: Suggest labels, priority, and assignee for a GitHub/GitLab issue.
author: phus
version: 1.0.0
trigger: when asked to triage an issue
---

# Issue Triage

When given an issue title and body, produce a structured triage:

1. **Summary** — one-sentence restatement of the problem.
2. **Suggested labels** — pick from common categories:
   - `bug`, `feature`, `docs`, `performance`, `security`, `refactor`, `testing`, `good first issue`, `help wanted`
   - Severity: `p0-critical`, `p1-high`, `p2-medium`, `p3-low`
   - Area: `ui`, `api`, `cli`, `runtime`, `build`, `release`
3. **Priority** — `p0` to `p3` with one-line rationale.
4. **Likely assignee profile** — e.g., "runtime owner", "frontend owner", "new contributor friendly".
5. **Next action** — a concrete step (ask for repro, assign to owner, close as duplicate, etc.).

Rules:
- Do not guess personal names; suggest role/profile only.
- If the issue is unclear, say what information is missing.
- Keep the output concise: bullets only, no long prose.
