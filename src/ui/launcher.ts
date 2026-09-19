import { execSync } from "child_process";

const knownApps: Record<string, string> = {
  blender: "blender",
  chrome: "chrome",
  "google chrome": "chrome",
  firefox: "firefox",
  vscode: "code",
  "visual studio code": "code",
  notepad: "notepad",
  explorer: "explorer",
  "file explorer": "explorer",
  terminal: "wt",
  "windows terminal": "wt",
  powershell: "powershell",
  cmd: "cmd",
  edge: "msedge",
  "microsoft edge": "msedge",
  word: "winword",
  excel: "excel",
  powerpoint: "powerpnt",
  paint: "mspaint",
  calculator: "calc",
  outlook: "outlook",
  teams: "ms-teams",
  spotify: "spotify",
  discord: "discord",
  slack: "slack",
  steam: "steam",
  "epic games": "EpicGamesLauncher",
};

export function launchApplication(appName: string): string {
  const resolved = knownApps[appName.toLowerCase()] || appName;
  try {
    const cmd = `Start-Process "${resolved}"`;
    execSync(cmd, { encoding: "utf-8", timeout: 10000, shell: "powershell.exe" });
    return `Launched "${appName}".`;
  } catch (err) {
    return `Failed to launch "${appName}": ${err instanceof Error ? err.message : String(err)}`;
  }
}