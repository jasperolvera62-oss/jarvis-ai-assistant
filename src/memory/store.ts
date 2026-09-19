import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { getConfig } from "../shared/config.js";
import type { MemoryEntry, MemoryLayer, Message } from "../shared/types.js";
import { MemoryEntrySchema, generateId } from "../shared/types.js";
import { getLogger } from "../shared/logger.js";

const BANNED_PATTERNS = [
  /^\d+\s*\+\s*\d+/,              // arithmetic
  /weather/i,
  /(tell\s+me\s+)?a\s+joke/i,
  /hi\b|hello\b|hey\b/i,
  /what\s+time\s+is\s+it/i,
];

export class MemoryStore {
  private dataDir: string;
  private entries: Map<string, MemoryEntry> = new Map();
  private workingMemory: Message[] = [];

  constructor(dataDir?: string) {
    this.dataDir = dataDir || getConfig().memory.dataDir;
    this.ensureDataDir();
    this.loadAll();
  }

  private ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    for (const layer of ["user_profile", "project", "episodic"] as const) {
      const dir = join(this.dataDir, layer);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private getDir(layer: MemoryLayer): string {
    if (layer === "working") return this.dataDir;
    return join(this.dataDir, layer);
  }

  private loadAll(): void {
    for (const layer of ["user_profile", "project", "episodic"] as const) {
      const dir = this.getDir(layer);
      if (!existsSync(dir)) continue;
      try {
        for (const file of readdirSync(dir)) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = readFileSync(join(dir, file), "utf-8");
            const entry = MemoryEntrySchema.parse(JSON.parse(raw));
            this.entries.set(entry.id, entry);
          } catch (err) {
            getLogger().warn("memory", `Failed to load memory file: ${file}`, err);
          }
        }
      } catch (err) {
        getLogger().warn("memory", "Failed to read memory directory", err);
      }
    }
  }

  private persist(entry: MemoryEntry): void {
    const dir = this.getDir(entry.layer);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2), "utf-8");
  }

  private removeFromDisk(entry: MemoryEntry): void {
    const file = join(this.getDir(entry.layer), `${entry.id}.json`);
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch (err) {
        getLogger().warn("memory", "Failed to delete memory file", err);
      }
    }
  }

  private isTrivial(input: string): boolean {
    return BANNED_PATTERNS.some((p) => p.test(input));
  }

  async set(layer: Exclude<MemoryLayer, "working">, key: string, value: string): Promise<MemoryEntry> {
    const existing = Array.from(this.entries.values()).find(
      (e) => e.layer === layer && e.key === key
    );
    const now = Date.now();
    if (existing) {
      for (const id of this.entries.keys()) {
        const entry = this.entries.get(id)!;
        if (entry.id === existing.id) {
          const updated: MemoryEntry = {
            ...entry,
            value,
            updatedAt: now,
          };
          this.entries.set(id, updated);
          this.persist(updated);
          return updated;
        }
      }
    }
    const entry: MemoryEntry = {
      id: generateId(),
      layer,
      key,
      value,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(entry.id, entry);
    this.persist(entry);
    return entry;
  }

  async search(query: string): Promise<MemoryEntry[]> {
    const q = query.toLowerCase();
    const scored = Array.from(this.entries.values())
      .map((e) => {
        const keyScore = e.key.toLowerCase().includes(q) ? 3 : 0;
        const valueScore = e.value.toLowerCase().includes(q) ? 2 : 0;
        return { entry: e, score: keyScore + valueScore };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.entry);
    return scored;
  }

  async getById(id: string): Promise<MemoryEntry | undefined> {
    return this.entries.get(id);
  }

  async updateById(id: string, value: string): Promise<MemoryEntry | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const updated: MemoryEntry = { ...entry, value, updatedAt: Date.now() };
    this.entries.set(id, updated);
    this.persist(updated);
    return updated;
  }

  async deleteById(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.removeFromDisk(entry);
    return true;
  }

  async deleteByKey(key: string): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (entry.key === key) {
        this.entries.delete(id);
        this.removeFromDisk(entry);
        count++;
      }
    }
    return count;
  }

  async clearAll(): Promise<void> {
    for (const [id, entry] of this.entries) {
      this.removeFromDisk(entry);
      this.entries.delete(id);
    }
  }

  async getStats() {
    const byLayer = {
      user_profile: Array.from(this.entries.values()).filter((e) => e.layer === "user_profile").length,
      project: Array.from(this.entries.values()).filter((e) => e.layer === "project").length,
      episodic: Array.from(this.entries.values()).filter((e) => e.layer === "episodic").length,
    };
    return {
      total: this.entries.size,
      byLayer,
      workingMemorySize: this.workingMemory.length,
      dataDir: this.dataDir,
    };
  }

  async getAll(): Promise<MemoryEntry[]> {
    return Array.from(this.entries.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  addWorkingMessage(message: Message): void {
    this.workingMemory.push(message);
    const max = getConfig().memory.maxWorkingMemory;
    if (this.workingMemory.length > max) {
      this.workingMemory = this.workingMemory.slice(-max);
    }
  }

  getWorkingMemory(): Message[] {
    return this.workingMemory;
  }

  clearWorkingMemory(): void {
    this.workingMemory = [];
  }

  async extractMemoryFromConversation(messages: Message[]): Promise<MemoryEntry[]> {
    const created: MemoryEntry[] = [];
    for (const msg of messages) {
      if (msg.role !== "user") continue;
      const content = msg.content;
      if (!content || this.isTrivial(content)) continue;

      const rememberMatch = content.match(/remember|don'?t forget/i);
      if (rememberMatch) {
        const cleaned = content
          .replace(/^(hey|ok|okay|alright|jarvis|sir)?\s*/i, "")
          .replace(/(please\s+)?(remember|don'?t forget)\s+(that\s+)?/i, "")
          .replace(/[.!?]+$/, "")
          .trim();
        if (cleaned.length > 3) {
          const key = cleaned.slice(0, 40).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
          const entry = await this.set("user_profile", key, cleaned);
          created.push(entry);
        }
      }
    }
    return created;
  }

  async getRelevantContext(query: string, limit = 8): Promise<MemoryEntry[]> {
    const results = await this.search(query);
    return results.slice(0, limit);
  }
}