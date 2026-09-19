import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

const triggeredSessions = new Set<string>();

// The LLM is inconsistent about the argument name, so accept several aliases.
const emergencyInputSchema = z
  .object({
    details: z.string().optional(),
    summary: z.string().optional(),
    message: z.string().optional(),
    incident: z.string().optional(),
  })
  .transform((d) => ({
    details: (d.details || d.summary || d.message || d.incident || "").slice(0, 500),
  }));

// TextNow registers itself as a tel: handler on Windows when installed, so a
// plain tel:911 launch routes the call through it. We also open TextNow up front
// so the user can hit CALL in its dialer.
export const emergencyTools: ToolDefinition[] = [
  {
    name: "trigger_emergency",
    description:
      "EMERGENCY RESPONSE. Use ONLY when the user is in a genuine life-threatening emergency needing emergency services (medical, fire, crime in progress, imminent danger). Opens the 911 dialer (via the TextNow app if installed), raises the red DISTRESS overlay on every connected HUD, and plays the alarm. Call it EXACTLY ONCE. Do not ask for confirmation, do not use for non-emergencies.",
    category: "emergency",
    inputSchema: emergencyInputSchema,
    riskLevel: 3,
    requiresConfirmation: false,
    timeout: 20000,
    cancellable: false,
    execute: async (input, context) => {
      const { details } = input as { details: string };
      if (triggeredSessions.has(context.sessionId)) {
        return {
          success: true,
          result: {
            action: "already_issued",
            message:
              "The 911 dialer (TextNow) and distress overlay were already triggered earlier. Do not call this tool again — give the user the final statement now.",
          },
        };
      }
      triggeredSessions.add(context.sessionId);

      const textNowOpened = await openTextNow();
      const dialerOpened = await launchTel911();

      return {
        success: true,
        result: {
          action: "emergency_signal_issued",
          textNowOpened,
          dialerOpened,
          handledVia: tellUserHow(textNowOpened, dialerOpened),
          details,
        },
      };
    },
  },
  {
    name: "emergency_status",
    description: "Check whether the emergency distress protocol is active in this session.",
    category: "emergency",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 5000,
    cancellable: false,
    execute: async () => ({
      success: true,
      result: { protocol: "ready", dialer: "TextNow (" + (process.platform === "win32" ? "windows" : "n/a") + ")" },
    }),
  },
];

function commandSucceeds(cmd: string, timeoutMs = 10000): boolean {
  try {
    execSync(cmd, { encoding: "utf-8", timeout: timeoutMs, shell: "powershell.exe" });
    return true;
  } catch {
    return false;
  }
}

async function openTextNow(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  // Open TextNow app directly (Start-Process resolves the AppX/exe by name if on PATH or Start Menu).
  // then hand off dialing to the tel: handler, which TextNow takes over when installed.
  const opened = commandSucceeds(`Start-Process "TextNow"`, 5000);
  if (opened) return true;
  // Fallback: known desktop install locations.
  const candidates = [
    "$env:LOCALAPPDATA\\Programs\\TextNow\\TextNow.exe",
    "$env:LOCALAPPDATA\\TextNow\\TextNow.exe",
    '"$env:ProgramFiles\\TextNow\\TextNow.exe"',
    '"${env:ProgramFiles(x86)}\\TextNow\\TextNow.exe"',
  ];
  for (const c of candidates) {
    if (commandSucceeds(`if (Test-Path -LiteralPath ${c}) { Start-Process -LiteralPath ${c} }`, 5000)) return true;
  }
  return false;
}

async function launchTel911(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  return commandSucceeds(`Start-Process "tel:911"`, 5000);
}

function tellUserHow(textNowOpened: boolean, dialerOpened: boolean): string {
  if (textNowOpened) {
    return "TextNow open on host OS, 911 dialer invoked — user presses CALL in TextNow";
  }
  if (dialerOpened) {
    return "911 dialer opened via text: handler on host OS — user presses CALL";
  }
  return "HUD distress panel live — user can tap CALL 911 NOW";
}