import { randomBytes, timingSafeEqual } from "crypto";
import { getConfig } from "../shared/config.js";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Session {
  token: string;
  expires: number;
}

let sessions: Map<string, Session> = new Map();

export function isAuthEnabled(): boolean {
  return getConfig().server.authPin !== "";
}

function pinMatches(pin: string): boolean {
  const expected = getConfig().server.authPin;
  if (!expected) return true;
  const a = Buffer.from(expected);
  const b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSession(pin: string): string | null {
  if (!isAuthEnabled()) return null;
  if (!pinMatches(pin)) return null;
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { token, expires: Date.now() + SESSION_MS });
  return token;
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined | null): void {
  if (token) sessions.delete(token);
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === name && value) return value;
  }
  return null;
}

export function clearExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires < now) sessions.delete(token);
  }
}

setInterval(clearExpiredSessions, 60 * 60 * 1000).unref();