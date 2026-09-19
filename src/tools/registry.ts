import { z } from "zod";
import type { RiskLevel } from "../shared/types.js";

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  inputSchema: z.ZodType;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  timeout: number;
  cancellable: boolean;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResponse>;
}

export interface ToolContext {
  sessionId: string;
  abortSignal?: AbortSignal;
}

export interface ToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface PendingConfirmation {
  resolver: (confirmed: boolean) => void;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: string): ToolDefinition[] {
    return this.getAll().filter((t) => t.category === category);
  }

  getDefinitions(): Array<{
    name: string;
    description: string;
    parameters: z.ZodType;
    riskLevel: RiskLevel;
    requiresConfirmation: boolean;
  }> {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      riskLevel: t.riskLevel,
      requiresConfirmation: t.requiresConfirmation,
    }));
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResponse> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    const validated = tool.inputSchema.safeParse(input);
    if (!validated.success) {
      return {
        success: false,
        error: `Invalid input: ${validated.error.issues.map((i) => i.message).join(", ")}`,
      };
    }

    const start = performance.now();
    try {
      let timeoutId: NodeJS.Timeout | undefined;
      let timedOut = false;

      const timeoutPromise = tool.timeout > 0
        ? new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              timedOut = true;
              reject(new Error(`Tool "${name}" timed out after ${tool.timeout}ms`));
            }, tool.timeout);
          })
        : undefined;

      const execution = tool.execute(validated.data as Record<string, unknown>, context);

      const result = timeoutPromise
        ? await Promise.race([execution, timeoutPromise])
        : await execution;
      if (timeoutId) clearTimeout(timeoutId);

      const duration = performance.now() - start;
      return { ...result, metadata: { ...result.metadata, duration, timedOut } };
    } catch (err) {
      const duration = performance.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        metadata: { duration },
      };
    }
  }

  waitForToolConfirmation(toolCallId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingConfirmations.set(toolCallId, { resolver: resolve });
    });
  }

  confirmToolCall(toolCallId: string, confirmed: boolean): void {
    const pending = this.pendingConfirmations.get(toolCallId);
    if (pending) {
      this.pendingConfirmations.delete(toolCallId);
      pending.resolver(confirmed);
    }
  }

  rejectAllPendingConfirmations(): void {
    for (const [id, pending] of this.pendingConfirmations) {
      this.pendingConfirmations.delete(id);
      pending.resolver(false);
    }
  }
}