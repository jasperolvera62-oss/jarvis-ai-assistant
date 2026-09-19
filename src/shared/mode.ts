export type AssistantMode = "normal" | "serious";

let currentMode: AssistantMode = "normal";
const listeners = new Set<(mode: AssistantMode) => void>();

export function getMode(): AssistantMode {
  return currentMode;
}

export function setMode(mode: AssistantMode): void {
  currentMode = mode;
  for (const listener of listeners) listener(mode);
}

export function isSeriousMode(): boolean {
  return currentMode === "serious";
}