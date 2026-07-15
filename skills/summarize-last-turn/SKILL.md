---
name: summarize-last-turn
description: Summarize the user's most recent request and your response in 1-2 sentences.
author: human
version: 1.0.0
---

# Summarize Last Turn

When asked to "summarize last turn" or "what just happened", produce exactly this format:

```
User: <one-line paraphrase of the user's message>
Phus: <one-line paraphrase of what you did / replied>
```

Focus on **intent and outcome**, not literal wording. If tools were used, name the most important one.
