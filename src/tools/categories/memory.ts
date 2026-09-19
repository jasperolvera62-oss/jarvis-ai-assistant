import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import type { MemoryStore } from "../../memory/store.js";

export function createMemoryTools(memory: MemoryStore): ToolDefinition[] {
  return [
    {
      name: "memory_remember",
      description: "Store a fact in persistent memory. Use for durable facts the user wants remembered.",
      category: "memory",
      inputSchema: z.object({
        fact: z.string().describe("The fact to remember"),
        key: z.string().describe("Short identifier for this memory (e.g. 'preferred_name')"),
        layer: z.enum(["user_profile", "project", "episodic"]).optional().default("user_profile"),
      }),
      riskLevel: 1,
      requiresConfirmation: false,
      timeout: 10000,
      cancellable: false,
      execute: async (input) => {
        const key = input.key as string;
        const value = input.fact as string;
        const layer = input.layer as "user_profile" | "project" | "episodic";
        await memory.set(layer, key, value);
        return { success: true, result: { stored: { key, layer } } };
      },
    },
    {
      name: "memory_search",
      description: "Search persistent memory for stored facts",
      category: "memory",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 5000,
      cancellable: false,
      execute: async (input) => {
        const results = await memory.search(input.query as string);
        return { success: true, result: { results, count: results.length } };
      },
    },
    {
      name: "memory_forget",
      description: "Delete a specific memory entry by ID or key",
      category: "memory",
      inputSchema: z.object({
        id: z.string().optional().describe("Entry ID to delete"),
        key: z.string().optional().describe("Entry key to delete"),
      }),
      riskLevel: 2,
      requiresConfirmation: true,
      timeout: 5000,
      cancellable: false,
      execute: async (input) => {
        if (input.id) {
          await memory.deleteById(input.id as string);
          return { success: true, result: { deleted: input.id } };
        }
        if (input.key) {
          const count = await memory.deleteByKey(input.key as string);
          return { success: true, result: { deletedCount: count, key: input.key } };
        }
        return { success: false, error: "Must provide either id or key" };
      },
    },
    {
      name: "memory_capacity",
      description: "Get current memory storage status and stats",
      category: "memory",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 5000,
      cancellable: false,
      execute: async () => {
        const stats = await memory.getStats();
        return { success: true, result: stats };
      },
    },
    {
      name: "memory_update",
      description: "Update an existing memory entry",
      category: "memory",
      inputSchema: z.object({
        id: z.string().describe("Entry ID to update"),
        fact: z.string().describe("New value"),
      }),
      riskLevel: 1,
      requiresConfirmation: false,
      timeout: 5000,
      cancellable: false,
      execute: async (input) => {
        const updated = await memory.updateById(input.id as string, input.fact as string);
        if (!updated) {
          return { success: false, error: `Memory entry not found: ${input.id}` };
        }
        return { success: true, result: { updated } };
      },
    },
    {
      name: "memory_clear_all",
      description: "Delete ALL persistent memory. This is irreversible.",
      category: "memory",
      inputSchema: z.object({}),
      riskLevel: 3,
      requiresConfirmation: true,
      timeout: 10000,
      cancellable: false,
      execute: async () => {
        await memory.clearAll();
        return { success: true, result: { clearedAll: true } };
      },
    },
    {
      name: "memory_list",
      description: "List all stored memory entries (ID, key, value, layer)",
      category: "memory",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 5000,
      cancellable: false,
      execute: async () => {
        const entries = await memory.getAll();
        return {
          success: true,
          result: {
            entries: entries.map((e) => ({ id: e.id, key: e.key, value: e.value, layer: e.layer, updatedAt: e.updatedAt })),
            count: entries.length,
          },
        };
      },
    },
  ];
}