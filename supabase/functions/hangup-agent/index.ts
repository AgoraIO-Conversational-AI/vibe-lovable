// --- Agora token generation (v007) - for auth header ---

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

  let signing = await hmacSha256(packUint32(issueTs), new TextEncoder().encode(appCertificate));
  signing = await hmacSha256(packUint32(salt), signing);

  const rtcPrivileges: Record<number, number> = { 1: expire, 2: expire, 3: expire, 4: expire };
  const rtcPacked = concat(packUint16(1), packMapUint32(rtcPrivileges), packString(channelName), packString(uid));

  const rtmPrivileges: Record<number, number> = { 1: expire };
  const rtmPacked = concat(packUint16(2), packMapUint32(rtmPrivileges), packString(uid));

  const signingInfo = concat(
    packString(appId),
    packUint32(issueTs),
    packUint32(expire),
    packUint32(salt),
    packUint16(2),
    rtcPacked,
    rtmPacked
  );

  const signature = await hmacSha256(signing, signingInfo);
  const content = concat(packUint16(signature.length), signature, signingInfo);
  const compressed = await deflateAsync(content);
  return "007" + toBase64(compressed);
}

async function buildAuthHeader(
  appId: string,
  appCertificate: string,
  agentAuthHeader: string
): Promise<string> {
  if (agentAuthHeader) return agentAuthHeader;
  const token = await buildToken("", "", appId, appCertificate);
  return `agora token=${token}`;
}

// --- Edge function ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const APP_ID = Deno.env.get("APP_ID") || "";
    const APP_CERTIFICATE = Deno.env.get("APP_CERTIFICATE") || "";
    const AGENT_AUTH_HEADER = Deno.env.get("AGENT_AUTH_HEADER") || "";

    const { agentId } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "agentId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/agents/${agentId}/leave`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await buildAuthHeader(APP_ID, APP_CERTIFICATE, AGENT_AUTH_HEADER),
      },
    });

    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
