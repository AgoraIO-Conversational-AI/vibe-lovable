import { RtcTokenBuilder, RtmTokenBuilder, RtcRole, RtmRole } from "npm:agora-access-token@2.0.4";

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

function buildToken(
  channelName: string,
  uid: number,
  appId: string,
  appCertificate: string
): string {
  const expirationTimeInSeconds = 86400;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const rtcToken = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs
  );

  return rtcToken;
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
    const AGORA_APP_ID = Deno.env.get("AGORA_APP_ID") || "";
    const AGORA_APP_CERTIFICATE = Deno.env.get("AGORA_APP_CERTIFICATE") || "";
    const AGORA_AUTH_HEADER = Deno.env.get("AGORA_AUTH_HEADER") || "";
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

    // Token generation
    let userToken: string;
    let agentToken: string;

    if (AGORA_APP_CERTIFICATE) {
      userToken = buildToken(channel, Number(USER_UID), AGORA_APP_ID, AGORA_APP_CERTIFICATE);
      agentToken = buildToken(channel, Number(AGENT_UID), AGORA_APP_ID, AGORA_APP_CERTIFICATE);
    } else {
      userToken = AGORA_APP_ID;
      agentToken = AGORA_APP_ID;
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
    const agoraUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/join`;
    
    console.log("=== AGORA REQUEST DEBUG ===");
    console.log("URL:", agoraUrl);
    console.log("AGORA_APP_ID:", AGORA_APP_ID);
    console.log("Auth header present:", !!AGORA_AUTH_HEADER);
    console.log("Auth header starts with:", AGORA_AUTH_HEADER.substring(0, 10) + "...");
    console.log("PAYLOAD:", JSON.stringify(payload, null, 2));
    
    const agoraRes = await fetch(agoraUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: AGORA_AUTH_HEADER,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await agoraRes.text();
    console.log("=== AGORA RESPONSE ===");
    console.log("Status:", agoraRes.status);
    console.log("Body:", responseBody);

    if (!agoraRes.ok) {
      return new Response(responseBody, {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agoraData = JSON.parse(responseBody);

    return new Response(
      JSON.stringify({
        appId: AGORA_APP_ID,
        channel,
        token: userToken,
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
