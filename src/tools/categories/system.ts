import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

export const systemTools: ToolDefinition[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time",
    category: "system",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 5000,
    cancellable: false,
    execute: async () => {
      const now = new Date();
      return {
        success: true,
        result: {
          datetime: now.toISOString(),
          date: now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
          time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      };
    },
  },
  {
    name: "get_system_info",
    description: "Get system information including OS, CPU, memory, and uptime",
    category: "system",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async () => {
      const os = await import("os");
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      return {
        success: true,
        result: {
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          release: os.release(),
          cpuModel: cpus[0]?.model || "unknown",
          cpuCores: cpus.length,
          totalMemory: `${(totalMem / 1073741824).toFixed(2)} GB`,
          freeMemory: `${(freeMem / 1073741824).toFixed(2)} GB`,
          usedMemory: `${((totalMem - freeMem) / 1073741824).toFixed(2)} GB`,
          memoryUsagePercent: `${(((totalMem - freeMem) / totalMem) * 100).toFixed(1)}%`,
          uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        },
      };
    },
  },
  {
    name: "get_cpu_usage",
    description: "Get current CPU usage percentage",
    category: "system",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async () => {
      const os = await import("os");
      const cpus = os.cpus();
      const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
      const totalTick = cpus.reduce((acc, cpu) => {
        return acc + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
      }, 0);
      const idlePercent = (totalIdle / totalTick) * 100;
      return {
        success: true,
        result: {
          usagePercent: (100 - idlePercent).toFixed(1),
          cores: cpus.length,
        },
      };
    },
  },
  {
    name: "get_battery_status",
    description: "Get battery status if available (laptop)",
    category: "system",
    inputSchema: z.object({}),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 5000,
    cancellable: false,
    execute: async () => {
      try {
        if (process.platform === "win32") {
          const output = execSync("WMIC Path Win32_Battery Get EstimatedChargeRemaining,BatteryStatus /Format:List", {
            encoding: "utf-8",
            timeout: 5000,
          });
          const chargeMatch = output.match(/EstimatedChargeRemaining=(\d+)/);
          const statusMatch = output.match(/BatteryStatus=(\d+)/);
          if (chargeMatch) {
            const charge = parseInt(chargeMatch[1]);
            const charging = statusMatch && parseInt(statusMatch[1]) === 2;
            return {
              success: true,
              result: { percentage: charge, charging, status: charging ? "charging" : "discharging" },
            };
          }
        }
        return { success: true, result: { available: false, message: "Battery information not available" } };
      } catch {
        return { success: true, result: { available: false, message: "Battery information not available" } };
      }
    },
  },
  {
    name: "list_running_processes",
    description: "List currently running processes",
    category: "system",
    inputSchema: z.object({
      filter: z.string().optional().describe("Filter processes by name"),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      try {
        const filter = (input.filter as string) || "";
        let cmd = "Get-Process | Select-Object Name,CPU,WorkingSet64 | Sort-Object CPU -Descending | Select-Object -First 30";
        if (filter) {
          cmd = `Get-Process -Name "*${filter}*" -ErrorAction SilentlyContinue | Select-Object Name,CPU,WorkingSet64 | Sort-Object CPU -Descending`;
        }
        const output = execSync(cmd, { encoding: "utf-8", timeout: 10000, shell: "powershell.exe" });
        const lines = output.trim().split("\n").filter((l) => l.trim());
        const processes = lines.slice(1).map((line) => {
          const parts = line.trim().split(/\s+/);
          return { name: parts[0], cpu: parts[1], memory: parts[2] };
        });
        return { success: true, result: { count: processes.length, processes } };
      } catch (err) {
        return { success: false, error: `Failed to list processes: ${err}` };
      }
    },
  },
];
