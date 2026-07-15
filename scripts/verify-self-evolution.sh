#!/usr/bin/env bash
# scripts/verify-self-evolution.sh
# End-to-end demo of Phus's self-evolution loop:
#   turn 1: ask AI to write a new skill
#   turn 2: ask AI to use that skill
#   verify: Tape has both turns + skill_write tool_call + skill file on disk
#
# Auto-loads .env if present, then checks for any supported provider key.

set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env so user doesn't have to export manually.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# All provider keys Pi's getEnvApiKey() recognizes.
KEY_VARS=(
  OPENAI_API_KEY
  ANTHROPIC_API_KEY
  GEMINI_API_KEY
  DEEPSEEK_API_KEY
  GROQ_API_KEY
  MISTRAL_API_KEY
  XAI_API_KEY
  HF_TOKEN
  OPENROUTER_API_KEY
  ANTHROPIC_OAUTH_TOKEN
)

FOUND_KEY=""
for k in "${KEY_VARS[@]}"; do
  if [[ -n "${!k:-}" ]]; then
    FOUND_KEY="$k"
    break
  fi
done

if [[ -z "$FOUND_KEY" ]]; then
  echo "❌ No API key set."
  echo "Set one in .env (copy from .env.example) or export directly:"
  printf "  %s\n" "${KEY_VARS[@]}"
  exit 1
fi

# Show what model we're hitting.
echo "⛰️  Phus self-evolution verify"
echo "  provider key: $FOUND_KEY"
echo "  model:        ${PHUS_MODEL:-anthropic/claude-sonnet-4-20250514}"
if [[ -n "${PHUS_MODEL_ID:-}" ]]; then
  echo "  model id:     $PHUS_MODEL_ID (overrides Pi registry name)"
fi
if [[ -n "${PHUS_BASE_URL:-}" ]]; then
  echo "  base URL:     $PHUS_BASE_URL"
fi
echo

# Use a fresh tape + skills dir so this run is hermetic.
export PHUS_TAPE_DB="$(mktemp -t phus-verify-XXXXXX.sqlite)"
export PHUS_SKILLS_DIR="$(mktemp -d -t phus-verify-skills-XXXXXX)"
SKILL_NAME="verify-greet-$(date +%s)"

echo "  tape:   $PHUS_TAPE_DB"
echo "  skills: $PHUS_SKILLS_DIR"
echo "  skill:  $SKILL_NAME"
echo

echo "─── Turn 1: ask AI to write a skill named '$SKILL_NAME' ───"
if ! npx tsx src/phus.ts run "Create a new skill called $SKILL_NAME. Its description should be 'Greet the user by name.' The body should tell the agent to say \"Hello, <name>!\" in one sentence."; then
  echo "❌ Turn 1 failed — see output above"
  exit 1
fi
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
if ! npx tsx src/phus.ts run "Use the $SKILL_NAME skill to greet me. My name is Alice."; then
  echo "❌ Turn 2 failed — see output above"
  exit 1
fi
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
