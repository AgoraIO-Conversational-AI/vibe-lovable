# Voice AI Agent — One-Stop Lovable Prompt

> **Copy everything below the line and paste it into a new Lovable project.**
> After Lovable builds the app, add your secrets when prompted and click **Connect**.

---

## Prompt (paste this into Lovable)

Build me a real-time Voice AI Agent using Agora Conversational AI. The app should let a user click "Connect" to start a voice conversation with an AI assistant, see a live visualizer orb, chat transcript, mute/unmute, and an "End" button to hang up.

### Architecture

**Frontend** — React + Vite + Tailwind + TypeScript (Lovable default stack)
**Backend** — Three Supabase Edge Functions (Deno):
1. `check-env` — validates required secrets are configured
2. `start-agent` — generates Agora channel, optional tokens, calls Agora ConvoAI API to start the agent, returns connection details
3. `hangup-agent` — calls Agora API to stop the agent

### Required Secrets (add via Lovable Cloud → Secrets)

| Secret | Description | Where to get it |
|--------|-------------|-----------------|
| `AGORA_APP_ID` | 32-char hex App ID | [Agora Console](https://console.agora.io) → Project → App ID |
| `AGORA_AUTH_HEADER` | `Basic <base64>` of `customerKey:customerSecret` | Agora Console → RESTful API → Customer ID/Secret, base64 encode `key:secret`, prefix with `Basic ` |
| `LLM_API_KEY` | OpenAI API key (or compatible) | [OpenAI Platform](https://platform.openai.com/api-keys) |
| `TTS_VENDOR` | One of: `rime`, `openai`, `elevenlabs`, `cartesia` | Your TTS provider |
| `TTS_KEY` | API key for your TTS vendor | Your TTS provider dashboard |
| `TTS_VOICE_ID` | Voice ID (e.g. `astra` for Rime, `alloy` for OpenAI) | Provider docs |

**Optional secrets:**
| Secret | Description |
|--------|-------------|
| `AGORA_APP_CERTIFICATE` | Enables token auth (leave unset for App ID-only auth during development) |
| `LLM_URL` | Custom LLM endpoint (defaults to `https://api.openai.com/v1/chat/completions`) |
| `LLM_MODEL` | Model name (defaults to `gpt-4o-mini`) |

### Edge Function: `check-env`

```typescript
// supabase/functions/check-env/index.ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requiredVars = [
    "AGORA_APP_ID",
    "AGORA_AUTH_HEADER",
    "LLM_API_KEY",
    "TTS_VENDOR",
    "TTS_KEY",
    "TTS_VOICE_ID",
  ];

  const optionalVars = ["AGORA_APP_CERTIFICATE"];

  const configured: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const v of requiredVars) {
    const isSet = !!Deno.env.get(v);
    configured[v] = isSet;
    if (!isSet) missing.push(v);
  }

  for (const v of optionalVars) {
    configured[v] = !!Deno.env.get(v);
  }

  return new Response(
    JSON.stringify({ configured, ready: missing.length === 0, missing }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
```

### Edge Function: `start-agent`

```typescript
// supabase/functions/start-agent/index.ts
import { RtcTokenBuilder, RtcRole } from "npm:agora-access-token@2.0.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AGENT_UID = "100";
const USER_UID = "101";

function generateChannel(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function buildToken(channelName: string, uid: number, appId: string, appCertificate: string): string {
  const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 86400;
  return RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, RtcRole.PUBLISHER, privilegeExpiredTs);
}

function buildTtsConfig(vendor: string, key: string, voiceId: string) {
  switch (vendor) {
    case "openai":
      return { vendor: "openai", params: { api_key: key, model: "tts-1", voice: voiceId, response_format: "pcm", speed: 1.0 } };
    case "elevenlabs":
      return { vendor: "elevenlabs", params: { key, model_id: "eleven_flash_v2_5", voice_id: voiceId, stability: 0.5, sample_rate: 24000 } };
    case "rime":
      return { vendor: "rime", params: { api_key: key, speaker: voiceId, modelId: "mistv2", lang: "eng", samplingRate: 16000, speedAlpha: 1.0 } };
    case "cartesia":
      return { vendor: "cartesia", params: { api_key: key, model_id: "sonic-3", sample_rate: 24000, voice: { mode: "id", id: voiceId } } };
    default:
      return { vendor, params: { api_key: key, voice: voiceId } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const AGORA_APP_ID = Deno.env.get("AGORA_APP_ID") || "";
    const AGORA_APP_CERTIFICATE = Deno.env.get("AGORA_APP_CERTIFICATE") || "";
    const AGORA_AUTH_HEADER = Deno.env.get("AGORA_AUTH_HEADER") || "";
    const LLM_API_KEY = Deno.env.get("LLM_API_KEY") || "";
    const LLM_MODEL = Deno.env.get("LLM_MODEL") || "gpt-4o-mini";
    const LLM_URL = Deno.env.get("LLM_URL") || "https://api.openai.com/v1/chat/completions";
    const TTS_VENDOR = Deno.env.get("TTS_VENDOR") || "rime";
    const TTS_KEY = Deno.env.get("TTS_KEY") || "";
    const TTS_VOICE_ID = Deno.env.get("TTS_VOICE_ID") || "astra";

    let prompt = "You are a friendly voice assistant. Keep responses concise, around 10 to 20 words. Be helpful and conversational.";
    let greeting = "Hi there! How can I help you today?";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.prompt) prompt = body.prompt;
        if (body.greeting) greeting = body.greeting;
      } catch { /* use defaults */ }
    }

    const channel = generateChannel();

    let userToken: string;
    let agentToken: string;
    if (AGORA_APP_CERTIFICATE) {
      userToken = buildToken(channel, Number(USER_UID), AGORA_APP_ID, AGORA_APP_CERTIFICATE);
      agentToken = buildToken(channel, Number(AGENT_UID), AGORA_APP_ID, AGORA_APP_CERTIFICATE);
    } else {
      userToken = "";
      agentToken = "";
    }

    const agentRtmUid = `${AGENT_UID}-${channel}`;
    const ttsConfig = buildTtsConfig(TTS_VENDOR, TTS_KEY, TTS_VOICE_ID);

    const payload = {
      name: channel,
      properties: {
        channel,
        token: agentToken,
        agent_rtc_uid: AGENT_UID,
        agent_rtm_uid: agentRtmUid,
        remote_rtc_uids: ["*"],
        enable_string_uid: false,
        idle_timeout: 120,
        advanced_features: { enable_bhvs: true, enable_rtm: true, enable_aivad: true, enable_sal: false },
        llm: {
          url: LLM_URL, api_key: LLM_API_KEY,
          system_messages: [{ role: "system", content: prompt }],
          greeting_message: greeting, failure_message: "Sorry, something went wrong",
          max_history: 32, params: { model: LLM_MODEL }, style: "openai",
        },
        vad: { silence_duration_ms: 300 },
        asr: { vendor: "ares", language: "en-US" },
        tts: ttsConfig,
        parameters: { transcript: { enable: true, protocol_version: "v2", enable_words: false } },
      },
    };

    const agoraUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/join`;
    const agoraRes = await fetch(agoraUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AGORA_AUTH_HEADER },
      body: JSON.stringify(payload),
    });

    const responseBody = await agoraRes.text();
    if (!agoraRes.ok) {
      return new Response(responseBody, { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const agoraData = JSON.parse(responseBody);
    return new Response(
      JSON.stringify({
        appId: AGORA_APP_ID, channel, token: userToken || null,
        uid: USER_UID, agentUid: AGENT_UID, agentRtmUid,
        agentId: agoraData.agent_id || agoraData.id, success: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message, success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

### Edge Function: `hangup-agent`

```typescript
// supabase/functions/hangup-agent/index.ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const AGORA_APP_ID = Deno.env.get("AGORA_APP_ID") || "";
    const AGORA_AUTH_HEADER = Deno.env.get("AGORA_AUTH_HEADER") || "";
    const { agentId } = await req.json();

    if (!agentId) {
      return new Response(JSON.stringify({ error: "agentId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/agents/${agentId}/leave`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: AGORA_AUTH_HEADER } });
    const data = await res.text();
    return new Response(data, { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
```

### Frontend Implementation

**Install dependency:** `agora-rtc-sdk-ng`

**Hook: `useAgoraVoiceClient`** — manages RTC client lifecycle:
- Dynamic imports `agora-rtc-sdk-ng` (browser-only)
- Creates RTC client with `mode: "rtc"`, `codec: "vp8"`
- Joins channel with `client.join(appId, channel, token, uid)` where `token` can be `null` for App ID-only auth
- Creates microphone audio track with `high_quality_stereo`, AEC, ANS, AGC enabled
- Publishes audio track
- Listens for `user-published` / `user-unpublished` / `user-left` events to track agent audio
- Monitors remote audio volume to detect agent speaking state
- Exposes: `isConnected`, `isMuted`, `isAgentSpeaking`, `agentState`, `messages`, `localAudioTrack`, `joinChannel`, `leaveChannel`, `toggleMute`, `setMessages`

**Hook: `useAudioVisualization`** — creates real-time frequency data from the local audio track using Web Audio API `AnalyserNode` for the waveform display.

**Component: `VoiceClient`** — full-page UI with three states:
1. **Loading** — checks env via `check-env` edge function
2. **Missing config** — shows which secrets are missing
3. **Pre-connection** — centered orb, Connect button, collapsible settings for custom system prompt and greeting
4. **Connected** — split layout: left column has pulsing agent visualizer orb (scales/pulses when agent is talking), mute button, audio waveform bars; right column has chat message list with user/assistant bubbles, text input. Header shows channel name, timer, and End button. Mobile layout collapses to single column with compact status bar.

The Connect flow:
1. Call `start-agent` edge function with optional prompt/greeting
2. Receive `appId`, `channel`, `token` (null if no certificate), `uid`, `agentUid`, `agentRtmUid`, `agentId`
3. Add greeting message to chat
4. Call `joinChannel()` with the connection config
5. On disconnect, call `leaveChannel()` then `hangup-agent` with the `agentId`

### Key Technical Details

- **Token handling:** If `AGORA_APP_CERTIFICATE` is not set, the edge function returns `token: null` and the client passes `null` to `client.join()` — this is correct for App ID-only auth (no certificate enabled in Agora Console)
- **If you enable App Certificate in Agora Console,** add the `AGORA_APP_CERTIFICATE` secret and the edge function will auto-generate proper tokens
- **UIDs are fixed:** agent = 100, user = 101
- **Channel names** are random 10-char alphanumeric strings
- **TTS vendors supported:** rime (default), openai, elevenlabs, cartesia — each has vendor-specific config mapping
- **The `AGORA_AUTH_HEADER`** must be the full header value: `Basic <base64(customerKey:customerSecret)>`

### supabase/config.toml additions

Make sure all three edge functions have JWT verification disabled:

```toml
[functions.check-env]
verify_jwt = false

[functions.start-agent]
verify_jwt = false

[functions.hangup-agent]
verify_jwt = false
```

### Quick Start After Build

1. Enable Lovable Cloud on the project
2. Add the 6 required secrets (see table above)
3. Click Connect — you should hear the AI greet you
4. Talk to it! The AI responds in real-time voice

### Generating the AGORA_AUTH_HEADER

In your browser console or terminal:
```javascript
btoa("YOUR_CUSTOMER_KEY:YOUR_CUSTOMER_SECRET")
// Then set AGORA_AUTH_HEADER to: Basic <that_output>
```

Get Customer Key/Secret from: Agora Console → RESTful API tab.

### Reference

Based on the [Agora Conversational AI Agent Samples](https://github.com/AgoraIO-Conversational-AI/agent-samples) — see `AGENT.md` for the full API reference.
