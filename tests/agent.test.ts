import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import { MemoryStore } from "../src/memory/store.js";
import { ToolRegistry } from "../src/tools/index.js";
import { AgentOrchestrator } from "../src/agent/orchestrator.js";
import type { LLMChatMessage, LLMToolSpec, LLMStreamEvent } from "../src/agent/llm.js";

class FakeLLM {
  private calls = 0;
  private script: Array<(messages: LLMChatMessage[]) => Array<LLMStreamEvent> | AsyncIterable<LLMStreamEvent>>;
  get configured() {
    return true;
  }

  constructor(script: Array<(messages: LLMChatMessage[]) => Array<LLMStreamEvent> | AsyncIterable<LLMStreamEvent>>) {
    this.script = script;
  }

  async *chatStream(
    messages: LLMChatMessage[],
    tools: LLMToolSpec[],
    abortSignal?: AbortSignal
  ): AsyncIterable<LLMStreamEvent> {
    void tools;
    void abortSignal;
    const fn = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    const result = await Promise.resolve(fn(messages));
    if (Symbol.asyncIterator in result) {
      for await (const ev of result as AsyncIterable<LLMStreamEvent>) yield ev;
    } else {
      for (const ev of result as Array<LLMStreamEvent>) yield ev;
    }
  }
}

function makeEnv() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-agent-"));
  const memory = new MemoryStore(dir);
  const registry = new ToolRegistry();
  registry.registerMany([
    {
      name: "get_time",
      description: "Get the current time",
      category: "system",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 1000,
      cancellable: false,
      execute: async () => ({
        success: true,
        result: { time: "12:00 PM" },
      }),
    },
    {
      name: "list_dir",
      description: "List directory contents",
      category: "files",
      inputSchema: z.object({ path: z.string() }),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 1000,
      cancellable: false,
      execute: async (input) => ({
        success: true,
        result: { contents: ["a.txt", "b.txt"], path: input.path },
      }),
    },
    {
      name: "dangerous_delete",
      description: "Delete a file permanently",
      category: "files",
      inputSchema: z.object({ path: z.string() }),
      riskLevel: 3,
      requiresConfirmation: true,
      timeout: 1000,
      cancellable: false,
      execute: async (input) => ({
        success: true,
        result: { deleted: input.path },
      }),
    },
    {
      name: "flaky_tool",
      description: "A tool that fails on first attempt then succeeds",
      category: "test",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 1000,
      cancellable: false,
      let: undefined as undefined,
      execute: async () => {
        const fakeLLM = (globalThis as unknown as { flakyAttempts: number }).flakyAttempts || 0;
        (globalThis as unknown as { flakyAttempts: number }).flakyAttempts = fakeLLM + 1;
        if (fakeLLM === 0) {
          return { success: false, error: "transient failure" };
        }
        return { success: true, result: { recovered: true } };
      },
    } as any,
  ]);
  return { dir, memory, registry };
}

describe("AgentOrchestrator", () => {
  let env: ReturnType<typeof makeEnv>;
  let orchestrator: AgentOrchestrator;
  const collected: string[] = [];

  beforeEach(() => {
    env = makeEnv();
    collected.length = 0;
  });

  afterEach(() => {
    orchestrator && orchestrator.cancelActive();
    rmSync(env.dir, { recursive: true, force: true });
  });

  it("produces a simple text response", async () => {
    const fake = new FakeLLM([
      async () => {
        return [
          { type: "delta", content: "Hello" },
          { type: "delta", content: ", sir." },
          { type: "message_complete" },
        ];
      },
    ]);
    orchestrator = new AgentOrchestrator(env.registry, env.memory, fake as any);
    const response = await orchestrator.handleUserInput("Greetings.");
    expect(response).toBe("Hello, sir.");
  });

  it("executes a single tool call and responds", async () => {
    const fake = new FakeLLM([
      (messages) => {
        const last = messages[messages.length - 1];
        if (last.role === "tool") {
          return [
            { type: "delta", content: "It is 12:00 PM." },
            { type: "message_complete" },
          ];
        }
        return [
          {
            type: "tool_call_start",
            id: "call1",
            name: "get_time",
          },
          { type: "tool_call_delta", id: "call1", arguments: "{}" },
          { type: "message_complete" },
        ];
      },
    ]);
    orchestrator = new AgentOrchestrator(env.registry, env.memory, fake as any);

    const toolResults: string[] = [];
    orchestrator.on("toolResult", (r) => toolResults.push(r.name));

    const response = await orchestrator.handleUserInput("What time is it?");
    expect(toolResults).toContain("get_time");
    expect(response).toContain("12:00 PM");
  });

  it("runs a multi-step task with two dependent tool calls", async () => {
    const fake = new FakeLLM([
      () => [
        { type: "tool_call_start", id: "call1", name: "get_time" },
        { type: "tool_call_delta", id: "call1", arguments: "{}" },
        { type: "message_complete" },
      ],
      (messages) => {
        const last = messages[messages.length - 1];
        if (last.role === "tool" && JSON.parse(last.content).result?.time === "12:00 PM") {
          return [
            { type: "tool_call_start", id: "call2", name: "list_dir" },
            { type: "tool_call_delta", id: "call2", arguments: JSON.stringify({ path: "/tmp" }) },
            { type: "message_complete" },
          ];
        }
        if (last.role === "tool" && JSON.parse(last.content).result?.contents) {
          return [
            { type: "delta", content: "Finished the task." },
            { type: "message_complete" },
          ];
        }
        return [
          { type: "tool_call_start", id: "call2", name: "list_dir" },
          { type: "tool_call_delta", id: "call2", arguments: JSON.stringify({ path: "/tmp" }) },
          { type: "message_complete" },
        ];
      },
    ]);
    orchestrator = new AgentOrchestrator(env.registry, env.memory, fake as any);

    const calls: string[] = [];
    orchestrator.on("toolCall", (c) => calls.push(c.name));

    const response = await orchestrator.handleUserInput("Do both things.");
    expect(calls).toEqual(["get_time", "list_dir"]);
    expect(response).toContain("Finished the task.");
  });

  it("requests authorization for dangerous tools and declines", async () => {
    const fake = new FakeLLM([
      (messages) => {
        const last = messages[messages.length - 1];
        if (last.role === "tool" && JSON.parse(last.content).success === false) {
          return [
            { type: "delta", content: "Understood. It has not been deleted." },
            { type: "message_complete" },
          ];
        }
        return [
          { type: "tool_call_start", id: "call-danger", name: "dangerous_delete" },
          { type: "tool_call_delta", id: "call-danger", arguments: JSON.stringify({ path: "C:/foo" }) },
          { type: "message_complete" },
        ];
      },
    ]);
    orchestrator = new AgentOrchestrator(env.registry, env.memory, fake as any);

    let confirmationRequested = false;
    orchestrator.on("confirmationRequest", (req) => {
      confirmationRequested = true;
      void orchestrator.resolveConfirmation(req.id, false);
    });

    const toolResults: Array<{ name: string; success: boolean }> = [];
    orchestrator.on("toolResult", (r) => toolResults.push({ name: r.name, success: r.success }));

    const response = await orchestrator.handleUserInput("Delete C:/foo");
    expect(confirmationRequested).toBe(true);
    expect(toolResults[0].success).toBe(false);
    expect(response.length).toBeGreaterThan(0);
  });

  it("recovers from a failing tool via retry", async () => {
    (globalThis as unknown as { flakyAttempts: number }).flakyAttempts = 0;

    const fake = new FakeLLM([
      (messages) => {
        const last = messages[messages.length - 1];
        if (last.role === "tool") {
          return [
            { type: "delta", content: "Recovered and done." },
            { type: "message_complete" },
          ];
        }
        return [
          { type: "tool_call_start", id: "call-flaky", name: "flaky_tool" },
          { type: "tool_call_delta", id: "call-flaky", arguments: "{}" },
          { type: "message_complete" },
        ];
      },
    ]);
    orchestrator = new AgentOrchestrator(env.registry, env.memory, fake as any);

    const toolResults: Array<{ name: string; success: boolean }> = [];
    orchestrator.on("toolResult", (r) => toolResults.push({ name: r.name, success: r.success }));

    const response = await orchestrator.handleUserInput("Run the flaky tool");
    expect(toolResults[0].success).toBe(true);
    expect(toolResults[0].name).toBe("flaky_tool");
    expect(response).toContain("Recovered and done.");
  });

  it("cancels an in-progress task", async () => {
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((r) => (resolveGate = r));

    orchestrator = new AgentOrchestrator(
      env.registry,
      env.memory,
      {
        get configured() {
          return true;
        },
        chatStream: async function* (): AsyncIterable<LLMStreamEvent> {
          yield { type: "delta", content: "Starting..." };
          await gate;
          yield { type: "delta", content: "never completes" };
          yield { type: "message_complete" };
        },
      } as any
    );

    const promise = orchestrator.handleUserInput("This should be cancellable");
    setTimeout(() => {
      orchestrator.cancelActive();
      resolveGate();
    }, 20);

    await expect(promise).rejects.toThrow();
  });
});