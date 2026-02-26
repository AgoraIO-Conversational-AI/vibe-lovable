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

## Secrets (Edge Functions)

Configure these as secrets in Lovable Cloud (or Supabase Edge Function secrets). All are server-side only — read via `Deno.env.get()`, never exposed to the browser.

**Required (no defaults):**

- `APP_ID` — Your Agora project App ID
- `AGENT_AUTH_HEADER` — Auth header for Agora Conversational AI API (e.g. `Basic <base64(customerKey:customerSecret)>`)
- `LLM_API_KEY` — API key for your LLM provider (e.g. OpenAI)
- `TTS_KEY` — API key for your TTS provider

**Optional (have defaults):**

- `APP_CERTIFICATE` — Agora App Certificate. **Default: empty (no token auth).** Leave unset or set to `""` if your Agora project does not use token authentication.
- `TTS_VENDOR` — Default: `rime`. Options: `rime`, `openai`, `elevenlabs`, `cartesia`
- `TTS_VOICE_ID` — Default: `astra`. Examples: `astra` (Rime), `alloy` (OpenAI)
- `LLM_URL` — Default: `https://api.openai.com/v1/chat/completions`
- `LLM_MODEL` — Default: `gpt-4o-mini`

```bash
supabase secrets set \
  APP_ID=your_agora_app_id \
  AGENT_AUTH_HEADER="Basic <base64(customerKey:customerSecret)>" \
  LLM_API_KEY=sk-your-openai-key \
  TTS_KEY=your-tts-api-key
```

## Implementation Details

### Edge Function: `check-env`

Validates the 4 required secrets (`APP_ID`, `AGENT_AUTH_HEADER`, `LLM_API_KEY`, `TTS_KEY`) are set. Optional vars (`APP_CERTIFICATE`, `TTS_VENDOR`, `TTS_VOICE_ID`, `LLM_URL`, `LLM_MODEL`) are reported but not required — `start-agent` provides defaults. Returns JSON:

```json
{ "configured": { "APP_ID": true, ... }, "ready": true, "missing": [] }
```

### Edge Function: `start-agent`

Accepts optional POST body `{ prompt, greeting }`. Defaults: prompt = "You are a friendly voice assistant. Keep responses concise, around 10 to 20 words." greeting = "Hi there! How can I help you today?"

**Token generation** — inline v007 token builder using Web Crypto + CompressionStream (no npm dependency). Generates combined RTC+RTM tokens when `APP_CERTIFICATE` is a valid 32-char hex string. When `APP_CERTIFICATE` is empty or not set, falls back to using `APP_ID` as the token value everywhere (required for RTM to work without certificate auth).

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
// Protocol v2 sends data as pipe-delimited base64 chunks: messageId|partIdx|partSum|base64data
// You MUST decode this format — raw JSON.parse() will NOT work.
const messageCache = new Map<string, { part_idx: number; content: string }[]>();

client.on("stream-message", (_uid: number, data: Uint8Array) => {
  try {
    const raw = new TextDecoder().decode(data);
    const parts = raw.split("|");

    let msg: any;
    if (parts.length === 4) {
      // v2 chunked format: messageId|partIdx|partSum|base64data
      const [msgId, partIdxStr, partSumStr, partData] = parts;
      const partIdx = parseInt(partIdxStr, 10);
      const partSum = partSumStr === "???" ? -1 : parseInt(partSumStr, 10);

      if (!messageCache.has(msgId)) messageCache.set(msgId, []);
      const chunks = messageCache.get(msgId)!;
      chunks.push({ part_idx: partIdx, content: partData });
      chunks.sort((a, b) => a.part_idx - b.part_idx);

      if (partSum === -1 || chunks.length < partSum) return; // wait for more chunks
      const base64 = chunks.map((c) => c.content).join("");
      msg = JSON.parse(atob(base64));
      messageCache.delete(msgId);
    } else if (raw.startsWith("{")) {
      msg = JSON.parse(raw); // fallback: raw JSON
    } else {
      return;
    }

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
      updateMessages(role, msg.turn_id, msg.text, isFinal);
    }
  } catch {
    /* ignore malformed data */
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

**Transcripts arrive via RTC `stream-message`, NOT via RTM.** Protocol v2 encodes data as `messageId|partIdx|partSum|base64data` — you MUST decode with `atob()` then `JSON.parse()`. Raw `JSON.parse()` on stream data will NOT work. Display as chat bubbles grouped by `turn_id`, update in-place for partials.

### Frontend: RTM Text Messaging (send only)

RTM is used **ONLY for sending text messages** from the user to the agent. Do NOT use `createStreamChannel`, `joinTopic`, `publishTopicMessage`, or `sendMessage`.

```typescript
const AgoraRTM = await import("agora-rtm");
const rtm = new AgoraRTM.default.RTM(appId, String(uid), {
  token: token ?? undefined,
} as any);
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

**RTM rules:** Target is `agentRtmUid` (e.g. `"100-{channel}"`), NOT the channel name. Message must be JSON `{ "message": "text", "priority": "APPEND" }` with options `{ customType: "user.transcription", channelType: "USER" }`. Show user message optimistically before sending. Never `console.log()` the RTM client object (circular refs crash).

### Frontend: UI Layout

**Pre-connection:** Centered orb, Connect button, collapsible settings panel for custom system prompt and greeting.

**Connected:** Split layout — left panel has animated pulsing orb (scales/glows when agent speaks), mute/unmute button, audio waveform bars (via Web Audio API AnalyserNode); right panel has scrolling chat messages with user/assistant bubbles, text input with send button. Header shows channel name, elapsed timer, and End button. Mobile collapses to single column.

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase Edge Functions (Deno)
- **Real-time:** agora-rtc-sdk-ng (voice), agora-rtm (text messaging)

## License

MIT
