// src/tui/components/KeyWizard.tsx
// Lightweight wizard used when config exists but no API key is configured.
// Lets the user pick how to provide the key (env var or inline) and writes
// the new value back into the active profile in phus.config.yaml.

import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { configPath, loadConfig, resetConfigCache } from "@phus/runtime/infra/config/index.js";

type Step = "mode" | "value" | "done" | "error";

interface KeyWizardProps {
  onDone: (success: boolean) => void;
}

function defaultEnvVarName(provider: string | undefined): string {
  if (!provider) return "API_KEY";
  const upper = provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `${upper}_API_KEY`;
}

export function KeyWizard({ onDone }: KeyWizardProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<"envVar" | "inline">("envVar");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [provider, setProvider] = useState<string | undefined>(undefined);

  useEffect(() => {
    try {
      const cfg = loadConfig();
      const profile = cfg.providers?.profiles?.[cfg.profileName];
      const providerName = profile?.provider;
      setProvider(providerName);
      // Default the env var name to the conventional one for the active profile.
      setValue(defaultEnvVarName(providerName));
    } catch {
      // Ignore — defaults already cover the form.
    }
  }, []);

  useInput((input, key) => {
    if (step === "mode") {
      if (key.upArrow || key.downArrow) {
        setMode((m) => {
          const next = m === "envVar" ? "inline" : "envVar";
          // Reset the input field so the user doesn't carry the env var
          // name forward into the inline key entry (or vice versa).
          setValue(next === "envVar" ? defaultEnvVarName(provider) : "");
          return next;
        });
      }
      if (key.return) setStep("value");
      if (key.escape || (key.ctrl && input === "c")) {
        onDone(false);
        exit();
      }
      return;
    }
    if (step === "value") {
      if (key.return) {
        void save();
        return;
      }
      if (key.escape) {
        setStep("mode");
        return;
      }
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v + input);
      }
    }
    if (step === "done" || step === "error") {
      if (key.return || key.escape || (key.ctrl && input === "c")) {
        onDone(step === "done");
        exit();
      }
    }
  });

  async function save() {
    const cfgPath = configPath();
    if (!existsSync(cfgPath)) {
      setError(`config not found at ${cfgPath}`);
      setStep("error");
      return;
    }
    try {
      const raw = await readFile(cfgPath, "utf-8");
      const cfg = yaml.parse(raw) ?? {};
      const profiles = (cfg.providers?.profiles ?? {}) as Record<string, Record<string, unknown>>;
      const activeName = cfg.providers?.defaultProfile ?? "default";
      const profile = profiles[activeName];
      if (!profile) {
        setError(`active profile "${activeName}" not found in config`);
        setStep("error");
        return;
      }
      if (mode === "envVar") {
        profile.apiKeyEnv = value.trim() || undefined;
        delete profile.apiKey;
      } else {
        profile.apiKey = value.trim() || undefined;
        delete profile.apiKeyEnv;
      }
      await mkdir(path.dirname(cfgPath), { recursive: true });
      await writeFile(cfgPath, yaml.stringify(cfg));
      resetConfigCache();
      setStep("done");
    } catch (err: any) {
      setError(`could not update config: ${err.message ?? err}`);
      setStep("error");
    }
  }

  const rowWidth = Math.max(8, (stdout?.columns ?? 80) - 6);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">Add an API key</Text>
      <Text>Phus needs an API key to reach the model provider.</Text>

      {step === "mode" && (
        <Box flexDirection="column" marginTop={1}>
          <Box
            flexDirection="column"
            marginTop={1}
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            width={rowWidth}
          >
            <Text color={mode === "envVar" ? "cyan" : undefined}>
              {mode === "envVar" ? "› " : "  "}Use an environment variable (recommended)
            </Text>
            <Text color={mode === "inline" ? "cyan" : undefined}>
              {mode === "inline" ? "› " : "  "}Paste the key inline (stored in config)
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>↑↓ toggle · Enter confirm · Esc quit</Text>
          </Box>
        </Box>
      )}

      {step === "value" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">{mode === "envVar" ? "Env var name" : "API key"}</Text>
          <Box marginTop={1}>
            <Text color="cyan">
              {mode === "inline" ? "•".repeat(value.length) : value}
            </Text>
            <Text color="cyan">▍</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              {mode === "envVar"
                ? `Phus will read $${value || "API_KEY"} from the environment.`
                : "Type the key; it will be stored in phus.config.yaml."}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter confirm · Esc back</Text>
          </Box>
        </Box>
      )}

      {step === "done" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="green">✓ Saved</Text>
          <Text dimColor>Enter continue to Phus</Text>
        </Box>
      )}

      {step === "error" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="red">Setup failed</Text>
          <Text color="red">{error}</Text>
          <Box marginTop={1}>
            <Text dimColor>Enter/Esc exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
