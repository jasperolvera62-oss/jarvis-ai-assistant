import { loadConfig, createEnvExample, getConfig } from "./shared/config.js";
import { getLogger } from "./shared/logger.js";
import { MemoryStore } from "./memory/store.js";
import { ToolRegistry, createAllTools } from "./tools/index.js";
import { LLMClient } from "./agent/llm.js";
import { AgentOrchestrator } from "./agent/orchestrator.js";
import { TurnManager } from "./agent/turnManager.js";
import { backgroundTaskManager } from "./agent/background.js";
import { STTService } from "./voice/stt.js";
import { TTSService } from "./voice/tts.js";
import { JARVISServer } from "./ui/server.js";
import { existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

async function main() {
  process.title = "JARVIS AI Assistant";

  const config = loadConfig();
  const logger = getLogger();

  // Ensure .env.example exists
  const envExamplePath = join(PROJECT_ROOT, ".env.example");
  if (!existsSync(envExamplePath)) {
    writeFileSync(envExamplePath, createEnvExample(), "utf-8");
  }

  if (!config.llm.apiKey) {
    logger.warn("startup", "No OPENAI_API_KEY set. Create a .env file (see .env.example). LLM features will fail until configured.");
  }

  // Assemble the system
  const memory = new MemoryStore();
  const registry = new ToolRegistry();
  registry.registerMany(createAllTools(memory));

  const llm = new LLMClient();
  const agent = new AgentOrchestrator(registry, memory, llm);
  const turnManager = new TurnManager(agent);
  const backgroundTasks = backgroundTaskManager;
  const stt = new STTService();
  const tts = new TTSService();

  logger.info("startup", `J.A.R.V.I.S. initialised. ${registry.getAll().length} tools available.`);

  // Wire agent cancellation state to a timeout
  agent.on("state", (state) => {
    logger.debug("agent", `State: ${state}`);
  });

  const server = new JARVISServer({
    agent,
    turnManager,
    stt,
    tts,
    backgroundTasks,
    memory,
  });

  await server.start();
  logger.info("startup", "JARVIS ready. Text mode available on the HUD; configure .env for voice.");

  const shutdown = async (signal: string) => {
    logger.info("startup", `Received ${signal}, shutting down...`);
    await server.stop();
    await tts.stop();
    backgroundTasks.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});