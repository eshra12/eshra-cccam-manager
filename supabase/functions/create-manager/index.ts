import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: authData, error: authError } =
      await userClient.auth.getUser();

    if (authError || !authData.user) {
      return json({ error: "Invalid session" }, 401);
    }

    const adminClient = createClient(url, serviceKey);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("role,is_active")
      .eq("id", authData.user.id)
      .single();

    if (!profile || profile.role !== "owner" || !profile.is_active) {
      return json({ error: "Owner permission required" }, 403);
    }

    const body = await req.json();

    const username = String(body.username || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return json({
        error: "Username must be 3-24 characters"
      }, 400);
    }

    if (password.length < 8) {
      return json({
        error: "Password must contain at least 8 characters"
      }, 400);
    }

    const email = `${username}@login.eshra-panel.invalid`;

    const { data: created, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

    if (createError || !created.user) {
      return json({
        error: createError?.message || "Could not create manager"
      }, 400);
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .insert({
        id: created.user.id,
        username,
        role: "manager",
        is_active: true
      });

    if (profileError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: profileError.message }, 400);
    }

    return json({ success: true, username });

  } catch (error) {
    return json({
      error: error instanceof Error
        ? error.message
        : "Unexpected error"
    }, 500);
  }
});
