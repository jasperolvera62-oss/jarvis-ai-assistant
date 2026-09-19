import { z } from "zod";
import { execSync } from "child_process";
import type { ToolDefinition } from "../registry.js";

function runCommand(cmd: string, timeout: number, cwd?: string) {
  return execSync(cmd, {
    encoding: "utf-8",
    timeout,
    cwd,
    env: { ...process.env },
  });
}

export const developerTools: ToolDefinition[] = [
  {
    name: "run_command",
    description: "Run an approved shell command",
    category: "developer",
    inputSchema: z.object({
      command: z.string().describe("Shell command to run"),
      workingDirectory: z.string().optional().describe("Working directory"),
      timeout: z.number().optional().default(30000).describe("Timeout in ms"),
    }),
    riskLevel: 3,
    requiresConfirmation: true,
    timeout: 120000,
    cancellable: true,
    execute: async (input) => {
      try {
        const cmd = input.command as string;
        const timeout = (input.timeout as number) || 30000;
        const cwd = input.workingDirectory as string | undefined;
        const output = runCommand(cmd, timeout, cwd);
        return {
          success: true,
          result: {
            command: cmd,
            output,
            exitCode: 0,
            truncated: output.length > 8000,
          },
        };
      } catch (err: any) {
        if (err && err.status !== undefined) {
          return {
            success: true,
            result: {
              exitCode: err.status,
              output: err.stdout || "",
              error: err.stderr || "",
            },
          };
        }
        return { success: false, error: `Command failed: ${err.message || err}` };
      }
    },
  },
  {
    name: "git_status",
    description: "Get git status of a repository",
    category: "developer",
    inputSchema: z.object({
      path: z.string().describe("Repository path"),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      try {
        const output = runCommand("git status --short --branch", 10000, input.path as string);
        return { success: true, result: { status: output.trim() } };
      } catch (err) {
        return { success: false, error: `Git status failed: ${err}` };
      }
    },
  },
  {
    name: "git_diff",
    description: "Get git diff of a repository",
    category: "developer",
    inputSchema: z.object({
      path: z.string().describe("Repository path"),
      staged: z.boolean().optional().default(false),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      try {
        const flag = input.staged ? " --staged" : "";
        const output = runCommand(`git diff${flag}`, 10000, input.path as string);
        return { success: true, result: { diff: output.trim() } };
      } catch (err) {
        return { success: false, error: `Git diff failed: ${err}` };
      }
    },
  },
  {
    name: "run_tests",
    description: "Run project tests",
    category: "developer",
    inputSchema: z.object({
      path: z.string().describe("Project path"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 120000,
    cancellable: true,
    execute: async (input) => {
      try {
        const output = runCommand("npm test", 120000, input.path as string);
        return { success: true, result: { output: output.trim() } };
      } catch (err: any) {
        return {
          success: err?.status === 0,
          result: { output: err?.stdout || "", error: err?.stderr || "" },
          error: err?.status !== 0 ? `Tests returned exit code ${err?.status}` : undefined,
        };
      }
    },
  },
  {
    name: "run_build",
    description: "Run project build",
    category: "developer",
    inputSchema: z.object({
      path: z.string().describe("Project path"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 120000,
    cancellable: true,
    execute: async (input) => {
      try {
        const output = runCommand("npm run build", 120000, input.path as string);
        return { success: true, result: { output: output.trim() } };
      } catch (err: any) {
        return {
          success: err?.status === 0,
          result: { output: err?.stdout || "", error: err?.stderr || "" },
          error: err?.status !== 0 ? `Build returned exit code ${err?.status}` : undefined,
        };
      }
    },
  },
];