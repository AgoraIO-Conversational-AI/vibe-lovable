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
    "APP_ID",
    "APP_CERTIFICATE",
    "AGENT_AUTH_HEADER",
    "LLM_API_KEY",
    "TTS_VENDOR",
    "TTS_KEY",
    "TTS_VOICE_ID",
  ];

  const optionalVars: string[] = [];

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
    JSON.stringify({
      configured,
      ready: missing.length === 0,
      missing,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
