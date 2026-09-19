import { AgentOrchestrator } from "./orchestrator.js";
import { generateId } from "../shared/types.js";
import { getLogger } from "../shared/logger.js";

export interface TurnResult {
  response: string;
  turnId: string;
  durationMs: number;
}

/**
 * Unified conversation entry point. Both text and voice input
 * arrive here and flow through the same agent pipeline.
 */
export class TurnManager {
  private agent: AgentOrchestrator;
  private processing = false;

  constructor(agent: AgentOrchestrator) {
    this.agent = agent;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Handle a user turn. Accepts both text and voice-derived text.
   * This is the single pipeline: voice -> agent and text -> agent.
   */
  async processTurn(input: string, source: "text" | "voice" = "text"): Promise<TurnResult> {
    const start = performance.now();
    this.processing = true;

    try {
      const response = await this.agent.handleUserInput(input, { source });

      return {
        response,
        turnId: generateId(),
        durationMs: performance.now() - start,
      };
    } catch (err) {
      getLogger().debug("turn", "Turn failed", err);
      throw err;
    } finally {
      this.processing = false;
    }
  }

  async cancelCurrent(): Promise<void> {
    this.agent.cancelActive();
  }

  interruptSpeech(): void {
    // The agent pipe emits "state" transitions; the server layer handles TTS playback.
    this.agent.cancelActive();
  }
}