import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/index.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodType } from "zod";
import { getConfig } from "../shared/config.js";

export type LLMChatMessage = ChatCompletionMessageParam;

export type LLMToolSpec = ChatCompletionTool;

export type LLMStreamEvent =
  | { type: "delta"; content: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; arguments: string }
  | { type: "tool_call_complete"; id: string; name: string; arguments: string }
  | { type: "message_complete" }
  | { type: "error"; message: string; cancelled?: boolean };

export class LLMClient {
  private client: OpenAI | null = null;

  constructor() {
    const config = getConfig();
    if (config.llm.apiKey) {
      this.client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl,
        maxRetries: 0,
        timeout: 60000,
      });
    }
  }

  get configured(): boolean {
    return getConfig().llm.apiKey.length > 0;
  }

  async chatStream(
    messages: LLMChatMessage[],
    tools: LLMToolSpec[],
    abortSignal?: AbortSignal
  ): Promise<AsyncIterable<LLMStreamEvent>> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    const config = getConfig();

    const request = () =>
      this.client!.chat.completions.create(
        {
          model: config.llm.model,
          messages,
          tools,
          temperature: config.llm.temperature,
          max_tokens: config.llm.maxTokens,
          stream: true,
        },
        { signal: abortSignal }
      );

    const maxAttempts = 4;
    let attempt = 0;

    const createWithGuard = () => {
      const createPromise = request();
      const guardMs = 30000;
      const guard = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`LLM did not respond within ${guardMs / 1000}s (likely rate limited or provider stall).`));
        }, guardMs);
        abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("Request aborted"));
          },
          { once: true }
        );
      });
      return Promise.race([createPromise, guard]);
    };

    for (;;) {
      attempt += 1;
      try {
        return this.parseStream(await createWithGuard());
      } catch (err: any) {
        const status = err?.status as number | undefined;
        const message = err?.message || "";
        const isRateLimited =
          status === 429 ||
          /rate limit|rate_limit|not enough tokens|quota exceeded|try again in/i.test(message);

        if (isRateLimited && attempt < maxAttempts) {
          const retryAfter = parseRetryAfterMs(err);
          const delay =
            retryAfter !== null
              ? retryAfter
              : Math.min(2000 * 2 ** (attempt - 1), 15000);
          await abortAwareSleep(delay, abortSignal);
          continue;
        }
        throw err;
      }
    }
  }

  private async *parseStream(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  ): AsyncIterable<LLMStreamEvent> {
    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta?.content) {
          yield { type: "delta", content: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id && tc.function?.name) {
              yield { type: "tool_call_start", id: tc.id, name: tc.function.name };
            }
            if (tc.function?.arguments) {
              yield { type: "tool_call_delta", id: tc.id || "", arguments: tc.function.arguments };
            }
          }
        }
      }
      yield { type: "message_complete" };
    } catch (err: any) {
      const isCancelled =
        err?.name === "AbortError" ||
        err?.name === "TimeoutError" ||
        /abort|cancel/i.test(err?.message || "");
      yield { type: "error", message: err?.message || "LLM stream failed", cancelled: isCancelled };
    }
  }
}

function parseRetryAfterMs(err: any): number | null {
  try {
    const raw = err?.headers?.get?.("retry-after") ?? err?.headers?.["retry-after"];
    if (typeof raw === "string" || typeof raw === "number") {
      const seconds = Math.max(0, Math.ceil(Number(raw)));
      if (Number.isFinite(seconds)) return seconds * 1000;
    }
  } catch {
    // fall through
  }
  return null;
}

function abortAwareSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function buildToolSpecs(
  defs: Array<{
    name: string;
    description: string;
    parameters: ZodType;
  }>
): LLMToolSpec[] {
  return defs.map((d) => ({
    type: "function" as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: makeLenientSchema(zodToJsonSchema(d.parameters as ZodType, {
        name: d.name,
        target: "openAi",
      })),
    },
  }));
}

/**
 * Some providers (e.g. Groq) enforce tool-call arguments against the advertised
 * JSON schema and reject the entire request if a parameter is missing or extra.
 * To keep the conversation resilient we relax the schema the model sees:
 * unknown keys are tolerated and no property is forcibly required. The strict
 * zod validation still guards execution in the tool registry, and a failed
 * validation there is fed back as a tool result the model can recover from —
 * instead of killing the whole turn.
 */
function makeLenientSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: Record<string, unknown>): void => {
    for (const key of Object.keys(node)) {
      if (key === "additionalProperties") {
        delete node[key];
      } else if (key === "required") {
        delete node[key];
      } else if (node[key] && typeof node[key] === "object") {
        walk(node[key] as Record<string, unknown>);
      }
    }
  };
  walk(schema);
  return schema;
}