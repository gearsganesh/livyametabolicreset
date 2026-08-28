import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2.95.0/cors";

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });

function firstConfiguredSecret(name: string, dictionaryName: string) {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  try {
    const dictionary = JSON.parse(Deno.env.get(dictionaryName) ?? "{}");
    if (typeof dictionary === "object" && dictionary) {
      const values = Object.values(dictionary).filter((value) => typeof value === "string" && value);
      return values[0] as string | undefined;
    }
  } catch (_) {
    // Fall through to the legacy environment variable names below.
  }
  return undefined;
}

function publishableKey() {
  return firstConfiguredSecret("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS")
    ?? Deno.env.get("SUPABASE_ANON_KEY")
    ?? "";
}

function adminKey() {
  return firstConfiguredSecret("SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

async function context(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Response("Authorization required", { status: 401 });

  const token = authorization.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = publishableKey();
  if (!url || !key) throw new Response("Supabase runtime configuration is incomplete", { status: 500 });

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) throw new Response("Invalid or expired session", { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("metabolic_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile || profile.status !== "ACTIVE") {
    throw new Response("LIVYA account is not active", { status: 403 });
  }

  return { supabase, user, profile };
}

function adminClient() {
  const key = adminKey();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url || !key) throw new Error("Server admin key is not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  console.error("[LIVYA metabolic-api]", error);
  return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { supabase, user, profile } = await context(req);
    const url = new URL(req.url);
    const route = url.pathname
      .replace(/^\/functions\/v1\/metabolic-api/, "")
      .replace(/^\/+/, "");

    if (route === "me" || route === "") {
      return json({ user: { id: user.id, email: user.email }, profile });
    }

    if (route === "clients" && req.method === "GET") {
      const { data, error } = await supabase
        .from("metabolic_clients")
        .select("*")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return json({ data });
    }

    if (route === "dashboard" && req.method === "GET") {
      const [a, b, c, d] = await Promise.all([
        supabase.from("metabolic_clients").select("id", { count: "exact", head: true }),
        supabase.from("metabolic_reports").select("id", { count: "exact", head: true }),
        supabase.from("metabolic_checkins").select("id", { count: "exact", head: true }),
        supabase.from("metabolic_notes").select("id", { count: "exact", head: true }),
      ]);
      for (const result of [a, b, c, d]) if (result.error) throw result.error;
      return json({
        clients: a.count ?? 0,
        reports: b.count ?? 0,
        checkins: c.count ?? 0,
        notes: d.count ?? 0,
      });
    }

    if (route === "client-account" && req.method === "POST") {
      if (profile.role !== "ADMIN") return json({ error: "Administrator access required" }, 403);

      const body = await req.json();
      const clientId = String(body.clientId ?? "");
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!clientId || !email || password.length < 8) {
        return json({ error: "clientId, email and a password of at least 8 characters are required" }, 400);
      }

      const admin = adminClient();
      const { data: row, error: rowError } = await admin
        .from("metabolic_clients")
        .select("id,full_name,email,phone,client_user_id")
        .eq("id", clientId)
        .single();
      if (rowError) throw rowError;

      let userId = row.client_user_id;
      if (!userId) {
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: row.full_name, role: "CLIENT" },
        });
        if (error) throw error;
        userId = created.user?.id;
      } else {
        const { error } = await admin.auth.admin.updateUserById(userId, { email, password });
        if (error) throw error;
      }

      if (!userId) throw new Error("Supabase Auth user was not created");

      const { error: profileError } = await admin.from("metabolic_profiles").upsert(
        {
          user_id: userId,
          full_name: row.full_name,
          role: "CLIENT",
          phone: row.phone || "",
          job_title: "Client",
          status: "ACTIVE",
        },
        { onConflict: "user_id" },
      );
      if (profileError) throw profileError;

      const { error: linkError } = await admin
        .from("metabolic_clients")
        .update({ client_user_id: userId, email })
        .eq("id", clientId);
      if (linkError) throw linkError;

      return json({ ok: true, userId, clientId });
    }

    if (route === "client-account" && req.method === "PATCH") {
      if (profile.role !== "ADMIN") return json({ error: "Administrator access required" }, 403);

      const body = await req.json();
      const userId = String(body.userId ?? "");
      const status = String(body.status ?? "ACTIVE").toUpperCase();
      if (!userId || !["ACTIVE", "INACTIVE"].includes(status)) {
        return json({ error: "userId and valid status are required" }, 400);
      }

      const admin = adminClient();
      const { error } = await admin
        .from("metabolic_profiles")
        .update({ status })
        .eq("user_id", userId);
      if (error) throw error;

      // Ban blocks future sign-ins. Existing sessions must also be rejected by
      // database RLS/profile checks; a client-side status flag is not security.
      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: status === "INACTIVE" ? "876000h" : "none",
      });
      if (authError) throw authError;

      return json({ ok: true, userId, status });
    }

    return json({ error: "Route not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
});
