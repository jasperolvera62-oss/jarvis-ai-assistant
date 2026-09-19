import { describe, it, expect } from "vitest";
import { TTSService } from "../src/voice/tts.js";

describe("TTSService", () => {
  it("splits text into sentences", () => {
    const sentences = TTSService.splitSentences(
      "Good evening, sir. The build has finished. Let me show you the results."
    );
    expect(sentences.length).toBe(3);
    expect(sentences[0]).toBe("Good evening, sir.");
    expect(sentences[1]).toBe("The build has finished.");
    expect(sentences[2]).toBe("Let me show you the results.");
  });

  it("handles a single sentence", () => {
    expect(TTSService.splitSentences("Done.")).toEqual(["Done."]);
  });

  it("handles multiline text", () => {
    const sentences = TTSService.splitSentences("Line one.\nLine two.");
    expect(sentences).toEqual(["Line one.", "Line two."]);
  });

  it("returns empty for empty input", () => {
    expect(TTSService.splitSentences("   ")).toEqual([]);
  });

  it("appends missing punctuation to long fragments", () => {
    const longText =
      "This is a very long fragment that has no punctuation but is really quite long indeed far exceeding one hundred and twenty characters in total length";
    const result = TTSService.splitSentences(longText);
    expect(result[0]).toMatch(/\.$/);
  });

  it("toggles speaking state", async () => {
    const tts = new TTSService();
    const states: string[] = [];
    tts.on("state", (s) => states.push(s));

    await tts.stop();
    expect(tts.isSpeaking()).toBe(false);
    expect(states).toEqual([]);
  });
});