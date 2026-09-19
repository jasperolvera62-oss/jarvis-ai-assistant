import { WebSocketServer, WebSocket } from "ws";
import { createServer, type Server } from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import os from "os";
import { getConfig } from "../shared/config.js";
import { getMode, setMode, type AssistantMode } from "../shared/mode.js";
import { getLogger } from "../shared/logger.js";
import { AgentOrchestrator } from "../agent/orchestrator.js";
import { TurnManager } from "../agent/turnManager.js";
import { STTService } from "../voice/stt.js";
import { TTSService } from "../voice/tts.js";
import { BackgroundTaskManager } from "../agent/background.js";
import { launchApplication } from "./launcher.js";
import { MemoryStore } from "../memory/store.js";
import type { AssistantState } from "../shared/types.js";
import { isAuthEnabled, createSession, verifySession, destroySession, parseCookie } from "./auth.js";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");

export interface WebSocketServerOptions {
  agent: AgentOrchestrator;
  turnManager: TurnManager;
  stt: STTService;
  tts: TTSService;
  backgroundTasks: BackgroundTaskManager;
  memory: MemoryStore;
}

export class JARVISServer {
  private httpServer: Server;
  private wss: WebSocketServer;
  private options: WebSocketServerOptions;
  private currentState: AssistantState = "idle";
  private clients: Set<WebSocket> = new Set();
  private statsTimer: NodeJS.Timeout | null = null;
  private cpuPrev: { idle: number; total: number } | null = null;
  private appsCache: { apps: string[]; at: number } | null = null;
  private gpuCache: { name: string; util: number | null; at: number } | null = null;

  constructor(options: WebSocketServerOptions) {
    this.options = options;
    this.httpServer = createServer((req, res) => {
      this.handleHttp(req, res);
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.options = options;

    this.httpServer.on("upgrade", (req, socket, head) => {
      if (isAuthEnabled()) {
        const token = parseCookie(req.headers.cookie, "jarvis_session");
        if (!verifySession(token)) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.setupWebSocket();
    this.setupAgentEvents();
  }

  private handleHttp(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
    const url = (req.url || "/").split("?")[0];

    const authEnabled = isAuthEnabled();
    const sessionToken = parseCookie(req.headers.cookie, "jarvis_session");

    if (authEnabled && url === "/api/login" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { pin } = JSON.parse(body || "{}");
          const token = createSession(typeof pin === "string" ? pin : "");
          if (token) {
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Set-Cookie": `jarvis_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`,
            });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
          }
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }

    if (authEnabled && url === "/api/logout" && req.method === "POST") {
      destroySession(sessionToken);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": "jarvis_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (authEnabled && url === "/login") {
      const loginPath = join(PROJECT_ROOT, "src", "ui", "login.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(existsSync(loginPath) ? readFileSync(loginPath, "utf-8") : "<h1>Login not found</h1>");
      return;
    }

    if (authEnabled && url !== "/health" && !verifySession(sessionToken)) {
      if (url.startsWith("/assets/") || url === "/") {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
    }

    if (url === "/") {
      const htmlPath = join(PROJECT_ROOT, "src", "ui", "hud.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(existsSync(htmlPath) ? readFileSync(htmlPath, "utf-8") : "<h1>HUD not found</h1>");
      return;
    }

    if (url.startsWith("/assets/")) {
      const filePath = join(PROJECT_ROOT, "src", "ui", url.replace("/assets/", ""));
      if (existsSync(filePath)) {
        const ext = filePath.split(".").pop() || "";
        const mime: Record<string, string> = {
          html: "text/html",
          css: "text/css",
          js: "application/javascript",
          svg: "image/svg+xml",
          png: "image/png",
        };
        res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
        res.end(readFileSync(filePath));
        return;
      }
    }

    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", state: this.currentState }));
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  }

  private sendToClient(client: WebSocket, type: string, data: unknown) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, data, timestamp: Date.now() }));
    }
  }

  private broadcast(type: string, data: unknown) {
    const payload = JSON.stringify({ type, data, timestamp: Date.now() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private setState(state: AssistantState) {
    this.currentState = state;
    this.broadcast("state", { state });
  }

  private setupWebSocket() {
    this.wss.on("connection", async (socket) => {
      this.clients.add(socket);
      let memoryStats: unknown = null;
      try {
        memoryStats = await this.options.memory.getStats();
      } catch {
        memoryStats = null;
      }
      this.sendToClient(socket, "hello", {
        config: {
          llm: { model: getConfig().llm.model },
          voice: { enabled: getConfig().voice.enabled, wakeEnabled: getConfig().voice.wakeEnabled, wakeWord: getConfig().voice.wakeWord },
          personality: { name: getConfig().personality.name },
          location: getConfig().location,
        },
        systemInfo: {
          platform: process.platform,
          state: this.currentState,
        },
        mode: getMode(),
        memoryStats,
      });

      let audioBuffer: Buffer[] = [];
      let audioFormat = "audio/webm";
      let audioSessionActive = false;

      socket.on("message", async (raw, isBinary) => {
        if (isBinary) {
          const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
          if (audioSessionActive && buf.length >= 512) {
            audioBuffer.push(buf);
          }
          return;
        }

        let msg: { type: string; data: any };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        switch (msg.type) {
          case "audio_start": {
            audioBuffer = [];
            audioSessionActive = true;
            audioFormat = msg.data?.format || "audio/webm";
            this.setState("listening");
            this.broadcast("status", { status: "Listening..." });
            break;
          }
          case "audio_chunk": {
            const chunk = msg.data?.base64;
            if (typeof chunk === "string" && audioSessionActive) {
              audioBuffer.push(Buffer.from(chunk, "base64"));
            }
            break;
          }
          case "audio_end": {
            audioSessionActive = false;
            if (audioBuffer.length === 0) {
              this.setState("idle");
              break;
            }
            const combined = Buffer.concat(audioBuffer);
            audioBuffer = [];
            if (combined.length < 512) {
              this.setState("idle");
              break;
            }
            this.setState("transcribing");
            this.broadcast("status", { status: "Transcribing..." });
            try {
              const { text } = await this.options.stt.transcribe(new Uint8Array(combined), audioFormat);
              if (!text) {
                this.setState("idle");
                break;
              }
              this.broadcast("status", { status: "Transcribed: " + text.slice(0, 80) });
              await this.handleUserInput(text, "voice");
            } catch (err) {
              this.setState("error");
              this.broadcast("error", { message: err instanceof Error ? err.message : "Transcription failed" });
              setTimeout(() => this.setState("idle"), 2000);
            }
            break;
          }
          case "text_input": {
            const text = typeof msg.data === "string" ? msg.data : msg.data?.text;
            if (text && text.trim()) {
              void this.handleUserInput(text, "text");
            }
            break;
          }
          case "launch_app": {
            const name = msg.data?.name;
            if (name && typeof name === "string") {
              const result = launchApplication(name);
              this.broadcast("notification", { message: result });
            }
            break;
          }
case "interrupt": {
            this.options.turnManager.interruptSpeech();
            this.options.agent.cancelActive();
            this.setState("interrupted");
            setTimeout(() => this.setState("idle"), 1000);
            break;
          }
          case "stop": {
            this.options.turnManager.cancelCurrent();
            this.options.backgroundTasks.stopAll();
            this.setState("interrupted");
            setTimeout(() => this.setState("idle"), 1000);
            break;
          }
          case "confirm": {
            const { id, confirmed } = msg.data || {};
            if (id) {
              await this.options.agent.resolveConfirmation(id, confirmed);
            }
            break;
          }
          case "get_memory": {
            const all = await this.options.memory.getAll();
            this.sendToClient(socket, "memory_list", { entries: all });
            break;
          }
          case "memory_delete": {
            const { id } = msg.data || {};
            if (id) {
              await this.options.memory.deleteById(id);
              const all = await this.options.memory.getAll();
              this.sendToClient(socket, "memory_list", { entries: all });
            }
            break;
          }
          case "memory_clear": {
            await this.options.memory.clearAll();
            this.sendToClient(socket, "memory_list", { entries: [] });
            break;
          }
          case "get_tasks": {
            const tasks = this.options.backgroundTasks.getAll();
            this.sendToClient(socket, "tasks_list", { tasks });
            break;
          }
          case "cancel_task": {
            const { id } = msg.data || {};
            if (id) {
              this.options.backgroundTasks.cancel(id);
            }
            break;
          }
          case "get_state": {
            this.sendToClient(socket, "state", { state: this.currentState });
            break;
          }
          case "set_mode": {
            const target = msg.data?.mode === "serious" ? "serious" : "normal";
            setMode(target);
            this.broadcast("mode_change", { mode: target });
            break;
          }
          case "clear_context": {
            this.options.memory.clearWorkingMemory();
            this.broadcast("notification", {
              title: "Context cleared",
              message: "Conversation context has been reset.",
              priority: "useful",
            });
            break;
          }
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("error", (err) => {
        getLogger().warn("ws", "Client socket error", err);
      });
    });
  }

  private async handleUserInput(text: string, source: "text" | "voice") {
    try {
      await this.options.turnManager.processTurn(text, source);
      this.setState("idle");
    } catch (err) {
      this.setState("error");
      this.broadcast("error", { message: err instanceof Error ? err.message : "Processing failed" });
      setTimeout(() => this.setState("idle"), 2000);
    }
  }

  private async speakResponse(text: string) {
    try {
      this.broadcast("tts_state", { state: "speaking" });
      await this.options.tts.speakStreaming(text, (sentence, audio) => {
        this.broadcast("tts_audio", { sentence, audio });
      });
      this.broadcast("tts_state", { state: "idle" });
    } catch (err) {
      getLogger().warn("tts", "Response speaking failed", err);
      this.broadcast("tts_state", { state: "idle" });
    }
  }

  private setupAgentEvents() {
    const { agent, backgroundTasks, tts } = this.options;

    agent.on("state", (state) => {
      this.setState(state);
    });

    agent.on("status", (status) => {
      this.broadcast("status", { status });
    });

    agent.on("message", (msg) => {
      if (msg.metadata?.streaming) {
        this.broadcast("message_delta", { content: msg.content });
      } else if (msg.content && !msg.metadata?.memory && !msg.metadata?.cancelled) {
        this.broadcast("message_final", { message: msg });
        void this.speakResponse(msg.content);
      }
    });

    agent.on("transcript", (role, text) => {
      this.broadcast("transcript", { role, text });
    });

    agent.on("toolCall", (call) => {
      this.broadcast("tool_call", { call });
    });

    agent.on("toolResult", (result) => {
      this.broadcast("tool_result", { result });
    });

    agent.on("taskUpdate", (task) => {
      this.broadcast("task_update", { task });
    });

    agent.on("confirmationRequest", (request) => {
      this.broadcast("confirmation", { request });
    });

    backgroundTasks.on("update", (task) => {
      this.broadcast("background_update", { task });
    });

    backgroundTasks.on("completed", (task) => {
      this.broadcast("notification", {
        title: "Background task completed",
        message: task.description,
        priority: "useful",
      });
    });

    backgroundTasks.on("failed", (task) => {
      this.broadcast("notification", {
        title: "Background task failed",
        message: task.description,
        priority: "important",
      });
    });

    backgroundTasks.on("cancelled", (task) => {
      this.broadcast("notification", {
        title: "Background task cancelled",
        message: task.description,
        priority: "useful",
      });
    });

    void tts;
  }

  startSystemStats(): void {
    this.collectAndBroadcastStats();
    this.statsTimer = setInterval(() => this.collectAndBroadcastStats(), 4000);
  }

  stopSystemStats(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private cpuUsage(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
      idle += cpu.times.idle;
    }
    if (this.cpuPrev) {
      const idleDelta = idle - this.cpuPrev.idle;
      const totalDelta = total - this.cpuPrev.total;
      this.cpuPrev = { idle, total };
      if (totalDelta > 0) return Math.max(0, Math.min(100, Math.round(100 * (1 - idleDelta / totalDelta))));
    } else {
      this.cpuPrev = { idle, total };
    }
    return 0;
  }

  private memUsage(): number {
    const { totalmem, freemem } = os;
    const total = totalmem();
    if (!total) return 0;
    return Math.round(100 * (1 - freemem() / total));
  }

  private runPowershell(script: string): Promise<string> {
    return new Promise((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: 5000, windowsHide: true },
        (err, stdout) => {
          if (err) resolve("");
          else resolve(stdout || "");
        }
      );
    });
  }

  private async activeApps(): Promise<string[]> {
    const now = Date.now();
    if (this.appsCache && now - this.appsCache.at < 8000) {
      return this.appsCache.apps;
    }
    const out = await this.runPowershell(
      "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty ProcessName | Sort-Object -Unique"
    );
    const apps = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 8);
    this.appsCache = { apps, at: now };
    return apps;
  }

  private async gpuInfo(): Promise<{ name: string; util: number | null }> {
    const now = Date.now();
    if (this.gpuCache && now - this.gpuCache.at < 15000) {
      return { name: this.gpuCache.name, util: this.gpuCache.util };
    }
    const nv = await this.runPowershell(
      "if (Test-Path 'C:\\Windows\\System32\\nvidia-smi.exe') { & nvidia-smi --query-gpu=utilization.gpu,name --format=csv,noheader }"
    );
    let name = "UNKNOWN GPU";
    let util: number | null = null;
    if (nv.trim()) {
      const [u, n] = nv.trim().split(",").map((s) => s.trim());
      const parsed = parseInt(u, 10);
      util = Number.isFinite(parsed) ? parsed : null;
      name = n || "NVIDIA GPU";
    } else {
      const wmi = await this.runPowershell(
        "Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name"
      );
      if (wmi.trim()) name = wmi.trim().split(/\r?\n/)[0];
    }
    this.gpuCache = { name, util, at: now };
    return { name, util };
  }

  private networkState(): { connected: boolean; iface: string } {
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      const internals = addrs || [];
      if (internals.some((a) => !a.internal && a.address)) {
        return { connected: true, iface: name };
      }
    }
    return { connected: false, iface: "NONE" };
  }

  private gb(bytes: number): string {
    return (bytes / 1024 ** 3).toFixed(0) + " GB";
  }

  private async storageInfo(): Promise<{ total: string; free: string } | null> {
    const out = await this.runPowershell(
      "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Where-Object { $_.DeviceID -eq 'C:' } | ForEach-Object { '{0}|{1}' -f $_.FreeSpace, $_.Size }"
    );
    const line = out.trim().split(/\r?\n/)[0];
    if (!line) return null;
    const [free, total] = line.split("|").map((s) => parseFloat(s));
    if (!Number.isFinite(free) || !Number.isFinite(total)) return null;
    return { total: this.gb(total), free: this.gb(free) };
  }

  private async collectAndBroadcastStats(): Promise<void> {
    const [apps, gpu, storage] = await Promise.all([this.activeApps(), this.gpuInfo(), this.storageInfo()]);
    const net = this.networkState();
    this.broadcast("system_stats", {
      cpu: this.cpuUsage(),
      mem: this.memUsage(),
      gpu: gpu.util,
      gpuName: gpu.name,
      network: net.connected ? "CONNECTED" : "OFFLINE",
      networkIface: net.iface,
      activeApps: apps,
      storage: storage ? { total: storage.total, free: storage.free } : null,
    });
  }

  start(): Promise<void> {
    const config = getConfig();
    return new Promise((resolve) => {
      this.httpServer.listen(config.server.port, config.server.host, () => {
        getLogger().info("server", `JARVIS running at http://${config.server.host}:${config.server.port}`);
        this.startSystemStats();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.stopSystemStats();
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.close();
    }
    this.options.backgroundTasks.stopAll();
    this.wss.close();
    await new Promise((r) => this.httpServer.close(r));
  }
}