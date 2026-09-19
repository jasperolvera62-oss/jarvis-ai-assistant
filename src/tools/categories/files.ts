import { z } from "zod";
import { execSync } from "child_process";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, unlinkSync, rmSync } from "fs";
import { join, dirname, basename, resolve } from "path";
import type { ToolDefinition } from "../registry.js";

function expandPath(p: string): string {
  if (p.startsWith("~")) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    return join(home, p.slice(1));
  }
  return resolve(p);
}

export const fileTools: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and directories at a given path",
    category: "files",
    inputSchema: z.object({
      path: z.string().describe("Directory path to list"),
      pattern: z.string().optional().describe("Glob pattern to filter files"),
      maxDepth: z.number().optional().default(1).describe("Directory depth"),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const dirPath = expandPath(input.path as string);
      if (!existsSync(dirPath)) {
        return { success: false, error: `Directory not found: ${dirPath}` };
      }
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        const items = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
          path: join(dirPath, e.name),
        }));
        return { success: true, result: { path: dirPath, items, count: items.length } };
      } catch (err) {
        return { success: false, error: `Failed to list directory: ${err}` };
      }
    },
  },
  {
    name: "search_files",
    description: "Search for files by name pattern recursively",
    category: "files",
    inputSchema: z.object({
      path: z.string().describe("Root directory to search in"),
      query: z.string().describe("Search term or pattern"),
      maxResults: z.number().optional().default(50),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 30000,
    cancellable: true,
    execute: async (input) => {
      const rootPath = expandPath(input.path as string);
      if (!existsSync(rootPath)) {
        return { success: false, error: `Path not found: ${rootPath}` };
      }
      try {
        const query = (input.query as string).toLowerCase();
        const maxResults = (input.maxResults as number) || 50;
        const results: Array<{ name: string; path: string; type: string }> = [];
        const search = (dir: string, depth: number) => {
          if (depth > 5 || results.length >= maxResults) return;
          try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (results.length >= maxResults) return;
              const fullPath = join(dir, entry.name);
              if (entry.name.toLowerCase().includes(query)) {
                results.push({
                  name: entry.name,
                  path: fullPath,
                  type: entry.isDirectory() ? "directory" : "file",
                });
              }
              if (entry.isDirectory()) {
                search(fullPath, depth + 1);
              }
            }
          } catch {}
        };
        search(rootPath, 0);
        return { success: true, result: { results, count: results.length } };
      } catch (err) {
        return { success: false, error: `Search failed: ${err}` };
      }
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file",
    category: "files",
    inputSchema: z.object({
      path: z.string().describe("File path to read"),
      encoding: z.string().optional().default("utf-8"),
      maxLines: z.number().optional().default(500),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const filePath = expandPath(input.path as string);
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      try {
        const stat = statSync(filePath);
        if (stat.size > 10 * 1024 * 1024) {
          return { success: false, error: "File too large (>10MB)" };
        }
        let content = readFileSync(filePath, { encoding: input.encoding as BufferEncoding });
        const lines = content.split("\n");
        const maxLines = (input.maxLines as number) || 500;
        const truncated = lines.length > maxLines;
        if (truncated) {
          content = lines.slice(0, maxLines).join("\n");
        }
        return {
          success: true,
          result: {
            path: filePath,
            content,
            totalLines: lines.length,
            truncated,
            size: stat.size,
          },
        };
      } catch (err) {
        return { success: false, error: `Failed to read file: ${err}` };
      }
    },
  },
  {
    name: "create_file",
    description: "Create a new file with given content",
    category: "files",
    inputSchema: z.object({
      path: z.string().describe("File path to create"),
      content: z.string().describe("File content"),
      overwrite: z.boolean().optional().default(false),
    }),
    riskLevel: 2,
    requiresConfirmation: true,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const filePath = expandPath(input.path as string);
      if (existsSync(filePath) && !input.overwrite) {
        return { success: false, error: `File already exists: ${filePath}. Use overwrite=true to replace.` };
      }
      try {
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(filePath, input.content as string, { encoding: "utf-8" });
        return { success: true, result: { path: filePath, created: true } };
      } catch (err) {
        return { success: false, error: `Failed to create file: ${err}` };
      }
    },
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing text content",
    category: "files",
    inputSchema: z.object({
      path: z.string().describe("File path to edit"),
      oldText: z.string().describe("Text to find and replace"),
      newText: z.string().describe("Replacement text"),
    }),
    riskLevel: 2,
    requiresConfirmation: true,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const filePath = expandPath(input.path as string);
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      try {
        let content = readFileSync(filePath, "utf-8");
        if (!content.includes(input.oldText as string)) {
          return { success: false, error: "Text to replace not found in file" };
        }
        content = content.replace(input.oldText as string, input.newText as string);
        writeFileSync(filePath, content, "utf-8");
        return { success: true, result: { path: filePath, edited: true } };
      } catch (err) {
        return { success: false, error: `Failed to edit file: ${err}` };
      }
    },
  },
  {
    name: "delete_file",
    description: "Delete a file or directory",
    category: "files",
    inputSchema: z.object({
      path: z.string().describe("Path to delete"),
      recursive: z.boolean().optional().default(false),
    }),
    riskLevel: 3,
    requiresConfirmation: true,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const targetPath = expandPath(input.path as string);
      if (!existsSync(targetPath)) {
        return { success: false, error: `Path not found: ${targetPath}` };
      }
      try {
        const stat = statSync(targetPath);
        if (stat.isDirectory()) {
          rmSync(targetPath, { recursive: input.recursive as boolean, force: true });
        } else {
          unlinkSync(targetPath);
        }
        return { success: true, result: { path: targetPath, deleted: true } };
      } catch (err) {
        return { success: false, error: `Failed to delete: ${err}` };
      }
    },
  },
  {
    name: "move_file",
    description: "Move or rename a file or directory",
    category: "files",
    inputSchema: z.object({
      source: z.string().describe("Source path"),
      destination: z.string().describe("Destination path"),
    }),
    riskLevel: 2,
    requiresConfirmation: true,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const src = expandPath(input.source as string);
      const dest = expandPath(input.destination as string);
      if (!existsSync(src)) {
        return { success: false, error: `Source not found: ${src}` };
      }
      try {
        const destDir = dirname(dest);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        renameSync(src, dest);
        return { success: true, result: { from: src, to: dest, moved: true } };
      } catch (err) {
        return { success: false, error: `Failed to move: ${err}` };
      }
    },
  },
  {
    name: "copy_file",
    description: "Copy a file to a new location",
    category: "files",
    inputSchema: z.object({
      source: z.string().describe("Source file path"),
      destination: z.string().describe("Destination path"),
    }),
    riskLevel: 1,
    requiresConfirmation: false,
    timeout: 10000,
    cancellable: false,
    execute: async (input) => {
      const src = expandPath(input.source as string);
      const dest = expandPath(input.destination as string);
      if (!existsSync(src)) {
        return { success: false, error: `Source not found: ${src}` };
      }
      try {
        const destDir = dirname(dest);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        copyFileSync(src, dest);
        return { success: true, result: { from: src, to: dest, copied: true } };
      } catch (err) {
        return { success: false, error: `Failed to copy: ${err}` };
      }
    },
  },
];
