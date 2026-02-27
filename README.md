# Voice AI Agent

A real-time voice AI agent powered by [Agora Conversational AI](https://www.agora.io/en/products/conversational-ai/), [OpenAI](https://platform.openai.com/) LLM, and your choice of TTS provider. Built with Vite + React + TypeScript + Supabase Edge Functions.

## Prerequisites

- Node.js 18+
- An [Agora](https://console.agora.io/) account with Conversational AI enabled
- An [OpenAI](https://platform.openai.com/) API key
- A TTS provider API key and voice ID (Rime, OpenAI, ElevenLabs, or Cartesia)
- A [Supabase](https://supabase.com/) project (free tier works)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/AgoraIO-Conversational-AI/vibe-lovable.git
cd vibe-lovable
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com/) and create a new project
2. Note your **Project ID**, **URL**, and **anon/public key** from Settings > API

### 3. Set Supabase secrets

```bash
npx supabase secrets set \
  APP_ID=<your_agora_app_id> \
  APP_CERTIFICATE=<your_agora_app_certificate> \
  LLM_API_KEY=<your_openai_api_key> \
  TTS_VENDOR=<rime|openai|elevenlabs|cartesia> \
  TTS_KEY=<your_tts_api_key> \
  TTS_VOICE_ID=<your_tts_voice_id>
```

Optional secrets:

- `AGENT_AUTH_HEADER` — override auth header (auto-generated from APP_ID + APP_CERTIFICATE by default)
- `LLM_URL` — defaults to `https://api.openai.com/v1/chat/completions`
- `LLM_MODEL` — defaults to `gpt-4o-mini`

### 4. Deploy edge functions

```bash
npx supabase link --project-ref <your_project_id>
npx supabase functions deploy start-agent
npx supabase functions deploy hangup-agent
npx supabase functions deploy check-env
```

### 5. Configure .env

Create `.env` in the project root:

```
VITE_SUPABASE_PROJECT_ID="<your_project_id>"
VITE_SUPABASE_PUBLISHABLE_KEY="<your_anon_key>"
VITE_SUPABASE_URL="https://<your_project_id>.supabase.co"
```

### 6. Run

```bash
npm run dev
```

Open http://localhost:8080

## Architecture

```
Browser (React + Agora RTC/RTM SDK)
  │
  ├── Supabase Edge Function: start-agent
  │     └── Agora ConvoAI API
  │
  ├── Agora RTC: audio (UID 100)
  │
  └── Agora RTM: text messaging
```

- **UID 100** — Agent audio
- **UID 101** — User

## Supabase Secrets Reference

| Secret              | Required | Description                                                         |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `APP_ID`            | Yes      | Agora App ID                                                        |
| `APP_CERTIFICATE`   | Yes      | Agora App Certificate (32-char hex, for token gen and API auth)     |
| `LLM_API_KEY`       | Yes      | OpenAI API key                                                      |
| `TTS_VENDOR`        | Yes      | TTS provider: `rime`, `openai`, `elevenlabs`, or `cartesia`         |
| `TTS_KEY`           | Yes      | TTS provider API key                                                |
| `TTS_VOICE_ID`      | Yes      | TTS voice ID (e.g. `astra` for Rime, `alloy` for OpenAI)            |
| `AGENT_AUTH_HEADER` | No       | Override auth header (auto-generated from APP_ID + APP_CERTIFICATE) |
| `LLM_URL`           | No       | LLM endpoint URL (default: OpenAI)                                  |
| `LLM_MODEL`         | No       | LLM model name (default: `gpt-4o-mini`)                             |
