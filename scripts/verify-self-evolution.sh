#!/usr/bin/env bash
# scripts/verify-self-evolution.sh
# End-to-end demo of Phus's self-evolution loop:
#   turn 1: ask AI to write a new skill
#   turn 2: ask AI to use that skill
#   verify: Tape has both turns + skill_write tool_call + skill file on disk
#
# Requires: OPENROUTER_API_KEY in env (or any Pi-supported provider key).

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${OPENROUTER_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  echo "❌ No API key set. Export one of: OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY"
  exit 1
fi

# Use a fresh tape so this run is hermetic.
export PHUS_TAPE_DB="$(mktemp -t phus-verify-XXXXXX.sqlite)"
export PHUS_SKILLS_DIR="$(mktemp -d -t phus-verify-skills-XXXXXX)"
SKILL_NAME="verify-greet-$(date +%s)"

echo "⛰️  Phus self-evolution verify"
echo "  tape:   $PHUS_TAPE_DB"
echo "  skills: $PHUS_SKILLS_DIR"
echo "  skill:  $SKILL_NAME"
echo

echo "─── Turn 1: ask AI to write a skill named '$SKILL_NAME' ───"
npx tsx src/phus.ts run "Create a new skill called $SKILL_NAME. Its description should be 'Greet the user by name.' The body should tell the agent to say 'Hello, <name>!' in one sentence."
echo

echo "─── Verifying skill was written to disk ───"
if [[ ! -f "$PHUS_SKILLS_DIR/$SKILL_NAME/SKILL.md" ]]; then
  echo "❌ FAIL: $PHUS_SKILLS_DIR/$SKILL_NAME/SKILL.md not found"
  echo "Skills dir contents:"
  ls -la "$PHUS_SKILLS_DIR" || true
  exit 1
fi
echo "✅ Found $(realpath "$PHUS_SKILLS_DIR/$SKILL_NAME/SKILL.md")"
cat "$PHUS_SKILLS_DIR/$SKILL_NAME/SKILL.md"
echo

echo "─── Turn 2: ask AI to use the new skill ───"
npx tsx src/phus.ts run "Use the $SKILL_NAME skill to greet me. My name is Alice."
echo

echo "─── Verifying both turns were recorded to tape ───"
SESSION_ID="cli:user"
TURNS=$(sqlite3 "$PHUS_TAPE_DB" "SELECT COUNT(*) FROM tape WHERE session_id = '$SESSION_ID' AND kind = 'turn';" 2>/dev/null || echo "0")
TOOL_CALLS=$(sqlite3 "$PHUS_TAPE_DB" "SELECT COUNT(*) FROM tape WHERE session_id = '$SESSION_ID' AND kind = 'tool_call' AND name = 'skill_write';" 2>/dev/null || echo "0")

echo "  turns recorded:    $TURNS (expect ≥ 2)"
echo "  skill_write calls: $TOOL_CALLS (expect ≥ 1)"

if [[ "$TURNS" -lt 2 ]]; then
  echo "❌ FAIL: expected ≥ 2 turns"
  exit 1
fi
if [[ "$TOOL_CALLS" -lt 1 ]]; then
  echo "❌ FAIL: expected ≥ 1 skill_write tool_call"
  exit 1
fi

echo
echo "✅ PASS: Phus wrote a skill, persisted it, and (likely) used it next turn."
echo
echo "─── Tape trace ───"
npx tsx src/phus.ts trace "$SESSION_ID" --limit 20 || true
