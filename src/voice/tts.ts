import { EventEmitter } from "events";
import { getConfig } from "../shared/config.js";
import { getLogger } from "../shared/logger.js";

export interface TTSServiceEvents {
  state: (state: "idle" | "speaking" | "stopped") => void;
}

export class TTSService extends EventEmitter {
  private speaking = false;
  private abortController: AbortController | null = null;

  constructor() {
    super();
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  private setSpeaking(state: boolean) {
    this.speaking = state;
    this.emit("state", state ? "speaking" : "idle");
  }

  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.speaking) {
      this.setSpeaking(false);
      this.emit("state", "stopped");
    }
  }

  /**
   * Split text into speakable sentences.
   */
  static splitSentences(text: string): string[] {
    const cleaned = text.trim();
    if (!cleaned) return [];
    const parts = cleaned.split(/(?<=[.!?])\s+|\n+/);
    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => {
        const hasPunct = /[.!?]$/.test(p);
        return hasPunct || p.length < 120 ? p : `${p}.`;
      });
  }

  /**
   * Synthesize text to speech bytes.
   * Uses the Fish Audio custom voice when configured, otherwise Edge TTS.
   */
  async synthesize(
    text: string
  ): Promise<{ audio: Buffer; mimeType: string } | null> {
    const config = getConfig();
    try {
      if (config.voice.fishApiKey && config.voice.fishReferenceId) {
        return await this.synthesizeFishAudio(text, config);
      }
      const { EdgeTTS } = await import("edge-tts-universal");
      const tts = new EdgeTTS(text, config.voice.ttsVoice, {
        rate: config.voice.ttsRate,
        volume: config.voice.ttsVolume,
        pitch: "+0Hz",
      });
      const result = await tts.synthesize();
      const arrayBuffer = await result.audio.arrayBuffer();
      return { audio: Buffer.from(arrayBuffer), mimeType: result.audio.type || "audio/mpeg" };
    } catch (err) {
      getLogger().warn("tts", "TTS synthesis failed", err);
      return null;
    }
  }

  private async synthesizeFishAudio(
    text: string,
    config: ReturnType<typeof getConfig>
  ): Promise<{ audio: Buffer; mimeType: string } | null> {
    const response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.voice.fishApiKey}`,
        "Content-Type": "application/json",
        model: config.voice.fishDriverModel,
      },
      body: JSON.stringify({
        text,
        reference_id: config.voice.fishReferenceId,
        format: "mp3",
        sample_rate: 44100,
        mp3_bitrate: 128,
        latency: "normal",
        prosody: {
          speed: 1,
          volume: 0,
          normalize_loudness: true,
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      getLogger().warn("tts", `Fish Audio returned ${response.status}: ${detail.slice(0, 200)}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return { audio: Buffer.from(arrayBuffer), mimeType: response.headers.get("content-type") || "audio/mpeg" };
  }

  /**
   * Stream text sentence-by-sentence, invoking per-sentence audio callback.
   * Supports interruption/cancellation via an AbortController.
   */
  async speakStreaming(
    text: string,
    onAudio: (sentence: string, audio: { data: string; mimeType: string }) => void
  ): Promise<void> {
    const config = getConfig();
    if (!config.voice.enabled) return;

    this.setSpeaking(true);
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const sentences = TTSService.splitSentences(text);
    try {
      for (const sentence of sentences) {
        if (signal.aborted) break;
        const result = await this.synthesize(sentence);
        if (signal.aborted) break;
        this.emit("sentenceStart", sentence);
        if (result) {
          onAudio(sentence, {
            data: result.audio.toString("base64"),
            mimeType: result.mimeType,
          });
        }
        this.emit("sentenceEnd", sentence);
      }
    } catch (err) {
      getLogger().error("tts", "TTS streaming failed", err);
    } finally {
      this.setSpeaking(false);
    }
  }
}

export const ttsService = new TTSService();