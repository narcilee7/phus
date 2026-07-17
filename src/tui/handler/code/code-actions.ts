// src/tui/code-actions.ts
// Cross-platform clipboard and code execution helpers for code block actions.

import { spawn } from "node:child_process";

export function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];
    if (platform === "darwin") {
      cmd = "pbcopy";
      args = [];
    } else if (platform === "win32") {
      cmd = "clip";
      args = [];
    } else {
      cmd = "xclip";
      args = ["-selection", "clipboard"];
    }
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with ${code}`));
      }
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

interface Interpreter {
  cmd: string;
  args: string[];
}

export function detectInterpreter(language: string): Interpreter | undefined {
  const lang = language.toLowerCase();
  if (["bash", "sh", "shell", "zsh"].includes(lang)) {
    return { cmd: "bash", args: ["-c"] };
  }
  if (["python", "py"].includes(lang)) {
    return { cmd: "python3", args: ["-c"] };
  }
  return undefined;
}

export async function runCode(
  language: string,
  code: string,
): Promise<{ output: string; exitCode: number | null }> {
  const interpreter = detectInterpreter(language);
  if (!interpreter) {
    throw new Error(`Running ${language || "text"} is not supported yet`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter.cmd, [...interpreter.args, code], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`--- stderr ---\n${stderr}`);
      resolve({ output: parts.join("\n").trim(), exitCode });
    });
  });
}
