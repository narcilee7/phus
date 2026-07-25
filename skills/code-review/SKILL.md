---
name: code-review
description: Generate a focused PR/code review from a diff or change description.
author: phus
version: 1.0.0
trigger: when asked to review code, a PR, or a diff
---

# Code Review

When asked to review code, a PR, or a diff, produce a structured review in this order:

1. **Summary** — one sentence on what the change does and whether it looks safe to merge.
2. **Critical issues** — correctness, security, race conditions, error handling, API contract breaks. Use `⚠️`.
3. **Suggestions** — readability, maintainability, performance, testing. Use `💡`.
4. **Nits** — style, naming, formatting. Use `📝`.
5. **Verdict** — one of `approve`, `request_changes`, or `comment`, with a one-line rationale.

Rules:
- Be specific: cite file paths and line numbers when possible.
- Do not re-state the obvious ("this adds a function").
- Prioritize: stop at 3–5 critical issues and 3–5 suggestions.
- If the diff is too large, ask for a smaller scope or review only the files you can fully read.
