import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import { MemoryStore } from "../src/memory/store.js";
import { ToolRegistry, createAllTools } from "../src/tools/index.js";
import { TurnManager } from "../src/agent/turnManager.js";
import { AgentOrchestrator } from "../src/agent/orchestrator.js";
import type { LLMChatMessage, LLMToolSpec, LLMStreamEvent } from "../src/agent/llm.js";

function makeFakeLLM() {
  return {
    get configured() {
      return true;
    },
    chatStream: async function* (messages: LLMChatMessage[]): AsyncIterable<LLMStreamEvent> {
      const last = messages[messages.length - 1];
      const text = last.role === "user" ? last.content : "Acknowledged.";
      const words = text.split(" ");
      for (const w of words) {
        yield { type: "delta", content: w + " " };
      }
      yield { type: "delta", content: "[echo]" };
      yield { type: "message_complete" };
    },
  };
}

describe("TurnManager", () => {
  let dir: string;
  let memory: MemoryStore;
  let registry: ToolRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jarvis-turn-"));
    memory = new MemoryStore(dir);
    registry = new ToolRegistry();
    registry.registerMany(createAllTools(memory));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("routes text through the same agent pipeline in order", async () => {
    const orch = new AgentOrchestrator(registry, memory, makeFakeLLM() as any);
    const agent = new TurnManager(orch);

    const t1 = await agent.processTurn("first message");
    const t2 = await agent.processTurn("second message");

    expect(t1.response).toContain("first message");
    expect(t2.response).toContain("second message");
    expect(t1.turnId === t2.turnId).toBe(false);
    expect(t1.durationMs).toBeGreaterThan(0);
  });

  it("builds conversation context across turns via working memory", async () => {
    const memDir = mkdtempSync(join(tmpdir(), "jarvis-turn2-"));
    try {
      const mem2 = new MemoryStore(memDir);
      const orch = new AgentOrchestrator(registry, mem2, makeFakeLLM() as any);
      const agent = new TurnManager(orch);

      await agent.processTurn("hello there");
      const working = mem2.getWorkingMemory();

      // user + assistant messages from each turn must be present
      expect(working.filter((m) => m.role === "user").length).toBeGreaterThan(0);
      expect(working.filter((m) => m.role === "assistant").length).toBeGreaterThan(0);
    } finally {
      rmSync(memDir, { recursive: true, force: true });
    }
  });
});