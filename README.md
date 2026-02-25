# <img src="https://www.agora.io/en/wp-content/uploads/2024/01/Agora-logo-horizantal.svg" alt="Agora" width="120" style="vertical-align: middle;" /> Vibe Lovable — Voice AI Agent

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

See [Environment Variables](#environment-variables) below for the full list.

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

**IMPORTANT: All variables are server-side Supabase secrets only. They are read via `Deno.env.get()` in edge functions — never exposed to the browser. The app uses exactly these variable names.**

There are exactly 6 required and 3 optional variables. Do not invent additional variables.

```bash
supabase secrets set \
  APP_ID=your_32_char_hex_app_id \
  AGENT_AUTH_HEADER="Basic <base64(customerKey:customerSecret)>" \
  LLM_API_KEY=sk-your-openai-key \
  TTS_VENDOR=rime \
  TTS_KEY=your-tts-api-key \
  TTS_VOICE_ID=astra
# Optional:
# supabase secrets set APP_CERTIFICATE=your_32_char_hex_certificate
# supabase secrets set LLM_URL=https://api.openai.com/v1/chat/completions
# supabase secrets set LLM_MODEL=gpt-4o-mini
```

| Variable            | Required | Description                                                                         |
| ------------------- | -------- | ----------------------------------------------------------------------------------- |
| `APP_ID`            | Yes      | 32-char hex App ID from [Agora Console](https://console.agora.io)                   |
| `AGENT_AUTH_HEADER` | Yes      | `Basic <base64(customerKey:customerSecret)>` — Agora REST API auth                  |
| `LLM_API_KEY`       | Yes      | OpenAI API key (or compatible provider)                                             |
| `TTS_VENDOR`        | Yes      | One of: `rime`, `openai`, `elevenlabs`, `cartesia`                                  |
| `TTS_KEY`           | Yes      | API key for your chosen TTS vendor                                                  |
| `TTS_VOICE_ID`      | Yes      | Voice ID (e.g. `astra` for Rime, `alloy` for OpenAI, voice ID for ElevenLabs)       |
| `APP_CERTIFICATE`   | No       | App Certificate — enables token auth for RTC + RTM. Omit for testing without tokens |
| `LLM_URL`           | No       | Custom LLM endpoint (defaults to `https://api.openai.com/v1/chat/completions`)      |
| `LLM_MODEL`         | No       | Model name (defaults to `gpt-4o-mini`)                                              |

## Implementation Details

### Edge Function: `check-env`

Validates all 6 required env vars are set via `Deno.env.get()`. `APP_CERTIFICATE` is optional (reported but not required). Returns JSON:

```json
{ "configured": { "APP_ID": true, ... }, "ready": true, "missing": [] }
```

### Edge Function: `start-agent`

Accepts optional POST body `{ prompt, greeting }`. Defaults: prompt = "You are a friendly voice assistant. Keep responses concise, around 10 to 20 words." greeting = "Hi there! How can I help you today?"

**Token generation** — inline v007 token builder using Web Crypto + CompressionStream (no npm dependency). Generates combined RTC+RTM tokens when `APP_CERTIFICATE` is a valid 32-char hex string, otherwise falls back to using `APP_ID` as the token value (required for RTM to work without certificate auth). The algorithm: HMAC-SHA256 signing key chain (issueTs → appCertificate → salt), pack services as little-endian binary (RTC type=1 with joinChannel+publishAudio privileges, RTM type=2 with login privilege), HMAC-sign the packed info, deflate, base64, prefix with "007".

UIDs are strings: agent = `"100"`, user = `"101"`. Channel is random 10-char alphanumeric. Agent RTM UID = `"100-{channel}"`.

**Agent payload** — POST to `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appId}/join`:

```json
{
  "name": "{channel}",
  "properties": {
    "channel": "{channel}",
    "token": "{agentToken}",
    "agent_rtc_uid": "100",
    "agent_rtm_uid": "100-{channel}",
    "remote_rtc_uids": ["*"],
    "enable_string_uid": false,
    "idle_timeout": 120,
    "advanced_features": {
      "enable_bhvs": true,
      "enable_rtm": true,
      "enable_aivad": true,
      "enable_sal": false
    },
    "llm": {
      "url": "{LLM_URL or https://api.openai.com/v1/chat/completions}",
      "api_key": "{LLM_API_KEY}",
      "system_messages": [{ "role": "system", "content": "{prompt}" }],
      "greeting_message": "{greeting}",
      "failure_message": "Sorry, something went wrong",
      "max_history": 32,
      "params": { "model": "{LLM_MODEL or gpt-4o-mini}" },
      "style": "openai"
    },
    "vad": { "silence_duration_ms": 300 },
    "asr": { "vendor": "ares", "language": "en-US" },
    "tts": "{ttsConfig}",
    "parameters": {
      "transcript": {
        "enable": true,
        "protocol_version": "v2",
        "enable_words": false
      }
    }
  }
}
```

**TTS config builder** — supports multiple vendors:

- **rime** (default): `{ vendor: "rime", params: { api_key, speaker: voiceId, modelId: "mistv2", lang: "eng", samplingRate: 16000, speedAlpha: 1.0 } }`
- **openai**: `{ vendor: "openai", params: { api_key, model: "tts-1", voice: voiceId, response_format: "pcm", speed: 1.0 } }`
- **elevenlabs**: `{ vendor: "elevenlabs", params: { key, model_id: "eleven_flash_v2_5", voice_id: voiceId, stability: 0.5, sample_rate: 24000 } }`
- **cartesia**: `{ vendor: "cartesia", params: { api_key, model_id: "sonic-3", sample_rate: 24000, voice: { mode: "id", id: voiceId } } }`

Returns: `{ appId, channel, token, uid, agentUid, agentRtmUid, agentId, success }`

### Edge Function: `hangup-agent`

POST with `{ agentId }`. Calls `POST https://api.agora.io/api/conversational-ai-agent/v2/projects/{appId}/agents/{agentId}/leave` with `AGENT_AUTH_HEADER`.

### supabase/config.toml

All three functions need JWT verification disabled:

```toml
[functions.check-env]
verify_jwt = false

[functions.start-agent]
verify_jwt = false

[functions.hangup-agent]
verify_jwt = false
```

### Frontend: RTC Voice + Transcript Listener

Install `agora-rtc-sdk-ng` and `agora-rtm` from npm. Dynamically import both at connect time (browser-only SDKs).

**RTC setup — register `stream-message` listener BEFORE `client.join()`:**

```typescript
const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

// Subscribe to agent audio
client.on("user-published", async (user, mediaType) => {
  if (mediaType !== "audio") return;
  await client.subscribe(user, "audio");
  user.audioTrack?.play();
  // Poll user.audioTrack.getVolumeLevel() to detect agent speaking
});

// CRITICAL: Transcript listener — agent sends ALL transcripts via RTC data stream
client.on("stream-message", (_uid: number, data: Uint8Array) => {
  try {
    const text = new TextDecoder().decode(data);
    const msg = JSON.parse(text);
    // msg.object = "user.transcription" or "assistant.transcription"
    // msg.text = transcript text
    // msg.turn_id = groups messages into turns
    // For user: msg.final = true means end of utterance
    // For assistant: msg.turn_status === 1 means end of turn
    if (msg.object && msg.text !== undefined) {
      const role =
        msg.object === "assistant.transcription" ? "assistant" : "user";
      const isFinal =
        role === "user" ? msg.final === true : msg.turn_status === 1;
      // Update or add message in chat UI grouped by turn_id
      updateMessages(role, msg.turn_id, msg.text, isFinal);
    }
  } catch {
    /* ignore non-JSON data messages */
  }
});

await client.join(appId, channel, token, uid);
const audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
  encoderConfig: "high_quality_stereo",
  AEC: true,
  ANS: true,
  AGC: true,
});
await client.publish(audioTrack);
```

**IMPORTANT: Transcripts arrive via RTC `stream-message`, NOT via RTM.** Both user speech transcripts and agent response transcripts come through this single listener. The agent greeting also arrives here — do not hardcode it. Display transcripts as chat bubbles grouped by `turn_id`. Update in-place for partial transcripts, mark final when complete.

### Frontend: RTM Text Messaging (send only)

RTM is used **ONLY for sending text messages** from the user to the agent. Do NOT use `createStreamChannel`, `joinTopic`, `publishTopicMessage`, or `sendMessage`.

```typescript
const AgoraRTM = await import("agora-rtm");
const rtm = new AgoraRTM.default.RTM(appId, String(uid), {
  token: token ?? undefined,
});
await rtm.login(); // no arguments — token goes in constructor above

// Send text message — target is agent's RTM UID, NOT the channel name
const payload = JSON.stringify({ message: text, priority: "APPEND" });
await rtm.publish(agentRtmUid, payload, {
  customType: "user.transcription",
  channelType: "USER",
});

// Disconnect
await rtm.logout();
```

**IMPORTANT RTM rules:**

- Publish target is `agentRtmUid` (e.g. `"100-{channel}"`), NOT the channel name
- Message must be JSON: `{ "message": "text", "priority": "APPEND" }`
- Options must include `customType: "user.transcription"` and `channelType: "USER"`
- Show the user's message optimistically in the chat UI before sending
- Never `console.log()` the RTM client object — it causes `RangeError: Invalid string length` from circular references

### Frontend: UI Layout

**Pre-connection:** Centered orb, Connect button, collapsible settings panel for custom system prompt and greeting.

**Connected:** Split layout — left panel has animated pulsing orb (scales/glows when agent speaks), mute/unmute button, audio waveform bars (via Web Audio API AnalyserNode); right panel has scrolling chat messages with user/assistant bubbles, text input with send button. Header shows channel name, elapsed timer, and End button. Mobile collapses to single column.

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase Edge Functions (Deno)
- **Real-time:** agora-rtc-sdk-ng (voice), agora-rtm (text messaging)

## Reference

- [simple-backend](https://github.com/AgoraIO-Conversational-AI/agent-samples/tree/main/simple-backend) — Python reference implementation of the same token generation, start-agent, and hangup-agent logic used by the edge functions above
- [Agora Conversational AI Docs](https://docs.agora.io/en/conversational-ai/overview/product-overview)
- [Agora Console](https://console.agora.io)
- [Agent Samples](https://github.com/AgoraIO-Conversational-AI/agent-samples)

## License

MIT
