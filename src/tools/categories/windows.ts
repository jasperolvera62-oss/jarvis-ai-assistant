import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

export const windowTools: ToolDefinition[] = [
  {
    name: "list_windows",
    description: "List all visible application windows",
    category: "windows",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async () => {
      try {
        const cmd = `
$AddCS = @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WinList {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static List<string> GetWindows() {
    var result = new List<string>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var sb = new System.Text.StringBuilder(256);
      GetWindowText(hWnd, sb, 256);
      if (sb.Length > 0) {
        RECT rect;
        GetWindowRect(hWnd, out rect);
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        result.Add(pid + "|" + sb.ToString() + "|" + rect.Left + "," + rect.Top);
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
Add-Type $AddCS
[WinList]::GetWindows() | ConvertTo-Json
`;
        const output = execSync(cmd, { encoding: "utf-8", timeout: 10000, shell: "powershell.exe" });
        let lines = output.trim().split("\n").filter((l) => l.trim());
        const windows = lines.map((line) => {
          const parts = line.split("|");
          return { pid: parts[0], title: parts[1], position: parts[2] || "" };
        });
        return { success: true, result: { windows, count: windows.length } };
      } catch (err) {
        return { success: false, error: `Failed to list windows: ${err}` };
      }
    },
  },
];