import { getConfig } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
  duration?: number;
}

class Logger {
  private minLevel: LogLevel;

  constructor() {
    this.minLevel = getConfig().logging.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private format(entry: LogEntry): string {
    const parts = [
      entry.timestamp,
      `[${entry.level.toUpperCase().padEnd(5)}]`,
      `[${entry.category}]`,
      entry.message,
    ];
    if (entry.duration !== undefined) {
      parts.push(`(${entry.duration.toFixed(1)}ms)`);
    }
    return parts.join(" ");
  }

  private log(level: LogLevel, category: string, message: string, data?: unknown, duration?: number) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
      duration,
    };

    const formatted = this.format(entry);

    switch (level) {
      case "error":
        console.error(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(category: string, message: string, data?: unknown) {
    this.log("debug", category, message, data);
  }

  info(category: string, message: string, data?: unknown) {
    this.log("info", category, message, data);
  }

  warn(category: string, message: string, data?: unknown) {
    this.log("warn", category, message, data);
  }

  error(category: string, message: string, data?: unknown) {
    this.log("error", category, message, data);
  }

  timer(category: string, label: string): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.info(category, label, { duration });
      return duration;
    };
  }
}

let _logger: Logger | null = null;

export function getLogger(): Logger {
  if (!_logger) _logger = new Logger();
  return _logger;
}
