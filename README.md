# <img src="https://www.agora.io/en/wp-content/uploads/2024/01/Agora-logo-horizantal.svg" alt="Agora" width="120" style="vertical-align: middle;" /> Simple Connect — Voice AI Agent

A minimal React + Supabase app that connects to an Agora Conversational AI agent
with real-time voice and text chat. Click **Connect**, talk, and see live
transcripts appear in the chat panel.

## Features

- **Real-time Voice** — Full-duplex audio via Agora RTC with echo cancellation,
  noise suppression, and auto gain control
- **Live Transcripts** — User and agent speech appears in the chat window as it
  happens (via RTC stream-message)
- **Text Chat** — Type a message and send it to the agent via Agora RTM
- **Agent Visualizer** — Pulsing orb shows when the agent is speaking
- **Customizable** — Set a custom system prompt and greeting before connecting
- **Serverless Backend** — Three Supabase Edge Functions handle token generation,
  agent start, and hangup

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set Supabase secrets

```bash
supabase secrets set \
  APP_ID=<your-app-id> \
  APP_CERTIFICATE=<your-app-certificate> \
  AGENT_AUTH_HEADER="Basic <base64(customerKey:customerSecret)>" \
  LLM_API_KEY=<your-openai-key> \
  TTS_VENDOR=rime \
  TTS_KEY=<your-tts-key> \
  TTS_VOICE_ID=astra
```

### 3. Deploy edge functions

```bash
supabase functions deploy check-env
supabase functions deploy start-agent
supabase functions deploy hangup-agent
```

### 4. Run the app

```bash
npm run dev
```

Open the app, click **Connect**, and start talking.

## Architecture

```
Browser (React + Vite)
  │
  ├─ RTC audio ←→ Agora Conversational AI Agent
  ├─ RTC stream-message ← agent transcripts
  └─ RTM publish → text messages to agent

Supabase Edge Functions (Deno)
  ├─ check-env      — validates required secrets
  ├─ start-agent    — generates RTC+RTM tokens, calls Agora ConvoAI API
  └─ hangup-agent   — stops the agent
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_ID` | Yes | 32-char hex App ID from [Agora Console](https://console.agora.io) |
| `APP_CERTIFICATE` | Yes | App Certificate (enables token auth for RTC + RTM) |
| `AGENT_AUTH_HEADER` | Yes | `Basic <base64(customerKey:customerSecret)>` for the REST API |
| `LLM_API_KEY` | Yes | OpenAI API key (or compatible provider) |
| `TTS_VENDOR` | Yes | `rime`, `openai`, `elevenlabs`, or `cartesia` |
| `TTS_KEY` | Yes | API key for your TTS vendor |
| `TTS_VOICE_ID` | Yes | Voice ID (e.g. `astra` for Rime, `alloy` for OpenAI) |
| `LLM_URL` | No | Custom LLM endpoint (defaults to OpenAI) |
| `LLM_MODEL` | No | Model name (defaults to `gpt-4o-mini`) |

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase Edge Functions (Deno)
- **Real-time:** agora-rtc-sdk-ng (voice), agora-rtm (text messaging)

## Reference

- [Agora Conversational AI Docs](https://docs.agora.io/en/conversational-ai/overview/product-overview)
- [Agora Console](https://console.agora.io)
- [Agent Samples](https://github.com/AgoraIO-Conversational-AI/agent-samples)

## License

MIT
