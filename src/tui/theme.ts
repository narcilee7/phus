// src/tui/theme.ts
// Theme tokens for the TUI. Reads `theme` from phus.config.yaml (or
// `$PHUS_THEME`) and resolves to a flat color palette. Components
// consume tokens instead of hard-coding ink color strings.

import { loadConfig } from "@/infra/config/index.js";

export type ThemeName = "dark" | "light" | "high-contrast";

export interface ThemeColors {
  accent: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
  emphasis: string;
  diffAdd: string;
  diffDel: string;
  diffCtx: string;
  selectedBg: string;
  selectedFg: string;
}

const DARK: ThemeColors = {
  accent: "cyan",
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
  emphasis: "white",
  diffAdd: "green",
  diffDel: "red",
  diffCtx: "gray",
  selectedBg: "cyan",
  selectedFg: "black",
};

const LIGHT: ThemeColors = {
  accent: "blue",
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
  emphasis: "black",
  diffAdd: "green",
  diffDel: "red",
  diffCtx: "gray",
  selectedBg: "blue",
  selectedFg: "white",
};

const HIGH_CONTRAST: ThemeColors = {
  accent: "white",
  success: "greenBright",
  warning: "yellowBright",
  danger: "redBright",
  muted: "whiteBright",
  emphasis: "white",
  diffAdd: "greenBright",
  diffDel: "redBright",
  diffCtx: "white",
  selectedBg: "white",
  selectedFg: "black",
};

const PALETTES: Record<ThemeName, ThemeColors> = {
  dark: DARK,
  light: LIGHT,
  "high-contrast": HIGH_CONTRAST,
};

/** Read the active theme name. Falls back to "dark" when the config
 *  can't be loaded or no theme is set. */
export function resolveThemeName(): ThemeName {
  const fromEnv = process.env.PHUS_THEME;
  if (fromEnv === "dark" || fromEnv === "light" || fromEnv === "high-contrast") {
    return fromEnv;
  }
  try {
    const cfg = loadConfig() as { theme?: string };
    if (cfg.theme === "light" || cfg.theme === "high-contrast") {
      return cfg.theme;
    }
  } catch {
    // ignore — default to dark
  }
  return "dark";
}

/** Resolve the active theme's color palette. */
export function getTheme(): ThemeColors {
  return PALETTES[resolveThemeName()];
}

/** Whether the spinner animation should be suppressed (low-end terminals). */
export function animationDisabled(): boolean {
  if (process.env.PHUS_NO_ANIM === "1") return true;
  try {
    const cfg = loadConfig() as { ui?: { animations?: boolean } };
    if (cfg.ui?.animations === false) return true;
  } catch {
    // ignore
  }
  return false;
}
