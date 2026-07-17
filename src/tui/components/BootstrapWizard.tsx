// src/tui/components/BootstrapWizard.tsx
// First-run configuration wizard. Launched by `startTui()` when no
// phus.config.yaml exists. Walks the user through picking a provider,
// model, API-key env var and profile name, then writes the file and
// lets the main TUI continue.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { configPath, resetConfigCache } from "@/infra/config/index.js";

type WizardStep =
  | "welcome"
  | "provider"
  | "model"
  | "apiKey"
  | "keyMode"
  | "profile"
  | "confirm"
  | "done"
  | "error";

interface BootstrapWizardProps {
  onDone: (success: boolean) => void;
}

interface PickerProps<T> {
  title: string;
  items: T[];
  selectedIndex: number;
  renderLabel: (item: T) => string;
}

const PICKER_VISIBLE_COUNT = 10;

function truncateLabel(label: string, max: number): string {
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}

/** Derive a conventional env var name from a provider id, e.g.
 *  "anthropic" → "ANTHROPIC_API_KEY". Used by the wizard as the
 *  sensible default when the user picks "use env var". */
function defaultEnvVarName(provider: string | undefined): string {
  if (!provider) return "API_KEY";
  const upper = provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `${upper}_API_KEY`;
}

function Picker<T>({ title, items, selectedIndex, renderLabel }: PickerProps<T>) {
  const { stdout } = useStdout();
  // Outer box: double border (1 each side) + paddingX=2 (2 each side) = 6 cols.
  const rowWidth = Math.max(8, stdout.columns - 6);
  const maxLabelWidth = Math.max(1, rowWidth - 2);

  const visibleStart = Math.max(
    0,
    Math.min(selectedIndex, items.length - PICKER_VISIBLE_COUNT),
  );
  const visibleItems = items.slice(visibleStart, visibleStart + PICKER_VISIBLE_COUNT);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleItems.map((item, idx) => {
          const actualIndex = visibleStart + idx;
          const selected = actualIndex === selectedIndex;
          const prefix = selected ? "› " : "  ";
          const label = truncateLabel(renderLabel(item), maxLabelWidth);
          return (
            <Box key={`${label}-${actualIndex}`} width={rowWidth} backgroundColor={selected ? "cyan" : undefined}>
              <Text color={selected ? "black" : undefined} dimColor={!selected}>
                {prefix}{label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter confirm · Esc back</Text>
      </Box>
    </Box>
  );
}

interface TextStepProps {
  title: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  /** When true, the displayed value is masked with bullets to keep
   *  secrets off the screen. The real value is still passed through
   *  `onChange` unchanged. */
  secure?: boolean;
}

function TextStep({ title, value, onChange, placeholder, hint, secure }: TextStepProps) {
  useInput((input, key) => {
    if (key.return || key.escape) return;
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      onChange(value + input);
    }
  });

  const display = secure && value.length > 0 ? "•".repeat(value.length) : value;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{title}</Text>
      <Box marginTop={1}>
        <Text color="cyan">{display}</Text>
        <Text color="cyan">▍</Text>
        {value.length === 0 && placeholder && (
          <Text dimColor>{placeholder}</Text>
        )}
      </Box>
      {hint && (
        <Box marginTop={1}>
          <Text dimColor>{hint}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Enter confirm · Esc back</Text>
      </Box>
    </Box>
  );
}

export function BootstrapWizard({ onDone }: BootstrapWizardProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [providers, setProviders] = useState<string[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Map<string, string[]>>(new Map());
  const [providerIndex, setProviderIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  /** "inline" writes the secret straight into apiKey; "envVar" stores
   *  the name of the env var (preferred for shared / multi-host setups). */
  const [keyMode, setKeyMode] = useState<"inline" | "envVar">("envVar");
  const [profileName, setProfileName] = useState("default");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { getProviders, getModels } = await import("@mariozechner/pi-ai");
        const list = getProviders();
        const map = new Map<string, string[]>();
        for (const p of list) {
          map.set(p, getModels(p as any).map((m) => m.id));
        }
        if (!cancelled) {
          setProviders(list);
          setModelsByProvider(map);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(`could not load provider registry: ${err.message ?? err}`);
          setStep("error");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const models = useMemo(() => {
    const p = providers[providerIndex];
    return p ? (modelsByProvider.get(p) ?? []) : [];
  }, [providers, providerIndex, modelsByProvider]);

  useEffect(() => {
    setModelIndex(0);
  }, [providerIndex]);

  useInput((input, key) => {
    if (step === "welcome") {
      if (key.return) setStep("provider");
      if (key.escape || (key.ctrl && input === "c")) {
        onDone(false);
        exit();
      }
      return;
    }

    if (step === "provider") {
      if (key.upArrow) setProviderIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setProviderIndex((i) => Math.min(providers.length - 1, i + 1));
      if (key.return) {
        setApiKey("");
        setStep("model");
      }
      if (key.escape) setStep("welcome");
      return;
    }

    if (step === "model") {
      if (key.upArrow) setModelIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setModelIndex((i) => Math.min(models.length - 1, i + 1));
      if (key.return) {
        setStep("keyMode");
        setApiKey(defaultEnvVarName(providers[providerIndex]));
      }
      if (key.escape) setStep("provider");
      return;
    }

    if (step === "apiKey") {
      if (key.return) {
        if (apiKey.trim().length > 0) {
          setStep("profile");
        }
        return;
      }
      if (key.escape) {
        setStep("model");
        return;
      }
      return;
    }

    if (step === "keyMode") {
      if (key.upArrow || key.downArrow) {
        setKeyMode((m) => (m === "envVar" ? "inline" : "envVar"));
      }
      if (key.return) {
        setApiKey(keyMode === "envVar" ? defaultEnvVarName(providers[providerIndex]) : "");
        setStep(keyMode === "envVar" ? "apiKey" : "apiKey");
      }
      if (key.escape) {
        setStep("model");
      }
      return;
    }

    if (step === "profile") {
      if (key.return) setStep("confirm");
      if (key.escape) {
        setStep("keyMode");
        return;
      }
      return;
    }

    if (step === "confirm") {
      if (input === "y" || input === "Y") {
        void writeConfig();
      }
      if (input === "n" || input === "N" || key.escape) {
        setStep("profile");
      }
      return;
    }

    if (step === "done" || step === "error") {
      if (key.return || key.escape || (key.ctrl && input === "c")) {
        onDone(step === "done");
        exit();
      }
    }
  });

  async function writeConfig() {
    const cfgPath = configPath();
    if (existsSync(cfgPath)) {
      setError(`config already exists at ${cfgPath}; wizard will not overwrite it`);
      setStep("error");
      return;
    }
    const home = path.dirname(cfgPath);
    const provider = providers[providerIndex];
    const modelId = models[modelIndex];
    if (!provider || !modelId) {
      setError("provider or model not selected");
      setStep("error");
      return;
    }
    const name = profileName.trim() || "default";
    const profile: Record<string, unknown> = {
      provider,
      modelId,
      thinkingLevel: "medium",
    };
    if (keyMode === "inline" && apiKey.trim()) {
      profile.apiKey = apiKey.trim();
    } else if (keyMode === "envVar" && apiKey.trim()) {
      profile.apiKeyEnv = apiKey.trim();
    }
    const config = {
      providers: {
        defaultProfile: name,
        profiles: {
          [name]: profile,
        },
      },
    };
    try {
      await mkdir(home, { recursive: true });
      await writeFile(cfgPath, yaml.stringify(config));
      resetConfigCache();
      setStep("done");
    } catch (err: any) {
      setError(`could not write config: ${err.message ?? err}`);
      setStep("error");
    }
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      height={24}
    >
      {step === "welcome" && (
        <Box flexDirection="column">
          <Text bold color="cyan">Welcome to Phus</Text>
          <Text>
            No config file found at{" "}
            <Text color="yellow">{configPath()}</Text>.
          </Text>
          <Text>Let&apos;s create one in a few steps.</Text>
          <Box marginTop={2}>
            <Text dimColor>Enter continue · Esc/Ctrl+C quit</Text>
          </Box>
        </Box>
      )}

      {step === "provider" && (
        <Picker
          title="Pick a provider"
          items={providers}
          selectedIndex={providerIndex}
          renderLabel={(p) => p}
        />
      )}

      {step === "model" && (
        <Picker
          title={`Pick a model for ${providers[providerIndex] ?? ""}`}
          items={models}
          selectedIndex={modelIndex}
          renderLabel={(m) => m}
        />
      )}

      {step === "keyMode" && (
        <Box flexDirection="column">
          <Text bold color="cyan">How do you want to provide the key?</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={keyMode === "envVar" ? "cyan" : undefined}>
              {keyMode === "envVar" ? "› " : "  "}Use an environment variable (recommended)
            </Text>
            <Text color={keyMode === "inline" ? "cyan" : undefined}>
              {keyMode === "inline" ? "› " : "  "}Paste the key inline (stored in config)
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>↑↓ toggle · Enter confirm · Esc back</Text>
          </Box>
        </Box>
      )}

      {step === "apiKey" && (
        <TextStep
          title={keyMode === "envVar" ? "Env var name" : "API key"}
          value={apiKey}
          onChange={setApiKey}
          placeholder={keyMode === "envVar" ? "ANTHROPIC_API_KEY" : "sk-..."}
          secure={keyMode === "inline"}
          hint={
            keyMode === "envVar"
              ? `Phus will read $${apiKey || defaultEnvVarName(providers[providerIndex])} from the environment. Make sure it is exported before running.`
              : "Your API key for the selected provider. It will be written to phus.config.yaml so Phus can use it right away."
          }
        />
      )}

      {step === "profile" && (
        <TextStep
          title="Profile name"
          value={profileName}
          onChange={setProfileName}
          placeholder="default"
          hint="You can add more profiles later by editing phus.config.yaml."
        />
      )}

      {step === "confirm" && (
        <Box flexDirection="column">
          <Text bold color="cyan">Write this config?</Text>
          <Box marginY={1} paddingX={1} borderStyle="round" borderColor="gray">
            <Text dimColor>
              {yaml.stringify({
                providers: {
                  defaultProfile: profileName.trim() || "default",
                  profiles: {
                    [profileName.trim() || "default"]: {
                      provider: providers[providerIndex],
                      modelId: models[modelIndex],
                      ...(keyMode === "inline"
                        ? { apiKey: apiKey.trim() ? "***" : "(missing)" }
                        : { apiKeyEnv: apiKey.trim() || "(missing)" }),
                      thinkingLevel: "medium",
                    },
                  },
                },
              }).trimEnd()}
            </Text>
          </Box>
          <Text dimColor>y confirm · n edit · Esc back</Text>
        </Box>
      )}

      {step === "done" && (
        <Box flexDirection="column">
          <Text bold color="green">✓ Config saved</Text>
          <Text>{configPath()}</Text>
          <Box marginTop={1}>
            <Text dimColor>Enter continue to Phus</Text>
          </Box>
        </Box>
      )}

      {step === "error" && (
        <Box flexDirection="column">
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
