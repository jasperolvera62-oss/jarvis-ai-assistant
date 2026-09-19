import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

export const visionTools: ToolDefinition[] = [
  {
    name: "take_screenshot",
    description: "Take a screenshot of the screen. Returns base64 image data.",
    category: "vision",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 15000,
    cancellable: false,
    execute: async () => {
      try {
        const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $file = [System.IO.Path]::GetTempFileName() + '.png'; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $bytes = [System.IO.File]::ReadAllBytes($file); [Convert]::ToBase64String($bytes); Remove-Item $file }"`;
        const base64 = execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim();
        return { success: true, result: { image: base64, mimeType: "image/png", captured: true } };
      } catch (err) {
        return { success: false, error: `Failed to take screenshot: ${err}` };
      }
    },
  },
];