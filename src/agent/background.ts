import { EventEmitter } from "events";
import { generateId } from "../shared/types.js";
import type { TaskStatus } from "../shared/types.js";
import { getConfig } from "../shared/config.js";

export interface BackgroundTaskInfo {
  id: string;
  description: string;
  status: TaskStatus;
  progress: number;
  currentAction: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  cancelled: boolean;
}

export interface BackgroundTaskManagerEvents {
  update: (task: BackgroundTaskInfo) => void;
  completed: (task: BackgroundTaskInfo) => void;
  failed: (task: BackgroundTaskInfo) => void;
  cancelled: (task: BackgroundTaskInfo) => void;
}

export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTaskInfo> = new Map();
  private controllers: Map<string, AbortController> = new Map();
  private emitter: EventEmitter = new EventEmitter();

  on<K extends keyof BackgroundTaskManagerEvents>(
    event: K,
    listener: BackgroundTaskManagerEvents[K]
  ): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  private emitUpdate(task: BackgroundTaskInfo): void {
    this.emitter.emit("update", task);
    if (task.status === "completed") this.emitter.emit("completed", task);
    if (task.status === "failed") this.emitter.emit("failed", task);
    if (task.status === "cancelled") this.emitter.emit("cancelled", task);
  }

  async start(
    description: string,
    runner: (
      updater: (progress: number, action: string) => void,
      signal: AbortSignal
    ) => Promise<unknown>
  ): Promise<BackgroundTaskInfo> {
    const config = getConfig();
    const active = Array.from(this.tasks.values()).filter(
      (t) => t.status === "in_progress" || t.status === "pending"
    ).length;

    if (active >= config.backgroundTasks.maxConcurrent) {
      throw new Error("Maximum concurrent background tasks reached");
    }

    const id = generateId();
    const controller = new AbortController();
    const task: BackgroundTaskInfo = {
      id,
      description,
      status: "in_progress",
      progress: 0,
      currentAction: "Starting...",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cancelled: false,
    };

    this.tasks.set(id, task);
    this.controllers.set(id, controller);

    // Timeout
    const timeoutId = setTimeout(
      () => controller.abort(new Error("Background task timed out")),
      config.backgroundTasks.defaultTimeout
    );

    const updater = (progress: number, action: string) => {
      task.progress = Math.min(100, progress);
      task.currentAction = action;
      task.updatedAt = Date.now();
      this.emitUpdate({ ...task });
    };

    void (async () => {
      try {
        const result = await runner(updater, controller.signal);
        clearTimeout(timeoutId);
        task.status = "completed";
        task.progress = 100;
        task.result = result;
        task.updatedAt = Date.now();
        this.controllers.delete(id);
        this.emitUpdate({ ...task });
      } catch (err) {
        clearTimeout(timeoutId);
        this.controllers.delete(id);
        if (task.cancelled || (controller.signal.aborted && err instanceof Error && /abort|cancel/i.test(err.message))) {
          task.status = "cancelled";
          task.error = "Cancelled";
          this.emitUpdate({ ...task });
        } else {
          task.status = "failed";
          task.error = err instanceof Error ? err.message : String(err);
          task.updatedAt = Date.now();
          this.emitUpdate({ ...task });
        }
      }
    })();

    return task;
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    const task = this.tasks.get(id);
    if (task && (task.status === "in_progress" || task.status === "pending")) {
      task.cancelled = true;
    }
    controller.abort(new Error("Cancelled"));
    return true;
  }

  stopAll(): void {
    for (const [id, controller] of this.controllers) {
      const task = this.tasks.get(id);
      if (task) task.cancelled = true;
      controller.abort(new Error("Stopped"));
    }
  }

  get(id: string): BackgroundTaskInfo | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  getAll(): BackgroundTaskInfo[] {
    return Array.from(this.tasks.values())
      .map((t) => ({ ...t }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getActiveCount(): number {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === "in_progress" || t.status === "pending"
    ).length;
  }
}

export const backgroundTaskManager = new BackgroundTaskManager();