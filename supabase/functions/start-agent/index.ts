// --- Agora token generation (v007) - no npm dependency needed ---

function packUint16(v: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, v, true);
  return buf;
}

function packUint32(v: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, v, true);
  return buf;
}

function packString(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s);
  return concat(packUint16(encoded.length), encoded);
}

function packMapUint32(map: Record<number, number>): Uint8Array {
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  const parts: Uint8Array[] = [packUint16(keys.length)];
  for (const k of keys) {
    parts.push(packUint16(k), packUint32(map[k]));
  }
  return concat(...parts);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

async function hmacSha256(key: Uint8Array | string, message: Uint8Array): Promise<Uint8Array> {
  const keyData = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return new Uint8Array(sig);
}

async function deflateAsync(data: Uint8Array): Promise<Uint8Array> {
  const ds = new CompressionStream("deflate");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(data);
  writer.close();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(...chunks);
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function buildToken(
  channelName: string,
  uid: string,
  appId: string,
  appCertificate: string
): Promise<string> {
  const issueTs = Math.floor(Date.now() / 1000);
  const expire = 86400;
  const salt = Math.floor(Math.random() * 99999999) + 1;

  // Signing key: HMAC chain
  let signing = await hmacSha256(packUint32(issueTs), new TextEncoder().encode(appCertificate));
  signing = await hmacSha256(packUint32(salt), signing);

  // Pack RTC service (type=1): type + privileges + channelName + uid
  const rtcPrivileges: Record<number, number> = {
    1: expire, // joinChannel
    2: expire, // publishAudioStream
  };
  const rtcPacked = concat(packUint16(1), packMapUint32(rtcPrivileges), packString(channelName), packString(uid));

  // Pack RTM service (type=2): type + privileges + userId
  const rtmPrivileges: Record<number, number> = { 1: expire }; // login
  const rtmPacked = concat(packUint16(2), packMapUint32(rtmPrivileges), packString(uid));

  // Signing info
  const signingInfo = concat(
    packString(appId),
    packUint32(issueTs),
    packUint32(expire),
    packUint32(salt),
    packUint16(2), // service count
    rtcPacked,
    rtmPacked
  );

  // Signature
  const signature = await hmacSha256(signing, signingInfo);

  // Final token: pack signature as length-prefixed bytes + signing info, then deflate
  const content = concat(packUint16(signature.length), signature, signingInfo);
  const compressed = await deflateAsync(content);
  return "007" + toBase64(compressed);
}

// --- Edge function ---

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

function buildTtsConfig(vendor: string, key: string, voiceId: string) {
  switch (vendor) {
    case "openai":
      return {
        vendor: "openai",
        params: {
          api_key: key,
          model: "tts-1",
          voice: voiceId,
          response_format: "pcm",
          speed: 1.0,
        },
      };
    case "elevenlabs":
      return {
        vendor: "elevenlabs",
        params: {
          key: key,
          model_id: "eleven_flash_v2_5",
          voice_id: voiceId,
          stability: 0.5,
          sample_rate: 24000,
        },
      };
    case "rime":
      return {
        vendor: "rime",
        params: {
          api_key: key,
          speaker: voiceId,
          modelId: "mistv2",
          lang: "eng",
          samplingRate: 16000,
          speedAlpha: 1.0,
        },
      };
    case "cartesia":
      return {
        vendor: "cartesia",
        params: {
          api_key: key,
          model_id: "sonic-3",
          sample_rate: 24000,
          voice: { mode: "id", id: voiceId },
        },
      };
    default:
      return {
        vendor: vendor,
        params: { api_key: key, voice: voiceId },
      };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const APP_ID = Deno.env.get("APP_ID") || "";
    const APP_CERTIFICATE = Deno.env.get("APP_CERTIFICATE") || "";
    const AGENT_AUTH_HEADER = Deno.env.get("AGENT_AUTH_HEADER") || "";
    const LLM_API_KEY = Deno.env.get("LLM_API_KEY") || "";
    const LLM_MODEL = Deno.env.get("LLM_MODEL") || "gpt-4o-mini";
    const LLM_URL =
      Deno.env.get("LLM_URL") ||
      "https://api.openai.com/v1/chat/completions";
    const TTS_VENDOR = Deno.env.get("TTS_VENDOR") || "rime";
    const TTS_KEY = Deno.env.get("TTS_KEY") || "";
    const TTS_VOICE_ID = Deno.env.get("TTS_VOICE_ID") || "astra";

    // Parse optional body
    let prompt =
      "You are a friendly voice assistant. Keep responses concise, around 10 to 20 words. Be helpful and conversational.";
    let greeting = "Hi there! How can I help you today?";

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.prompt) prompt = body.prompt;
        if (body.greeting) greeting = body.greeting;
      } catch {
        // No body or invalid JSON, use defaults
      }
    }

    const channel = generateChannel();

    // Token generation: real tokens if certificate exists, APP_ID otherwise
    let userToken = "";
    let agentToken = "";
    const hasCertificate = APP_CERTIFICATE && /^[0-9a-f]{32}$/i.test(APP_CERTIFICATE);

    if (hasCertificate) {
      userToken = await buildToken(channel, USER_UID, APP_ID, APP_CERTIFICATE);
      agentToken = await buildToken(channel, AGENT_UID, APP_ID, APP_CERTIFICATE);
    }

    const agentRtmUid = `${AGENT_UID}-${channel}`;
    const ttsConfig = buildTtsConfig(TTS_VENDOR, TTS_KEY, TTS_VOICE_ID);

    const payload = {
      name: channel,
      properties: {
        channel,
        token: agentToken || APP_ID,
        agent_rtc_uid: AGENT_UID,
        agent_rtm_uid: agentRtmUid,
        remote_rtc_uids: ["*"],
        enable_string_uid: false,
        idle_timeout: 120,
        advanced_features: {
          enable_bhvs: true,
          enable_rtm: true,
          enable_aivad: true,
          enable_sal: false,
        },
        llm: {
          url: LLM_URL,
          api_key: LLM_API_KEY,
          system_messages: [{ role: "system", content: prompt }],
          greeting_message: greeting,
          failure_message: "Sorry, something went wrong",
          max_history: 32,
          params: { model: LLM_MODEL },
          style: "openai",
        },
        vad: { silence_duration_ms: 300 },
        asr: { vendor: "ares", language: "en-US" },
        tts: ttsConfig,
        parameters: {
          transcript: {
            enable: true,
            protocol_version: "v2",
            enable_words: false,
          },
        },
      },
    };

    // Call Agora ConvoAI API
    const agoraRes = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/join`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: AGENT_AUTH_HEADER,
        },
        body: JSON.stringify(payload),
      }
    );

    const responseBody = await agoraRes.text();

    if (!agoraRes.ok) {
      return new Response(responseBody, {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agoraData = JSON.parse(responseBody);

    return new Response(
      JSON.stringify({
        appId: APP_ID,
        channel,
        token: userToken || APP_ID,
        uid: USER_UID,
        agentUid: AGENT_UID,
        agentRtmUid: agentRtmUid,
        agentId: agoraData.agent_id || agoraData.id,
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message, success: false }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
