import { getConfig } from "../shared/config.js";
import { getLogger } from "../shared/logger.js";
import OpenAI from "openai";

export interface STTResult {
  text: string;
  durationMs: number;
  confidence?: number;
}

export class STTService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI | null {
    const config = getConfig();
    if (!config.llm.apiKey) return null;
    if (!this.client) {
      this.client = new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl });
    }
    return this.client;
  }

  /**
   * Transcribe audio bytes using the configured STT model.
   * Audio should be in WAV/MP3/MP4/M4A/WebM format.
   */
  async transcribe(audioBytes: Uint8Array, format: string): Promise<STTResult> {
    const client = this.getClient();
    if (!client) {
      return { text: "", durationMs: 0 };
    }
    const config = getConfig();
    const start = performance.now();

    try {
      const mimeToExt: Record<string, string> = {
        "audio/webm": "webm",
        "audio/webm;codecs=opus": "webm",
        "video/webm": "webm",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/wave": "wav",
        "audio/ogg": "ogg",
        "audio/x-wav": "wav",
      };
      const ext = mimeToExt[format.toLowerCase()] || "webm";

      const file = new File([audioBytes], `recording.${ext}`, { type: format });
      const response = await client.audio.transcriptions.create({
        file,
        model: config.voice.sttModel,
      });

      const durationMs = performance.now() - start;
      return { text: response.text.trim(), durationMs };
    } catch (err) {
      getLogger().error("stt", "Transcription failed", err);
      throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const sttService = new STTService();