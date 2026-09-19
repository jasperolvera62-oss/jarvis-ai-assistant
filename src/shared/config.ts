import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");

loadDotenv({ path: join(PROJECT_ROOT, ".env") });

const ConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(["openai"]),
    apiKey: z.string().default(""),
    baseUrl: z.string().default("https://api.openai.com/v1"),
    model: z.string().default("gpt-4o"),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().min(1).default(1024),
  }),
  voice: z.object({
    enabled: z.boolean().default(true),
    fishApiKey: z.string().default(""),
    fishReferenceId: z.string().default(""),
    fishDriverModel: z.enum(["s2.1-pro", "s2.1-pro-free"]).default("s2.1-pro-free"),
    ttsVoice: z.string().default("en-US-GuyNeural"),
    ttsRate: z.string().default("+0%"),
    ttsVolume: z.string().default("+0%"),
    sttModel: z.string().default("whisper-1"),
    wakeWord: z.string().default("hey jarvis"),
    wakeEnabled: z.boolean().default(false),
  }),
  personality: z.object({
    name: z.string().default("J.A.R.V.I.S."),
    formOfAddress: z.string().default("Sir"),
    tone: z.enum(["professional", "casual", "minimal"]).default("professional"),
    witLevel: z.enum(["none", "subtle", "moderate"]).default("subtle"),
  }),
  permissions: z.object({
    autoExecuteLevel0: z.boolean().default(true),
    autoExecuteLevel1: z.boolean().default(true),
    requireConfirmationLevel2: z.boolean().default(true),
    requireConfirmationLevel3: z.boolean().default(true),
  }),
  memory: z.object({
    enabled: z.boolean().default(true),
    maxWorkingMemory: z.number().default(50),
    maxEpisodicMemory: z.number().default(100),
    dataDir: z.string().default(join(PROJECT_ROOT, "data")),
  }),
  server: z.object({
    port: z.number().default(3000),
    host: z.string().default("0.0.0.0"),
    authPin: z.string().default(""),
  }),
  backgroundTasks: z.object({
    maxConcurrent: z.number().default(3),
    defaultTimeout: z.number().default(3600000),
  }),
  location: z.object({
    name: z.string().default("Guam"),
    latitude: z.number().default(13.4443),
    longitude: z.number().default(144.7937),
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const raw = {
    llm: {
      provider: "openai" as const,
      apiKey: process.env.OPENAI_API_KEY || "",
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      model: process.env.LLM_MODEL || "gpt-4o",
      temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "1024"),
    },
    voice: {
      enabled: process.env.VOICE_ENABLED !== "false",
      fishApiKey: process.env.FISH_AUDIO_API_KEY || "",
      fishReferenceId: process.env.FISH_AUDIO_REFERENCE_ID || "",
      fishDriverModel: (process.env.FISH_AUDIO_MODEL || "s2.1-pro-free") as "s2.1-pro-free",
      ttsRate: process.env.TTS_RATE || "+0%",
      ttsVolume: process.env.TTS_VOLUME || "+0%",
      sttModel: process.env.STT_MODEL || "whisper-1",
      wakeWord: process.env.WAKE_WORD || "hey jarvis",
      wakeEnabled: process.env.WAKE_ENABLED === "true",
    },
    personality: {
      name: process.env.ASSISTANT_NAME || "J.A.R.V.I.S.",
      formOfAddress: process.env.FORM_OF_ADDRESS || "Sir",
      tone: (process.env.PERSONALITY_TONE || "professional") as "professional",
      witLevel: (process.env.WIT_LEVEL || "subtle") as "subtle",
    },
    permissions: {
      autoExecuteLevel0: process.env.AUTO_EXECUTE_L0 !== "false",
      autoExecuteLevel1: process.env.AUTO_EXECUTE_L1 !== "false",
      requireConfirmationLevel2: process.env.REQUIRE_CONFIRM_L2 !== "false",
      requireConfirmationLevel3: process.env.REQUIRE_CONFIRM_L3 !== "false",
    },
    memory: {
      enabled: process.env.MEMORY_ENABLED !== "false",
      maxWorkingMemory: parseInt(process.env.MAX_WORKING_MEMORY || "50"),
      maxEpisodicMemory: parseInt(process.env.MAX_EPISODIC_MEMORY || "100"),
      dataDir: process.env.MEMORY_DATA_DIR || join(PROJECT_ROOT, "data"),
    },
server: {
      port: parseInt(process.env.PORT || "3000"),
      host: process.env.HOST || "0.0.0.0",
      authPin: process.env.AUTH_PIN || "",
    },
    backgroundTasks: {
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT_TASKS || "3"),
      defaultTimeout: parseInt(process.env.TASK_TIMEOUT || "3600000"),
    },
    location: {
      name: process.env.LOCATION_NAME || "Guam",
      latitude: parseFloat(process.env.LOCATION_LATITUDE || "13.4443"),
      longitude: parseFloat(process.env.LOCATION_LONGITUDE || "144.7937"),
    },
    logging: {
      level: (process.env.LOG_LEVEL || "info") as "info",
    },
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error("Configuration errors:", result.error.format());
    throw new Error("Invalid configuration");
  }

  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}

export function createEnvExample(): string {
  return `# J.A.R.V.I.S. Configuration
# Copy this file to .env and fill in your values

# === LLM ===
OPENAI_API_KEY=sk-your-key-here
# For a custom/relay endpoint (e.g. AIML API), set an OpenAI-compatible base URL:
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=1024

# === Voice ===
VOICE_ENABLED=true
# Custom voice via Fish Audio (optional). FISH_AUDIO_REFERENCE_ID is the voice model id.
FISH_AUDIO_API_KEY=
FISH_AUDIO_REFERENCE_ID=
FISH_AUDIO_MODEL=s2.1-pro-free
TTS_VOICE=en-US-GuyNeural
TTS_RATE=+0%
TTS_VOLUME=+0%
STT_MODEL=whisper-1
WAKE_WORD=hey jarvis
WAKE_ENABLED=false

# === Personality ===
ASSISTANT_NAME=J.A.R.V.I.S.
FORM_OF_ADDRESS=Sir
PERSONALITY_TONE=professional
WIT_LEVEL=subtle

# === Permissions ===
AUTO_EXECUTE_L0=true
AUTO_EXECUTE_L1=true
REQUIRE_CONFIRM_L2=true
REQUIRE_CONFIRM_L3=true

# === Memory ===
MEMORY_ENABLED=true
MAX_WORKING_MEMORY=50
MAX_EPISODIC_MEMORY=100

# === Server ===
PORT=3000
HOST=0.0.0.0
# Leave AUTH_PIN empty for local-only; set one to password-protect (required for public deploy).
AUTH_PIN=

# === Background Tasks ===
MAX_CONCURRENT_TASKS=3
TASK_TIMEOUT=3600000

# === Location (used by the weather tool) ===
LOCATION_NAME=Guam
LOCATION_LATITUDE=13.4443
LOCATION_LONGITUDE=144.7937

# === Logging ===
LOG_LEVEL=info
`;
}
