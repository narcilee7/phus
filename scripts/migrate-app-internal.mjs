#!/usr/bin/env node
// scripts/migrate-app-internal.mjs
// Replace `_internal.X` access patterns in App.tsx with facade methods.

import { readFileSync, writeFileSync } from "node:fs";

const file = "src/tui/App.tsx";
let src = readFileSync(file, "utf8");

const replacements = [
  // Writes
  ["agent._internal.piAgent.state.model = next", "agent.setModel(next.id, next.provider)"],
  ["agent._internal.piAgent.state.thinkingLevel = arg as any", "agent.setThinkingLevel(arg)"],
  ["agent._internal.piAgent.state.messages = []", "await agent.clearConversation()"],
  // Skill reads
  ["agent._internal.skills.getAll()", "agent.getAllSkills()"],
  ["agent._internal.skills.getAll().length", "agent.getSkillCount()"],
  ["agent._internal.skills.discover()", "await agent.reloadSkills()"],
  ["agent._internal.skills.toPromptContext()", "agent.getSkillsPrompt()"],
  ["agent._internal.skills.get(arg)", "agent.getSkill(arg)"],
  // Tape reads
  ["agent._internal.tape.stats()", "agent.getTapeStats()"],
  ["agent._internal.tape.summary(sessionId, 5)", "agent.getTapeSummary(agent.getCurrentSessionId(), 5)"],
  ["Array.from(agent._internal.tape.replay(sessionId))", "Array.from(agent.replayTape(sessionId))"],
  // Policy
  ["agent._internal.policy", "agent.getPolicy()"],
  // Pi Agent state reads
  ["agent._internal.piAgent.abort()", "agent.interrupt()"],
  ["agent._internal.piAgent.state.thinkingLevel", "agent.getThinkingLevel()"],
  ["agent._internal.piAgent.state.messages.length", "agent.getMessageCount()"],
  // Model label
  ["agent._internal.piAgent.state.model", "agent.getCurrentModel()"],
  // Turn count
  [
    "agent._internal.piAgent.state.messages\n              .filter((m) => m.role === \"user\" || m.role === \"assistant\")\n              .length",
    "agent.getTurnCount()",
  ],
];

let count = 0;
for (const [from, to] of replacements) {
  const before = src;
  src = src.split(from).join(to);
  if (src !== before) count++;
}

writeFileSync(file, src, "utf8");
console.log(`Applied ${count}/${replacements.length} replacements to ${file}`);