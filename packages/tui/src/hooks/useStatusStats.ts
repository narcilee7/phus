// src/tui/hooks/useStatusStats.ts
// Periodic snapshot of tape/skill/checkpoint counters for the header bar.
// Pulls straight from the live agent — no reducer involvement.

import { useEffect, useState } from "react";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import { STATS_TICK_MS } from "@/constants.js";

export interface StatusStats {
  entries: number;
  skills: number;
  turns: number;
  checkpoints: number;
  lastCheckpointAt?: number;
}

export function useStatusStats(agent: PhusAgent): StatusStats {
  const [stats, setStats] = useState<StatusStats>({
    entries: 0,
    skills: 0,
    turns: 0,
    checkpoints: 0,
    lastCheckpointAt: undefined,
  });

  useEffect(() => {
    const tick = () => {
      try {
        let checkpoints = 0;
        let lastCheckpointAt: number | undefined;
        for (const entry of agent.replayTape()) {
          if (entry.kind === "checkpoint") {
            checkpoints++;
            const ts = entry.ts;
            if (ts && (!lastCheckpointAt || ts > lastCheckpointAt)) {
              lastCheckpointAt = ts;
            }
          }
        }
        setStats({
          entries: agent.getTapeTotalEntries(),
          skills: agent.getSkillCount(),
          turns: agent.getMessageCount(),
          checkpoints,
          lastCheckpointAt,
        });
      } catch {
        // Agent may be mid-bootstrap — swallow and try again next tick.
      }
    };
    tick();
    const id = setInterval(tick, STATS_TICK_MS);
    return () => clearInterval(id);
  }, [agent]);

  return stats;
}
