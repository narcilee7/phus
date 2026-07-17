# Intelligence Alignment

> A product and engineering alignment doc for the next phase of Phus.
>
> Goal: on top of the existing runtime, close the gap on `memory`, `self-evolution`, and `code capability` against leading products such as Claude Code, Kimi Code, and OpenClaw.

---

## 1. Why this doc exists

Phus already has the ingredients of a serious agent runtime:

- a turn pipeline with hooks
- SQLite tape for durable history
- skills and plugins
- planner / plan runner / subagents / verifier
- a reflection and evolution loop
- project memory primitives

What we do not yet have is a single, explicit product target for the intelligence layer.

This document defines that target.

---

## 2. Benchmark set

We are not copying products. We are borrowing the best parts of their shape.

### Claude Code

Claude Code is strong at:

- reading a codebase deeply
- editing files and running commands
- using hooks, subagents, permissions, and sessions
- accumulating project memory with `CLAUDE.md` and auto memory

Official docs:

- [Overview](https://code.claude.com/docs/en/overview)
- [Memory](https://code.claude.com/docs/en/memory)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Skills](https://code.claude.com/docs/en/skills)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)

### Kimi Code

Kimi Code is strong at:

- long-horizon coding tasks
- large-context reasoning
- command execution and file operations
- parallel work with subagents

Official docs:

- [Kimi Code CLI](https://www.kimi.com/code)
- [Kimi K2.7 Code](https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart)
- [Model list](https://platform.kimi.ai/docs/models)

### OpenClaw

OpenClaw is strong at:

- local-first assistant behavior
- persistent markdown-based memory
- skills as user-authored capability packs
- multi-channel availability
- memory search and memory promotion

Official docs:

- [Memory overview](https://docs.openclaw.ai/concepts/memory)
- [Skills](https://docs.openclaw.ai/tools/skills)
- [Memory CLI](https://docs.openclaw.ai/cli/memory)
- [Memory plugin docs](https://docs.openclaw.ai/plugins/memory-lancedb)

---

## 3. What Phus already has

Phus already has a real base layer for this target:

- `HookRegistry` turn orchestration
- `Tape` as append-only durable history
- `SkillRegistry` and runtime skill loading
- `MemoryStore` and autonomy gate
- `Planner`, `PlanRunner`, `Verifier`
- `SubAgent`
- `Learner` and `EvolutionEngine`
- plugin loading and meta tools

In other words: this is not a blank slate. The right next move is to connect these pieces into a sharper intelligence loop.

Relevant code:

- [`src/bridge/pi-agent.ts`](../src/bridge/pi-agent.ts)
- [`src/core/runtime/plan/planner.ts`](../src/core/runtime/plan/planner.ts)
- [`src/core/runtime/plan/plan-runner.ts`](../src/core/runtime/plan/plan-runner.ts)
- [`src/core/runtime/subagent/index.ts`](../src/core/runtime/subagent/index.ts)
- [`src/core/runtime/verifier/index.ts`](../src/core/runtime/verifier/index.ts)
- [`src/core/runtime/evolution/engine.ts`](../src/core/runtime/evolution/engine.ts)
- [`src/core/runtime/evolution/learner.ts`](../src/core/runtime/evolution/learner.ts)

---

## 4. Product north star

Phus should become:

> A local-first, self-improving coding agent runtime that can remember, plan, verify, repair, and gradually learn from its own work.

This target has three pillars:

1. `memory`
2. `self-evolution`
3. `code capability`

Everything else is support structure.

---

## 5. Capability matrix

| Capability | Claude Code | Kimi Code | OpenClaw | Phus today | Gap to close |
|---|---|---|---|---|---|
| Persistent project memory | `CLAUDE.md` + auto memory | not the emphasis | Markdown memory files | Tape + project memory store | Better retrieval, summarization, and write policy |
| Long-horizon task execution | strong | strong | moderate | plan runner + subagents | stronger task state, recovery, and replan |
| Codebase understanding | very strong | strong | moderate | good runtime access, but not yet optimized | repo map, file retrieval, change impact analysis |
| Tool use / command execution | strong | strong | strong | strong | tighter action gating and verification |
| Subagents | first-class | supported | present in ecosystem | present | better delegation strategy and task partitioning |
| Hooks / lifecycle controls | strong | moderate | strong | strong | better hook semantics for intelligence loops |
| Skills as capability units | strong | strong | strong | strong | skill scoring, promotion, and deprecation |
| Self-improvement / learning | auto memory + skills | limited public emphasis | memory + skills workflow | learner + draft skills exist | close the loop with evaluation and promotion |
| Repair after failure | strong | strong | moderate | partial | automatic retry / replan / escalate policy |
| Local-first ownership | partial | partial | strong | strong | package the intelligence loop as the product center |

---

## 6. Core gaps

### 6.1 Memory is not yet a first-class intelligence primitive

Today memory exists, but it is not yet structured enough to drive decisions.

We need memory to answer:

- What does this user prefer?
- What has failed before?
- What patterns work in this repo?
- What should be remembered permanently?
- What should be summarized and forgotten?

Memory should not just be storage.
Memory should be a retrieval and policy layer.

### 6.2 Self-evolution is not yet fully closed loop

We can reflect and draft skills, but the loop should be stronger:

- infer reusable procedure
- score usefulness
- generate draft skill
- validate against a task
- promote only when it proves useful
- keep regression evidence

The key missing piece is disciplined promotion, not just generation.

### 6.3 Code capability is still mostly “chat + tools”

To compete with Claude Code / Kimi Code, Phus needs to become more code-native:

- faster repo scanning
- better file relevance ranking
- stronger patch planning
- diff review and rollback discipline
- task-level execution tracking
- validation after change

The product should feel like a code operator, not just a chat interface.

---

## 7. Target architecture

### Memory layer

Build memory in three levels:

1. **Project memory**  
   Durable facts about the repo, architecture, conventions, and decisions.

2. **Episodic memory**  
   Task/session summaries, failures, fixes, and reasoning traces.

3. **Procedural memory**  
   Reusable workflows, skills, and policies that the agent can apply later.

### Self-evolution layer

Turn every meaningful task into a possible learning event:

1. observe outcome
2. reflect on success/failure
3. extract reusable procedure
4. draft or update skill
5. validate on a real task
6. promote or archive

### Code capability layer

Make code work the default mode:

1. map the repo
2. choose relevant files
3. propose a plan
4. edit with diffs
5. run verification
6. repair if needed
7. summarize what changed and why

---

## 8. Roadmap

### Phase 1: Memory OS

Goal: make memory useful for decision-making.

Deliverables:

- memory schema for facts, tasks, decisions, and failures
- retrieval ranking by recency, relevance, and authority
- memory write policy with promotion rules
- memory compaction and summarization
- memory diff / audit trail

### Phase 2: Long Task OS

Goal: make long tasks resilient.

Deliverables:

- explicit task state model
- milestone checkpoints
- pause / resume / retry / replan
- subagent delegation rules
- failure recovery paths
- task-level progress reporting

### Phase 3: Self-Evolution Loop

Goal: make the agent learn from its own work.

Deliverables:

- reflection after task completion
- reusable procedure detection
- skill draft generation
- skill validation harness
- promotion / archive policy
- regression memory for failed patterns

### Phase 4: Code Operator Mode

Goal: make Phus strong at repo-scale code work.

Deliverables:

- codebase map / symbol index / file ranking
- patch planning before edits
- diff review with accept / reject / revise
- command execution trace and verification
- failure-aware repair loops
- stronger context assembly for code tasks

### Phase 5: Safety and Reliability

Goal: make the intelligence loop safe enough to trust.

Deliverables:

- stronger permission gating
- clear audit trail
- rollback hooks for file and skill changes
- evaluation suite for memory, planning, and repair
- metrics for success rate, recovery rate, and skill quality

---

## 9. Success metrics

We should measure whether the system is actually getting smarter.

Recommended metrics:

- task completion rate on long-horizon tasks
- retry-to-success rate after failure
- percentage of tasks that produce reusable procedures
- skill promotion precision
- memory recall precision
- context retrieval relevance
- number of tasks recovered after interruption
- number of tasks completed without human intervention after planning

---

## 10. Immediate next moves

If we want to start now, the best first implementation order is:

1. memory retrieval and memory write policy
2. task state machine for long tasks
3. reflection-to-skill draft loop
4. verification-driven repair loop
5. codebase map and diff review improvements

That sequence gives us compounding value quickly.

