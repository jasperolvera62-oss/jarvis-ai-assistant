import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory/store.js";
import { mkdtempSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("MemoryStore", () => {
  let memory: MemoryStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "jarvis-mem-"));
    memory = new MemoryStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds a memory entry", async () => {
    const entry = await memory.set("user_profile", "preferred_name", "Kaito");
    expect(entry.key).toBe("preferred_name");
    expect(entry.value).toBe("Kaito");
    expect(entry.layer).toBe("user_profile");
  });

  it("updates an existing memory entry by key", async () => {
    await memory.set("user_profile", "theme", "dark");
    const updated = await memory.set("user_profile", "theme", "light");
    expect(updated.value).toBe("light");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
    const stats = await memory.getStats();
    expect(stats.total).toBe(1);
  });

  it("searches memory", async () => {
    await memory.set("user_profile", "project", "Blender character rigging");
    await memory.set("user_profile", "game", "My VR game");
    const results = await memory.search("blender");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].value).toContain("Blender");
  });

  it("deletes by id", async () => {
    const entry = await memory.set("user_profile", "temp_fact", "temporary");
    const deleted = await memory.deleteById(entry.id);
    expect(deleted).toBe(true);
    const all = await memory.getAll();
    expect(all.length).toBe(0);
  });

  it("deletes by key", async () => {
    await memory.set("user_profile", "dup", "a");
    await memory.set("project", "dup", "b");
    const count = await memory.deleteByKey("dup");
    expect(count).toBe(2);
  });

  it("persists across instances", async () => {
    await memory.set("user_profile", "persistent", "yes");
    const memory2 = new MemoryStore(tempDir);
    const all = await memory2.getAll();
    expect(all.length).toBe(1);
    expect(all[0].value).toBe("yes");
  });

  it("clears all memory", async () => {
    await memory.set("user_profile", "a", "1");
    await memory.set("project", "b", "2");
    await memory.set("episodic", "c", "3");
    await memory.clearAll();
    const all = await memory.getAll();
    expect(all.length).toBe(0);
    for (const layer of ["user_profile", "project", "episodic"] as const) {
      const dir = join(tempDir, layer);
      expect(readdirSync(dir).length).toBe(0);
    }
  });

  it("does not persist trivial trivia", async () => {
    const created = await memory.extractMemoryFromConversation([
      { id: "1", role: "user" as const, content: "what time is it?", timestamp: Date.now() },
      { id: "2", role: "user" as const, content: "remember my dog is called Rex", timestamp: Date.now() },
    ]);
    expect(created.length).toBe(1);
    expect(created[0].value.toLowerCase()).toContain("rex");
  });
});