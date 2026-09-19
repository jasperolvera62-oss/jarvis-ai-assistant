import type { ToolDefinition } from "./registry.js";
import type { MemoryStore } from "../memory/store.js";
import { systemTools } from "./categories/system.js";
import { fileTools } from "./categories/files.js";
import { applicationTools } from "./categories/applications.js";
import { clipboardTools } from "./categories/clipboard.js";
import { mediaTools } from "./categories/media.js";
import { developerTools } from "./categories/developer.js";
import { visionTools } from "./categories/vision.js";
import { webTools } from "./categories/web.js";
import { emergencyTools } from "./categories/emergency.js";
import { createMemoryTools } from "./categories/memory.js";
import { createResearchTools } from "./categories/research.js";

export function createAllTools(memory: MemoryStore): ToolDefinition[] {
  return [
    ...systemTools,
    ...fileTools,
    ...applicationTools,
    ...clipboardTools,
    ...mediaTools,
    ...developerTools,
    ...visionTools,
    ...webTools,
    ...emergencyTools,
    ...createMemoryTools(memory),
    ...createResearchTools(memory),
  ];
}

export * from "./registry.js";