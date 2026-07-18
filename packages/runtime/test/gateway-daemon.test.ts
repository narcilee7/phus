// test/gateway-daemon.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  buildSystemdUnit,
  buildLaunchdPlist,
  writeServiceFile,
  removeServiceFile,
  detectServiceManager,
  statusService,
  type ServicePaths,
} from "../src/commands/gateway-daemon";

describe("gateway-daemon service files", () => {
  let tmpDir: string;
  let paths: ServicePaths;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-daemon-"));
    paths = {
      dir: tmpDir,
      file: path.join(tmpDir, "phus.service"),
      supervisor: "systemd-user",
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds a systemd unit with the given executable and cwd", () => {
    const unit = buildSystemdUnit("/opt/phus/dist/phus.mjs", "/opt/phus");
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("ExecStart=/opt/phus/dist/phus.mjs gateway");
    expect(unit).toContain("WorkingDirectory=/opt/phus");
    expect(unit).toContain("Restart=on-failure");
  });

  it("builds a launchd plist with the given executable and cwd", () => {
    const plist = buildLaunchdPlist("/opt/phus/dist/phus.mjs", "/opt/phus");
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>dev.phus.gateway</string>");
    expect(plist).toContain("<string>/opt/phus/dist/phus.mjs</string>");
    expect(plist).toContain("<string>/opt/phus</string>");
  });

  it("writes and removes a service file", () => {
    process.env.PHUS_EXECUTABLE = "/tmp/phus.mjs";
    process.env.PHUS_DAEMON_CWD = "/tmp";
    writeServiceFile(paths);
    expect(fs.existsSync(paths.file)).toBe(true);
    const contents = fs.readFileSync(paths.file, "utf-8");
    expect(contents).toContain("ExecStart=/tmp/phus.mjs gateway");
    expect(contents).toContain("WorkingDirectory=/tmp");

    removeServiceFile(paths);
    expect(fs.existsSync(paths.file)).toBe(false);
    delete process.env.PHUS_EXECUTABLE;
    delete process.env.PHUS_DAEMON_CWD;
  });

  it("detects systemd on linux and launchd on darwin", () => {
    const detected = detectServiceManager();
    if (os.platform() === "darwin") {
      expect(detected.supervisor).toBe("launchd");
      expect(detected.file).toContain("Library/LaunchAgents/dev.phus.gateway.plist");
    } else if (os.platform() === "linux") {
      expect(detected.supervisor).toBe("systemd-user");
      expect(detected.file).toContain(".config/systemd/user/phus.service");
    }
  });

  it("statusService reports installed=false when file is missing", () => {
    const s = statusService(paths);
    expect(s.installed).toBe(false);
  });
});
