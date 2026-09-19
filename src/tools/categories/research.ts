import { z } from "zod";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { ToolDefinition } from "../registry.js";
import { backgroundTaskManager } from "../../agent/background.js";
import { webSearch, fetchPageText } from "./web.js";
import { LLMClient } from "../../agent/llm.js";
import { getLogger } from "../../shared/logger.js";
import { isSeriousMode } from "../../shared/mode.js";
import type { MemoryStore } from "../../memory/store.js";

const logger = getLogger();

interface ResearchSession {
  taskId: string;
  topic: string;
  queries: string[];
  notes: string[];
  sources: string[];
  iteration: number;
  startedAt: number;
}

const QUERY_TEMPLATES = [
  (t: string) => t,
  (t: string) => `${t} overview and history`,
  (t: string) => `${t} current status and developments`,
  (t: string) => `${t} statistics and key data`,
  (t: string) => `${t} analysis and expert opinion`,
  (t: string) => `${t} recent news`,
  (t: string) => `${t} case studies and examples`,
  (t: string) => `what is ${t}`,
  (t: string) => `how does ${t} work`,
  (t: string) => `${t} pros and cons`,
  (t: string) => `${t} future outlook and trends`,
  (t: string) => `${t} related fields and subtopics`,
  (t: string) => `the most important facts about ${t}`,
  (t: string) => `${t} mechanisms and causes`,
  (t: string) => `${t} controversies and debate`,
  (t: string) => `${t} experts and key figures`,
  (t: string) => `${t} comparisons and alternatives`,
  (t: string) => `${t} practical implications`,
];

export class ResearchService {
  private sessions = new Map<string, ResearchSession>();
  private llm: LLMClient | null = null;

  constructor(private memory: MemoryStore) {}

  private getLLM(): LLMClient {
    if (!this.llm) this.llm = new LLMClient();
    return this.llm;
  }

  async start(topic: string): Promise<{ started: boolean; taskId?: string; error?: string }> {
    if (!this.memory) return { started: false, error: "Memory store unavailable" };

    const runId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const session: ResearchSession = {
      taskId: "",
      topic,
      queries: [],
      notes: [],
      sources: [],
      iteration: 0,
      startedAt: Date.now(),
    };
    this.sessions.set(runId, session);

    const task = await backgroundTaskManager.start(
      `Deep research: ${topic}`,
      async (updater, signal) => {
        while (!signal.aborted) {
          session.iteration += 1;
          const query = await this.generateQuery(topic, session);

          updater(
            Math.min(99, 3 + session.iteration * 4),
            `Iteration ${session.iteration} — "${query}"`
          );
          session.queries.push(query);

          try {
            const results = await webSearch(query, 6);
            let gained = 0;
            for (const result of results.slice(0, 3)) {
              if (signal.aborted) break;
              const url = result.url;
              if (session.sources.includes(url)) continue;
              try {
                const page = await fetchPageText(url, 2600);
                if (!page.text.trim()) continue;
                session.notes.push(
                  `### ${(page.title || result.title).replace(/[#*]+/g, "").trim()}\n` +
                    `- **Source:** ${page.finalUrl || url}\n` +
                    `- **Extract:** ${page.text.slice(0, 2000).replace(/\s+/g, " ").trim()}\n`
                );
                session.sources.push(url);
                gained += 1;
              } catch {
                // skip unreadable page
              }
            }
            if (gained === 0 && results.length > 0) {
              // Still want something on the record — keep the snippets.
              for (const result of results.slice(0, 2)) {
                const url = result.url;
                if (session.sources.includes(url)) continue;
                session.notes.push(
                  `### ${result.title}\n- **Source:** ${url}\n- **Snippet:** ${result.snippet}\n`
                );
                session.sources.push(url);
              }
            }
          } catch (err) {
            logger.warn("research", `Search failed for "${query}"`, err);
          }

          try {
            await this.memory.set("episodic", `research:${topic}`, session.notes.join("\n\n"));
          } catch {
            // persistence is best-effort
          }

          if (signal.aborted) {
          updater(100, "Research halted");
          throw new Error("Research task cancelled");
        }
        await sleep(1400);
        }

        return {
          topic,
          iterations: session.iteration,
          queries: session.queries.length,
          notes: session.notes.length,
          sources: session.sources.length,
          compiled: session.notes.join("\n\n"),
        };
      }
    );

    session.taskId = task.id;
    return { started: true, taskId: task.id };
  }

  private async generateQuery(topic: string, session: ResearchSession): Promise<string> {
    if (isSeriousMode() || session.iteration > 1) {
      try {
        const llm = this.getLLM();
        const summary = session.notes.slice(-4).join("\n").slice(0, 1200);
        const prompt =
          `You are conducting exhaustive research on: "${topic}".\n\n` +
          (summary
            ? `Already gathered:\n${summary}\n\n`
            : "Nothing gathered yet.\n\n") +
          `Propose exactly ONE new web search query that will uncover NEW, non-redundant information about this topic. ` +
          `Reply with only the query text, no quotes, no explanation.`;
        const events = await llm.chatStream(
          [
            { role: "system", content: "You are a research strategist." },
            { role: "user", content: prompt },
          ],
          []
        );
        let text = "";
        for await (const event of events) {
          if (event.type === "delta") text += event.content;
        }
        const cleaned = text.trim().replace(/^["']|["']$/g, "");
        if (cleaned.length >= 4 && cleaned.length <= 300) return cleaned;
      } catch {
        // fall through to template
      }
    }
    const idx = (session.iteration - 1) % QUERY_TEMPLATES.length;
    try {
      return QUERY_TEMPLATES[idx](topic);
    } catch {
      return topic;
    }
  }

  report(topic: string): { topic: string; notes: string[]; sources: string[]; iterations: number } | null {
    let best: ResearchSession | null = null;
    for (const session of this.sessions.values()) {
      if (
        session.topic.toLowerCase().includes(topic.toLowerCase()) ||
        topic.toLowerCase().includes(session.topic.toLowerCase())
      ) {
        if (!best || session.iteration > best.iteration) best = session;
      }
    }
    if (!best) return null;
    return {
      topic: best.topic,
      notes: best.notes,
      sources: best.sources,
      iterations: best.iteration,
    };
  }

  stopAll(): number {
    let stopped = 0;
    for (const session of this.sessions.values()) {
      if (backgroundTaskManager.cancel(session.taskId)) stopped += 1;
    }
    return stopped;
  }

  activeCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      const task = backgroundTaskManager.get(session.taskId);
      if (task && (task.status === "in_progress" || task.status === "pending")) count += 1;
    }
    return count;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createResearchTools(memory: MemoryStore): ToolDefinition[] {
  const service = new ResearchService(memory);

  return [
    {
      name: "deep_research",
      description:
        "Start a deep, continuous research task on a topic. It searches the web, reads sources, and accumulates findings over many rounds until the user asks to stop (or the STOP control is used). Only call this when the user is ASKING FOR NEW research (e.g. 'research X', 'investigate Y', 'deep dive into Z'). If the user instead asks to EXPORT, COMPILE, or PUT existing findings into a Google Doc, call export_to_google_docs instead — never start another deep_research for that.",
      category: "research",
      inputSchema: z.object({
        topic: z.string().describe("The research topic to investigate exhaustively"),
      }),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 15000,
      cancellable: true,
      execute: async (input) => {
        const topic = String(input.topic || "").trim();
        if (!topic) return { success: false, error: "No research topic supplied." };
        const result = await service.start(topic);
        if (!result.started) return { success: false, error: result.error || "Failed to start research" };
        return {
          success: true,
          result: {
            started: true,
            topic,
            taskId: result.taskId,
            note: "Deep research running. It will continue until you ask me to stop.",
          },
        };
      },
    },
    {
      name: "stop_research",
      description: "Stop all running deep research tasks. Use this when the user asks to halt research.",
      category: "research",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiresConfirmation: false,
      timeout: 10000,
      cancellable: false,
      execute: async () => {
        const stopped = service.stopAll();
        return { success: true, result: { stopped } };
      },
    },
    {
      name: "export_to_google_docs",
      description:
        "Compile the research findings ALREADY gathered (from a running or finished deep_research task) into a formatted document, open a new Google Doc, and put the content on the clipboard so the user pastes it (Ctrl+V). Use EXACTLY when the user asks to 'put the research into a Google Doc', 'compile the findings', 'export the research', or 'make a document of it'. Do not start new research for this; the findings already exist in memory.",
      category: "research",
      inputSchema: z.object({
        topic: z.string().optional().describe("Optional topic to export. If omitted, exports the most recent research."),
      }),
      riskLevel: 1,
      requiresConfirmation: false,
      timeout: 20000,
      cancellable: false,
      execute: async (input) => {
        const query = String(input.topic || "").trim();
        let report = null;
        if (query) {
          report = service.report(query);
        } else {
          // newest session wins
          const all = service.report("");
          report = all || null;
        }
        if (!report) {
          return {
            success: false,
            error: "No research findings yet. Start deep_research first.",
          };
        }

        const compiled = compileDocument(report);
        const slug = slugify(report.topic);
        const dir = join(process.cwd(), "research");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const filePath = join(dir, `${slug}.md`);
        writeFileSync(filePath, compiled, "utf-8");

        const b64 = Buffer.from(compiled, "utf-8").toString("base64");
        try {
          execSync(
            `[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | Set-Clipboard; Start-Process 'https://docs.google.com/document/create'`,
            { encoding: "utf-8", timeout: 15000, shell: "powershell.exe" }
          );
        } catch (err) {
          return {
            success: true,
            result: {
              exported: false,
              file: filePath,
              error: `A new Google Doc may not have opened automatically. Content also saved to ${filePath}.`,
            },
          };
        }

        return {
          success: true,
          result: {
            exported: true,
            topic: report.topic,
            iterations: report.iterations,
            findings: report.notes.length,
            sources: report.sources.length,
            file: filePath,
            instruction: "A new Google Doc opened. Press Ctrl+V to paste the formatted research.",
          },
        };
      },
    },
  ];
}

function compileDocument(report: { topic: string; notes: string[]; sources: string[] }): string {
  const now = new Date().toLocaleString();
  const body = report.notes.length
    ? report.notes.join("\n\n")
    : "_No detailed extracts were captured yet._";
  const sources = report.sources.length
    ? report.sources.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "_No sources yet._";
  return [
    `# Deep Research: ${report.topic}`,
    ``,
    `_Compiled ${now} by J.A.R.V.I.S. — ${report.notes.length} findings from ${report.sources.length} sources._`,
    ``,
    `---`,
    ``,
    body,
    ``,
    `---`,
    ``,
    `## Sources`,
    sources,
  ].join("\n");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "research";
}