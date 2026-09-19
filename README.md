# J.A.R.V.I.S. — Just A Rather Very Intelligent System

An original, agentic personal-computer AI assistant. It understands, plans, acts,
observes, verifies, remembers, and reports — all through a single conversation
pipeline that accepts both voice and text input.

## Requirements

- Node.js 20+ (Node 24 LTS recommended)
- An OpenAI API key (`OPENAI_API_KEY`) for the LLM and speech-to-text
- Voice output uses Edge TTS (Microsoft) — no API key required

## Setup

```bash
npm install
copy .env.example .env       # then fill in OPENAI_API_KEY
npm run dev                  # development (tsx watch)
npm run build && npm start   # production
```

Open the HUD at http://localhost:3000

## Features

- **Unified conversation engine** — text and voice route through the same agent
  pipeline. Follow-ups, corrections, pronouns, and multi-turn tasks work because
  working memory carries context between turns.
- **Agent loop** — the orchestrator plans, calls tools, inspects results, retries
  failures, verifies completion, then responds. It never claims an action
  succeeded without observing the result.
- **34 built-in tools** across system, applications, files, web, clipboard,
  windows, media, developer, vision, memory and research. Tools return structured
  results (no terminal-output parsing by the LLM).
- **Layered persistent memory** — working memory (conversation context), user
  profile, project memory, and episodic memory. "remember X" works even before an
  API key is configured.
- **Permissions** — risk-level gating (0–3). Level 2+ actions require explicit
  authorisation; the HUD shows a confirmation dialog.
- **Streaming voice** — responses are split into sentences, synthesised, and
  streamed to the HUD while the model continues generating. Push-to-talk mic
  input with VAD-based barge-in that interrupts JARVIS mid-speech.
- **Background tasks** — long-running research/processing runs in the background;
  status can be queried and cancelled.
- **Observability** — structured, secret-free logging with per-operation timing
  (tools, TTS, turns).

## Commands (in the HUD)

- Hold **TALK** (or hold Space) to speak. Release when done.
- Type in the text box and press Enter / Send.
- A confirmation dialog appears for actions that need authorisation.
- Interrupt the assistant at any time by speaking (barge-in) or pressing Escape.

## Client messages (WebSocket)

| Message | Direction | Purpose |
| --- | --- | --- |
| `text_input` | UI → server | Submit a text turn |
| `audio_start` / `audio_chunk` / `audio_end` | UI → server | Stream mic audio for STT |
| `interrupt` / `stop` | UI → server | Barge-in / cancel everything |
| `confirm` | UI → server | Resolve an authorisation request |
| `state`, `status`, `transcript` | server → UI | Live state and transcript |
| `message_delta`, `message_final` | server → UI | Streaming and final text |
| `tool_call`, `tool_result` | server → UI | Live tool activity |
| `tts_audio`, `tts_state` | server → UI | Sentence audio for playback |
| `confirmation` | server → UI | Authorisation prompt |
| `notification` | server → UI | Priority notifications |
| `background_update` | server → UI | Background task progress |
| `get_memory`, `memory_delete`, `memory_clear` | UI → server | Memory management |
| `get_state`, `get_tasks`, `cancel_task` | UI → server | Diagnostics |

See `.env.example` for all configuration options.

## Testing

```bash
npm test
```

34 tests covering memory, tools, permissions/confirmation, the agent loop
(multi-step tasks, retry, cancellation, dangerous-tool authorisation),
background tasks, TTS sentence splitting, and the unified turn pipeline.