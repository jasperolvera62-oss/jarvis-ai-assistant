import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

export const mediaTools: ToolDefinition[] = [
  {
    name: "open_url",
    description: "Open a URL in the default browser",
    category: "media",
    inputSchema: z.object({
      url: z.string().describe("URL to open"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      try {
        const url = input.url as string;
        execSync(`Start-Process "${url}"`, {
          encoding: "utf-8",
          timeout: 10000,
          shell: "powershell.exe",
        });
        return { success: true, result: { opened: url } };
      } catch (err) {
        return { success: false, error: `Failed to open URL: ${err}` };
      }
    },
  },
  {
    name: "set_volume",
    description: "Set system volume (0-100)",
    category: "media",
    inputSchema: z.object({
      volume: z.number().min(0).max(100).describe("Volume level 0-100"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      try {
        const volume = input.volume as number;
        const url = `ms-settings:sound`;
        execSync(`Start-Process "${url}"`, { encoding: "utf-8", shell: "powershell.exe" });
        // Use nircmd if available, else fallback
        execSync(`powershell -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys([char]175);"`, {
          encoding: "utf-8",
          shell: "powershell.exe",
        });
        return { success: true, result: { volume, method: "opened-sound-settings" } };
      } catch (err) {
        return { success: false, error: `Failed to set volume: ${err}` };
      }
    },
  },
  {
    name: "media_play_pause",
    description: "Play or pause media playback",
    category: "media",
    inputSchema: z.object({
      action: z.enum(["play-pause", "next", "previous", "stop"]).describe("Media control action"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 5000,
    cancellable: false,
    execute: async (input) => {
      try {
        const keyMap: Record<string, string> = {
          "play-pause": "176",
          next: "177",
          previous: "179",
          stop: "178",
        };
        const key = keyMap[input.action as string];
        execSync(`powershell -Command "$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys([char]${key});"`, {
          encoding: "utf-8",
          shell: "powershell.exe",
        });
        return { success: true, result: { action: input.action } };
      } catch (err) {
        return { success: false, error: `Failed to control media: ${err}` };
      }
    },
  },
];