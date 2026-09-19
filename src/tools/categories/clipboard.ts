import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

export const clipboardTools: ToolDefinition[] = [
  {
    name: "read_clipboard",
    description: "Read the current clipboard contents",
    category: "clipboard",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 5000,
    cancellable: false,
    execute: async () => {
      try {
        const output = execSync("Get-Clipboard", {
          encoding: "utf-8",
          timeout: 5000,
          shell: "powershell.exe",
        });
        return { success: true, result: { content: output.trim() } };
      } catch {
        return { success: true, result: { content: "", message: "Clipboard is empty or contains non-text data" } };
      }
    },
  },
  {
    name: "write_clipboard",
    description: "Write text to the clipboard",
    category: "clipboard",
    inputSchema: z.object({
      content: z.string().describe("Text to copy to clipboard"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 5000,
    cancellable: false,
    execute: async (input) => {
      try {
        const content = (input.content as string).replace(/"/g, '""');
        execSync(`Set-Clipboard -Value "${content}"`, {
          encoding: "utf-8",
          timeout: 5000,
          shell: "powershell.exe",
        });
        return { success: true, result: { copied: true, length: (input.content as string).length } };
      } catch (err) {
        return { success: false, error: `Failed to write to clipboard: ${err}` };
      }
    },
  },
];
