import { z } from "zod";

export type AssistantState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "planning"
  | "executing"
  | "verifying"
  | "speaking"
  | "interrupted"
  | "error";

export type RiskLevel = 0 | 1 | 2 | 3;

export type NotificationPriority = "critical" | "important" | "useful" | "optional";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export type MemoryLayer = "working" | "user_profile" | "project" | "episodic";

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
  timestamp: z.number(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  success: z.boolean(),
  result: z.unknown(),
  error: z.string().optional(),
  duration: z.number(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  objective: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]),
  steps: z.array(z.object({
    description: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "failed", "blocked"]),
    toolCalls: z.array(ToolCallSchema).optional(),
  })),
  result: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Task = z.infer<typeof TaskSchema>;

export const MemoryEntrySchema = z.object({
  id: z.string(),
  layer: z.enum(["working", "user_profile", "project", "episodic"]),
  key: z.string(),
  value: z.string(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export interface Notification {
  id: string;
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: number;
  dismissed: boolean;
}

export interface ConversationContext {
  sessionId: string;
  turnId: string;
  messages: Message[];
  activeTask: Task | null;
  recentToolCalls: ToolCall[];
  recentToolResults: ToolResult[];
}

export interface WSMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  cpus: number;
  totalMemory: number;
  uptime: number;
}

export interface AppState {
  state: AssistantState;
  context: ConversationContext;
  systemInfo: SystemInfo;
  notifications: Notification[];
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
