import { describe, it, expect, afterEach } from "vitest";
import { BackgroundTaskManager } from "../src/agent/background.js";

describe("BackgroundTaskManager", () => {
  const manager = new BackgroundTaskManager();

  afterEach(() => {
    manager.stopAll();
  });

  it("runs a task to completion", async () => {
    const task = await manager.start("Test task", async (updater) => {
      updater(50, "Working...");
      await new Promise((r) => setTimeout(r, 10));
      updater(100, "Done");
      return { answer: 42 };
    });

    expect(task.status).toBe("in_progress");

    await new Promise((r) => setTimeout(r, 100));
    const done = manager.get(task.id);
    expect(done?.status).toBe("completed");
    expect(done?.result).toEqual({ answer: 42 });
    expect(done?.progress).toBe(100);
  });

  it("marks a failed task", async () => {
    const task = await manager.start("Failing task", async () => {
      throw new Error("Task blew up");
    });

    await new Promise((r) => setTimeout(r, 50));
    const done = manager.get(task.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toContain("blew up");
  });

  it("cancels a running task", async () => {
    const task = await manager.start("Long task", async (_updater, signal) => {
      return await new Promise((_, reject) => {
        const interval = setInterval(() => {
          if (signal.aborted) {
            clearInterval(interval);
            reject(new Error("Cancelled"));
          }
        }, 10);
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    const cancelled = manager.cancel(task.id);
    expect(cancelled).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    const done = manager.get(task.id);
    expect(done?.status).toBe("cancelled");
  });

  it("reports progress updates through events", async () => {
    const progressPoints: number[] = [];
    const off = manager.on("update", (t) => {
      if (t.description === "Progress task") progressPoints.push(t.progress);
    });

    const task = await manager.start("Progress task", async (updater) => {
      updater(25, "Step 1");
      updater(75, "Step 2");
      updater(100, "Final");
      return "ok";
    });

    await new Promise((r) => setTimeout(r, 80));
    off();
    expect(progressPoints).toContain(25);
    expect(progressPoints).toContain(75);
    expect(task.status).toBe("completed");
  });
});