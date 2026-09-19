import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

export const applicationTools: ToolDefinition[] = [
  {
    name: "launch_application",
    description: "Launch an application by name or path",
    category: "applications",
    inputSchema: z.object({
      name: z.string().describe("Application name or full path"),
      args: z.array(z.string()).optional().describe("Arguments to pass"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 15000,
    cancellable: false,
    execute: async (input) => {
      const appName = input.name as string;
      const args = (input.args as string[]) || [];
      try {
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
        const resolved = knownApps[appName.toLowerCase()] || appName;
        const cmd = args.length > 0
          ? `Start-Process "${resolved}" -ArgumentList '${args.join(",")}'`
          : `Start-Process "${resolved}"`;
        execSync(cmd, { encoding: "utf-8", timeout: 10000, shell: "powershell.exe" });
        return { success: true, result: { launched: appName, resolved } };
      } catch (err) {
        return { success: false, error: `Failed to launch "${appName}": ${err}` };
      }
    },
  },
  {
    name: "close_application",
    description: "Close an application by process name. Pass a single property 'name' with the process name, e.g. {\"name\": \"chrome\"} or {\"process_name\": \"blender\"}.",
    category: "applications",
    inputSchema: z
      .object({
        name: z.string().optional().describe("Process name to close"),
        process_name: z.string().optional().describe("Alias for the process name"),
      })
      .passthrough()
      .superRefine((data, ctx) => {
        if (!data.name && !data.process_name) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "Process name is required" });
        }
      }),
    riskLevel: 2,
    requiresConfirmation: true,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const appName = String((input.name as string) || (input.process_name as string) || "").trim();
      if (!appName) {
        return { success: false, error: "No application name supplied." };
      }
      const force = input.force === true;
      try {
        const cmd = force
          ? `Stop-Process -Name "${appName}" -Force -ErrorAction Stop`
          : `Stop-Process -Name "${appName}" -ErrorAction Stop`;
        execSync(cmd, { encoding: "utf-8", timeout: 10000, shell: "powershell.exe" });
        return { success: true, result: { closed: appName, forced: force } };
      } catch (err) {
        return { success: false, error: `Failed to close "${appName}": ${err}` };
      }
    },
  },
  {
    name: "list_running_applications",
    description: "List all running applications with visible windows",
    category: "applications",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async () => {
      try {
        const cmd = `Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object Name, MainWindowTitle, Id | Sort-Object Name | ConvertTo-Json`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 10000, shell: "powershell.exe" });
        let apps = [];
        try {
          apps = JSON.parse(output.trim());
          if (!Array.isArray(apps)) apps = [apps];
        } catch {
          apps = [];
        }
        return {
          success: true,
          result: {
            applications: apps.map((a: any) => ({
              name: a.Name,
              title: a.MainWindowTitle,
              pid: a.Id,
            })),
            count: apps.length,
          },
        };
      } catch (err) {
        return { success: false, error: `Failed to list applications: ${err}` };
      }
    },
  },
];
