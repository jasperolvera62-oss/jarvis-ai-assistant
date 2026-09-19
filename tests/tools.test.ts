import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/tools/index.js";
import { MemoryStore } from "../src/memory/store.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeMemory() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-tools-"));
  return { memory: new MemoryStore(dir), dir };
}

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const { memory, dir } = makeMemory();
    try {
      const registry = new ToolRegistry();
      registry.registerMany([
        {
          name: "time",
          description: "Get time",
          category: "system",
          inputSchema: z.object({}),
          riskLevel: 0,
          requiresConfirmation: false,
          timeout: 1000,
          cancellable: false,
          execute: async () => ({ success: true, result: { time: Date.now() } }),
        },
      ]);
      expect(registry.has("time")).toBe(true);
      expect(registry.get("time")?.riskLevel).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "dup",
      description: "a",
      category: "x",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 1000,
      cancellable: false,
      execute: async () => ({ success: true }),
    });
    expect(() =>
      registry.register({
        name: "dup",
        description: "b",
        category: "x",
        inputSchema: z.object({}),
        riskLevel: 0,
        requiresConfirmation: false,
        timeout: 1000,
        cancellable: false,
        execute: async () => ({ success: true }),
      })
    ).toThrow(/already registered/);
  });

  it("executes with valid input", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "add",
      description: "add numbers",
      category: "math",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 1000,
      cancellable: false,
      execute: async (input) => ({ success: true, result: { sum: (input.a as number) + (input.b as number) } }),
    });
    const result = await registry.execute("add", { a: 2, b: 3 }, { sessionId: "s" });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ sum: 5 });
  });

  it("rejects invalid input", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "add",
      description: "add numbers",
      category: "math",
      inputSchema: z.object({ a: z.number() }),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 1000,
      cancellable: false,
      execute: async () => ({ success: true }),
    });
    const result = await registry.execute("add", { a: "not-a-number" }, { sessionId: "s" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid input");
  });

  it("returns unknown tool error", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nope", {}, { sessionId: "s" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  it("enforces timeouts", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "slow",
      description: "slow tool",
      category: "x",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 100,
      cancellable: false,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return { success: true };
      },
    });
    const result = await registry.execute("slow", {}, { sessionId: "s" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("returns tool failure as structured error", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "explode",
      description: "throws",
      category: "x",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 1000,
      cancellable: false,
      execute: async () => {
        throw new Error("boom");
      },
    });
    const result = await registry.execute("explode", {}, { sessionId: "s" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("boom");
  });

  it("waits for and resolves confirmation", async () => {
    const registry = new ToolRegistry();
    const promise = registry.waitForToolConfirmation("call-1");
    registry.confirmToolCall("call-1", true);
    await expect(promise).resolves.toBe(true);
  });
});