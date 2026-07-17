// src/tui/components/Spinner.tsx
// Animated cyan spinner — used while the agent is thinking.

import React, { useState, useEffect } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸"];

export function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 120);
    return () => clearInterval(id);
  }, []);
  return <Text color="cyan">{FRAMES[frame]}</Text>;
}