# JARVIS BUILD STATE

Tracked by the JARVIS build. Updated as work progresses.

## Status: IMPLEMENTED — live on free tier (Groq + Fish Audio) with Iron Man HUD + Serious Mode

> **NOTE (rate limits):** Groq Free's daily quota is currently exhausted — the 429
> "tokens per day (TPD) / rate limit reached / not enough tokens" toast and the `I couldn't complete that…`
> fallback both reflect that. The 200k/day budget (LLM + STT via the same Groq key) resets
> automatically on the daily window; see the Groq console → Usage page for the exact reset time
> (currently ~999d per usage page; Groq free tier TPD typically resets daily at midnight UTC).
> Voice and text share that budget, so an exhausted quota "kills" the mic too — it recovers
> by itself once the window rolls over.
>
> Token economy applied 2026-09-11: `LLM_MAX_TOKENS` 4096→1024 (config.ts/.env/.env.example),
> LLM SDK `maxRetries:0` + 60s timeout, plus a 30s provider-stall guard with capped backoff in
> `chatStream` so a stalled/rate-limited Groq replies gracefully instead of hanging.

## Architecture (as built)

```
USER (HUD frontend)
  ├─ text_input ──────────────┐
  └─ mic audio → STT (Whisper)┘
        STRING STREAM
        ↓
   src/agent/turnManager.ts   (unified entry point)
        ↓
   src/agent/orchestrator.ts  (agent loop: plan → tool → observe → verify)
        ├─ src/agent/llm.ts           (OpenAI-compatible adapter; baseURL → Groq)
        ├─ src/tools/registry.ts      (tool registry + permission gate)
        ├─ src/tools/categories/*     (39 tools)
        └─ src/memory/store.ts        (layered persistent memory)
        ↓
   response text → src/voice/tts.ts   (Fish Audio custom voice, Edge fallback)
        ↓
   src/ui/server.ts (WebSocket → HUD: reactor core, live system stats, transcript, TTS audio)
```

Both voice and text enter `TurnManager.processTurn()` — a single pipeline.

## Implemented subsystems

1. Core architecture (modular TS, DI-friendly, structured types via zod)
2. Unified conversation engine (working memory carries context across turns)
3. Agent loop with tool execution, retry-once recovery, verification, cancellation
4. 39 tools across system/apps/files/web/clipboard/windows/media/developer/vision/memory/research
5. Layered memory (working / user_profile / project / episodic), JSON-persisted,
   all operations (add/update/delete/search/list/clear) with human-readable files
6. Streaming voice: per-sentence TTS (Fish Audio `s2.1-pro-free` custom voice,
   auto-fallback to Edge TTS) pushed to HUD; push-to-talk STT via WebSocket;
   VAD barge-in interrupts TTS and cancels generation
7. Background task manager with cancel, progress events, concurrency limit
8. Permission gating (risk 0 auto, 2+ confirmation) with HUD confirm modal
9. Iron Man HUD: circular reactor core (equalizer rings + orbiting particles,
   state-driven speed/amplitude), live system stats (CPU/MEM/GPU/network/active
   apps/storage via `system_stats` every 4s), conversation rail, waveform
   equalizer mirroring mic input and JARVIS audio, push-to-talk dock
10. Serious mode (NEW): red alert HUD theme (`SERIOUS` dock toggle → `mode.serious`),
    `deep_research` continuous multi-round web research (background task, LLM-refined
    queries, per-iteration progress, findings persisted to episodic memory),
    `stop_research`, and `export_to_google_docs` (formatted markdown to clipboard +
    opens a new Google Doc via docs.google.com/document/create + saves `research/*.md`)
11. Tests: 34 passing (memory, tools, agent, background, TTS, turns)
12. Integration verified live: text → Groq `openai/gpt-oss-20b` → Fish Audio MP3;
    mode toggle broadcast; deep_research loop runs until stopped (correctly reports
    "cancelled")

## Key decisions

- `TurnManager` is the single conversation entry; server never short-circuits.
- Tool results are structured JSON fed back as tool messages (no output parsing).
- Confirmation is promise-based: orchestrator holds a pending request resolved by
  the HUD over WS; race-order fixed by registering the promise before emitting.
- WS message routing uses `isBinary` flag (node ws delivers text as Buffer).
- Memory "remember" works without an API key (local extraction).
- Missing `OPENAI_API_KEY` → graceful error message, server still boots.
- LLM tool params converted from zod via `zod-to-json-schema` (OpenAI target).

## Test matrix

| Area | Tests | Status |
| --- | --- | --- |
| Memory add/update/search/delete/persist/clear/trivia-filter | 8 | PASS |
| Tools valid/invalid/timeout/failure/confirmation | 8 | PASS |
| Agent simple/tool/multi-step/danger-confirm/retry/cancel | 6 | PASS |
| BackgroundTaskManager complete/fail/cancel/progress | 4 | PASS |
| TTS sentence splitting + state | 6 | PASS |
| TurnManager unified pipeline / context carry | 2 | PASS |
| TypeScript strict compile | — | PASS |

## Serious mode — verified live (server on :3000)

- `set_mode` WS → `mode_change` broadcast (hello reports `mode: normal|serious`); HUD
  applies red CSS + canvas palette on `body.mode-serious`
- "research the history of optical telescopes" (serious mode) → `deep_research`
  started a background task; LLM-refined queries (Iteration 1..n), distinct-source
  dedup, per-iteration `background_update` progress (7% → 23% → …), episodic-memory
  persistence
- `stop` halts the task → final update + "Background task cancelled" notification
- Export flow verified live: "stop + export … into a Google Doc" → `stop_research` (stopped 1)
  then `export_to_google_docs` (exported 4 findings/4 sources, wrote
  `research/<topic>.md`, clipboard filled, docs.google.com/document/create opened)
- Descriptions tightened so the model calls `export_to_google_docs` for compile/export
  requests instead of re-starting `deep_research`

## Verified end-to-end (live server on :3000)

- Health endpoint + HUD html/css/js served
- WS: text_input → `message_delta`/`message_final` (Groq `openai/gpt-oss-20b`) → `tts_audio` (Fish Audio MP3)
- WS: `system_stats` stream (CPU 9% / MEM 24% / GPU RTX 3080 6% / NETWORK CONNECTED / active apps / storage)
- Memory persisted to disk across restarts
- 34 tests pass, `tsc --noEmit` clean

## Markdown transcript rendering (2026-09-19)

- `hud.js` renders `**bold**` / `*italic*` via safe `renderMarkdown()` (escapes everything else);
  applied to final messages AND live streamed deltas (raw-buffer re-render)
- System prompt `<formatting>` rule: no stage-direction asterisks, plain prose, real `**bold**` only
- Verified: model emits `**Bold**` at sentence starts; transcript shows actual bold

## Weather tool + home location (2026-09-19)

- `get_weather` tool (web.ts) via Open-Meteo (keyless): temp, feels-like, condition, humidity, wind;
  defaults to home coords
- Config `location` block (name/lat/lon; `.env`/`.env.example`/config.ts defaults = Guam 13.4443,144.7937)
- System prompt `<location>` block: "weather without a place = use get_weather directly"
- Verified live: "What's the weather like?" → auto-fires tool → real Guam conditions

## Public (cloud) deploy prep (2026-09-19)

- Password gate: `AUTH_PIN` env enables login screen (`/login`) + `jarvis_session` cookie;
  gates `/`, `/assets/*` (302 → /login), rejects unauthenticated WebSocket upgrades. Local `.env`
  keeps `AUTH_PIN` empty → auth off for localhost. Verified: 302/401 flows + WS gate E2E on :3939
- Host bind default `0.0.0.0` (schema, `.env.example`); local `.env` still `HOST=localhost`
- `Dockerfile` (node:22-alpine, npm ci → tsc build → node dist) + `render.yaml` (free web plan,
  healthCheckPath `/health`, full env list) + `.dockerignore`/`.gitignore` + `.env.cloud.example`
- `dist/` build verified (`npm run build` → `node dist/index.js` startable)
- NOTE: PC-control tools (launcher, files, PowerShell, app stats, GPU) are Windows-only and will
  fail gracefully on Linux cloud hosts; chat/weather/memory/research work remotely. For full
  PC control from another device, add Cloudflare Named Tunnel to the local Windows box instead.
- Pending: user creates Render/Railway account, sets env vars (AUTH_PIN, OPENAI_API_KEY, FISH_*),
  connects GitHub repo (or `railway up`), deploys.

## Remaining / known items

- Groq is the active provider (free tier); OpenAI/AIML keys exist but have $0 balance.
- Wake-word (browser-based) is configured but not yet engaging — push-to-talk and
  barge-in work. Voice activity gate + wake detection left for HUD layer.
- Vision "screen analysis" requires a vision-capable model; screenshot capture
  tool implemented (PowerShell), analysis path uses the LLM model.
- Developer `set_volume` opens sound settings (no native safe volume API in
  PowerShell without an external tool) — noted, not a placeholder.
- Windows `close_application` uses Stop-Process (level 2, confirmation required).

## How to run

```bash
npm install
copy .env.example .env   # set OPENAI_API_KEY (Groq key), LLM_BASE_URL, FISH_AUDIO_*
npm run dev              # http://localhost:3000
```

Shortcuts: hold Space to talk (release to send), press `/` or click the
conversation to open the command line, Esc to interrupt. Dock controls: `STOP`,
`VOICE`, `SETTINGS`, `RESET` (clears in-memory conversation context via
`clear_context`, verified workingMemory 1 → 0), and a mode dropdown
(`NORMAL` / `SERIOUS`). In serious mode,
ask JARVIS to "research <topic>" to start continuous research; "stop researching"
halts it; "put the research into a Google Doc" exports it (paste with Ctrl+V in the
new doc).