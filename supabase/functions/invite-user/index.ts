// Edge Function: inviter en ny admin-bruger til AFSENDERENS egen butik.
// Kører server-side med service_role-noeglen -- den ligger ALDRIG i browser-koden.
//
// Kaldes fra butik-redigering.html med den loggede-ind brugers egen session (Authorization-header).
// Tjekker at kalderen selv er admin, sender en invitations-mail via Supabase Auth, og opretter
// den tilhoerende raekke i "brugere" med samme butik_id som kalderen.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const INVITE_REDIRECT_URL = Deno.env.get("INVITE_REDIRECT_URL");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Mangler login." }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: "Ugyldig login-session." }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerBruger, error: callerBrugerErr } = await adminClient
      .from("brugere")
      .select("butik_id, rolle")
      .eq("id", caller.id)
      .single();

    if (callerBrugerErr || !callerBruger || callerBruger.rolle !== "admin") {
      return new Response(JSON.stringify({ error: "Kun admin-brugere kan invitere andre." }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "Mangler email." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      INVITE_REDIRECT_URL ? { redirectTo: INVITE_REDIRECT_URL } : undefined,
    );

    if (inviteErr) {
      return new Response(JSON.stringify({ error: inviteErr.message }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const newUserId = inviteData.user.id;

    const { error: insertErr } = await adminClient
      .from("brugere")
      .insert({ id: newUserId, butik_id: callerBruger.butik_id, rolle: "admin" });

    if (insertErr) {
      return new Response(
        JSON.stringify({ error: "Bruger inviteret, men kunne ikke kobles til butik: " + insertErr.message }),
        { status: 500, headers: corsHeaders },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
