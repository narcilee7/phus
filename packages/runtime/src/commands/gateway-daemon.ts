// src/commands/gateway-daemon.ts
// `phus gateway (install|uninstall|start|stop|restart|status)` — manage
// the gateway as a systemd user service (Linux) or launchd agent (macOS).

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Command } from "commander";
import { execSync } from "node:child_process";
import { logger } from "@/infra/logging.js";

export interface ServicePaths {
  /** Directory the unit/plist file lives in. */
  dir: string;
  /** Full path to the unit/plist file. */
  file: string;
  /** Which supervisor is being used. */
  supervisor: "systemd-user" | "launchd";
}

export interface DaemonStatus {
  installed: boolean;
  running: boolean;
  detail?: string;
}

function getPhusExecutable(): string {
  if (process.env.PHUS_EXECUTABLE) return process.env.PHUS_EXECUTABLE;
  return process.argv[1] && process.argv[1].endsWith("dist/phus.mjs")
    ? process.argv[1]
    : "phus";
}

function getCwd(): string {
  return process.env.PHUS_DAEMON_CWD ?? process.cwd();
}

/** Detect which service manager to target on this host. */
export function detectServiceManager(): ServicePaths {
  const platform = os.platform();
  if (platform === "darwin") {
    const dir = path.join(os.homedir(), "Library", "LaunchAgents");
    return {
      dir,
      file: path.join(dir, "dev.phus.gateway.plist"),
      supervisor: "launchd",
    };
  }
  if (platform === "linux") {
    const dir = path.join(os.homedir(), ".config", "systemd", "user");
    return {
      dir,
      file: path.join(dir, "phus.service"),
      supervisor: "systemd-user",
    };
  }
  throw new Error(`Unsupported platform: ${platform}. Gateway daemon is only supported on Linux and macOS.`);
}

/** Build the systemd unit file contents. */
export function buildSystemdUnit(exec: string, cwd: string): string {
  return `[Unit]
Description=Phus gateway
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${exec} gateway
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

/** Build the launchd plist contents. */
export function buildLaunchdPlist(exec: string, cwd: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.phus.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${exec}</string>
    <string>gateway</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${cwd}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), "Library", "Logs", "phus-gateway.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), "Library", "Logs", "phus-gateway.error.log")}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`;
}

/** Write the service file for the current platform. */
export function writeServiceFile(paths: ServicePaths): void {
  fs.mkdirSync(paths.dir, { recursive: true });
  const exec = getPhusExecutable();
  const cwd = getCwd();
  const contents = paths.supervisor === "launchd"
    ? buildLaunchdPlist(exec, cwd)
    : buildSystemdUnit(exec, cwd);
  fs.writeFileSync(paths.file, contents, "utf-8");
  logger.info("gateway_daemon.service_written", { file: paths.file });
}

/** Remove the service file for the current platform. */
export function removeServiceFile(paths: ServicePaths): void {
  if (fs.existsSync(paths.file)) {
    fs.unlinkSync(paths.file);
    logger.info("gateway_daemon.service_removed", { file: paths.file });
  }
}

function execOrThrow(cmd: string, context: string): void {
  try {
    execSync(cmd, { stdio: "pipe", encoding: "utf-8" });
  } catch (err: any) {
    const message = err.stderr?.trim() || err.message || String(err);
    throw new Error(`${context} failed: ${message}`);
  }
}

/** Install the service file and reload the daemon. */
export function installService(paths: ServicePaths = detectServiceManager()): void {
  writeServiceFile(paths);
  if (paths.supervisor === "systemd-user") {
    execOrThrow("systemctl --user daemon-reload", "systemctl daemon-reload");
    console.log(`Installed systemd user service: ${paths.file}`);
    console.log("Run `phus gateway start` to start it.");
  } else {
    console.log(`Installed launchd agent: ${paths.file}`);
    console.log("Run `phus gateway start` to load it.");
  }
}

/** Remove the service file and reload the daemon. */
export function uninstallService(paths: ServicePaths = detectServiceManager()): void {
  if (paths.supervisor === "systemd-user") {
    try { execSync("systemctl --user stop phus", { stdio: "ignore" }); } catch { /* ignore */ }
    try { execSync("systemctl --user disable phus", { stdio: "ignore" }); } catch { /* ignore */ }
  } else {
    try { execSync("launchctl unload ~/Library/LaunchAgents/dev.phus.gateway.plist", { stdio: "ignore" }); } catch { /* ignore */ }
  }
  removeServiceFile(paths);
  if (paths.supervisor === "systemd-user") {
    execOrThrow("systemctl --user daemon-reload", "systemctl daemon-reload");
    console.log("Removed systemd user service.");
  } else {
    console.log("Removed launchd agent.");
  }
}

/** Start the service. */
export function startService(paths: ServicePaths = detectServiceManager()): void {
  if (paths.supervisor === "systemd-user") {
    execOrThrow("systemctl --user start phus", "systemctl start");
    console.log("Started phus gateway (systemd --user).");
  } else {
    execOrThrow("launchctl load ~/Library/LaunchAgents/dev.phus.gateway.plist", "launchctl load");
    console.log("Loaded phus gateway (launchd).");
  }
}

/** Stop the service. */
export function stopService(paths: ServicePaths = detectServiceManager()): void {
  if (paths.supervisor === "systemd-user") {
    execOrThrow("systemctl --user stop phus", "systemctl stop");
    console.log("Stopped phus gateway.");
  } else {
    execOrThrow("launchctl unload ~/Library/LaunchAgents/dev.phus.gateway.plist", "launchctl unload");
    console.log("Unloaded phus gateway.");
  }
}

/** Restart the service. */
export function restartService(paths: ServicePaths = detectServiceManager()): void {
  if (paths.supervisor === "systemd-user") {
    execOrThrow("systemctl --user restart phus", "systemctl restart");
    console.log("Restarted phus gateway.");
  } else {
    stopService(paths);
    startService(paths);
    console.log("Restarted phus gateway.");
  }
}

/** Query service status. */
export function statusService(paths: ServicePaths = detectServiceManager()): DaemonStatus {
  const installed = fs.existsSync(paths.file);
  if (paths.supervisor === "systemd-user") {
    try {
      const out = execSync("systemctl --user is-active phus", { stdio: "pipe", encoding: "utf-8" }).trim();
      return { installed, running: out === "active", detail: out };
    } catch (err: any) {
      return { installed, running: false, detail: err.stderr?.trim() || "inactive" };
    }
  } else {
    try {
      const out = execSync("launchctl list dev.phus.gateway", { stdio: "pipe", encoding: "utf-8" }).trim();
      return { installed, running: out.includes("\"PID\""), detail: out };
    } catch (err: any) {
      return { installed, running: false, detail: err.stderr?.trim() || "not loaded" };
    }
  }
}

function findGatewayCommand(program: Command): Command {
  const existing = program.commands.find((c) => c.name() === "gateway");
  if (existing) return existing;
  const gateway = program.command("gateway").description("Gateway daemon and channel listeners");
  return gateway;
}

/** Register `phus gateway (install|uninstall|start|stop|restart|status)`. */
export function registerGatewayDaemonCommands(program: Command): void {
  const gateway = findGatewayCommand(program);

  gateway
    .command("install")
    .description("Install the gateway as a systemd/launchd service")
    .action(() => {
      installService();
    });

  gateway
    .command("uninstall")
    .description("Remove the gateway systemd/launchd service")
    .action(() => {
      uninstallService();
    });

  gateway
    .command("start")
    .description("Start the gateway service")
    .action(() => {
      startService();
    });

  gateway
    .command("stop")
    .description("Stop the gateway service")
    .action(() => {
      stopService();
    });

  gateway
    .command("restart")
    .description("Restart the gateway service")
    .action(() => {
      restartService();
    });

  gateway
    .command("status")
    .description("Show gateway service status")
    .action(() => {
      const s = statusService();
      console.log(`Installed: ${s.installed ? "yes" : "no"}`);
      console.log(`Running:   ${s.running ? "yes" : "no"}`);
      if (s.detail) console.log(`Detail:    ${s.detail}`);
      process.exit(s.installed ? 0 : 1);
    });
}
