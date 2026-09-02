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
  } catch (_) {}
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
  if (!profile || profile.status !== "ACTIVE") throw new Response("LIVYA account is not active", { status: 403 });
  return { supabase, user, profile };
}

function adminClient() {
  const key = adminKey();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url || !key) throw new Error("Server admin key is not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function requireAdmin(profile: any) {
  if (profile.role !== "ADMIN" || profile.status !== "ACTIVE") {
    throw new Response("Administrator access required", { status: 403 });
  }
}

const PERMISSION_KEYS = [
  "clients.view", "clients.manage",
  "reports.view", "reports.manage",
  "checkins.view", "checkins.manage",
  "notes.view", "notes.manage",
  "programs.view", "programs.manage",
  "diet.view", "diet.manage",
  "recipes.view", "recipes.manage",
  "files.view", "files.manage",
  "messages.view", "messages.manage",
  "audit.view",
];

function cleanPermissions(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const output: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) output[key] = source[key] === true;
  return output;
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

    if (route === "me" || route === "") return json({ user: { id: user.id, email: user.email }, profile });

    if (route === "clients" && req.method === "GET") {
      const { data, error } = await supabase.from("metabolic_clients").select("*").order("full_name", { ascending: true });
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
      return json({ clients: a.count ?? 0, reports: b.count ?? 0, checkins: c.count ?? 0, notes: d.count ?? 0 });
    }

    // ADMIN-only employee directory and provisioning. The browser never receives
    // a service key; all Auth admin operations happen in this trusted function.
    if (route === "staff" && req.method === "GET") {
      requireAdmin(profile);
      const admin = adminClient();
      const { data: profiles, error: profileError } = await admin
        .from("metabolic_profiles")
        .select("user_id,full_name,phone,job_title,role,status,created_at,updated_at")
        .in("role", ["ADMIN", "SUB_ADMIN"])
        .order("full_name");
      if (profileError) throw profileError;

      const ids = (profiles ?? []).map((p) => p.user_id);
      const { data: permissions, error: permissionError } = ids.length
        ? await admin.from("metabolic_staff_permissions").select("user_id,permissions,updated_at").in("user_id", ids)
        : { data: [], error: null };
      if (permissionError) throw permissionError;
      const permissionMap = new Map((permissions ?? []).map((p) => [p.user_id, p.permissions ?? {}]));
      return json({ data: (profiles ?? []).map((p) => ({ ...p, permissions: permissionMap.get(p.user_id) ?? {} })) });
    }

    if (route === "staff" && req.method === "POST") {
      requireAdmin(profile);
      const body = await req.json();
      const fullName = String(body.fullName ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const phone = String(body.phone ?? "").trim();
      const jobTitle = String(body.jobTitle ?? "Staff").trim() || "Staff";
      const password = String(body.password ?? "");
      const permissions = cleanPermissions(body.permissions);
      if (!fullName || !email || password.length < 8) {
        return json({ error: "fullName, email and a password of at least 8 characters are required" }, 400);
      }

      const admin = adminClient();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: "SUB_ADMIN", job_title: jobTitle },
      });
      if (createError) throw createError;
      const userId = created.user?.id;
      if (!userId) throw new Error("Supabase Auth user was not created");

      const { error: profileError } = await admin.from("metabolic_profiles").insert({
        user_id: userId, full_name: fullName, phone, job_title: jobTitle, role: "SUB_ADMIN", status: "ACTIVE",
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(userId);
        throw profileError;
      }

      const { error: permissionError } = await admin.from("metabolic_staff_permissions").insert({
        user_id: userId, permissions,
      });
      if (permissionError) {
        await admin.auth.admin.deleteUser(userId);
        throw permissionError;
      }
      return json({ ok: true, userId });
    }

    if (route === "staff" && req.method === "PATCH") {
      requireAdmin(profile);
      const body = await req.json();
      const userId = String(body.userId ?? "");
      if (!userId || userId === user.id) return json({ error: "A different employee account is required" }, 400);

      const admin = adminClient();
      const { data: target, error: targetError } = await admin
        .from("metabolic_profiles").select("user_id,role").eq("user_id", userId).single();
      if (targetError) throw targetError;
      if (target.role === "ADMIN") return json({ error: "Administrator accounts cannot be changed here" }, 400);

      const updates: Record<string, unknown> = {};
      if (body.fullName != null) updates.full_name = String(body.fullName).trim();
      if (body.phone != null) updates.phone = String(body.phone).trim();
      if (body.jobTitle != null) updates.job_title = String(body.jobTitle).trim();
      if (body.status != null) {
        const status = String(body.status).toUpperCase();
        if (!["ACTIVE", "INACTIVE"].includes(status)) return json({ error: "Invalid staff status" }, 400);
        updates.status = status;
      }
      if (Object.keys(updates).length) {
        const { error } = await admin.from("metabolic_profiles").update(updates).eq("user_id", userId);
        if (error) throw error;
      }
      if (body.permissions != null) {
        const { error } = await admin.from("metabolic_staff_permissions").upsert(
          { user_id: userId, permissions: cleanPermissions(body.permissions), updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
        if (error) throw error;
      }
      if (body.password != null) {
        const password = String(body.password);
        if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) throw error;
      }
      if (body.status != null) {
        const status = String(body.status).toUpperCase();
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: status === "INACTIVE" ? "876000h" : "none" });
        if (error) throw error;
      }
      return json({ ok: true, userId });
    }

    if (route === "client-account" && req.method === "POST") {
      requireAdmin(profile);
      const body = await req.json();
      const clientId = String(body.clientId ?? "");
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!clientId || !email || password.length < 8) return json({ error: "clientId, email and a password of at least 8 characters are required" }, 400);

      const admin = adminClient();
      const { data: row, error: rowError } = await admin.from("metabolic_clients").select("id,full_name,email,phone,client_user_id").eq("id", clientId).single();
      if (rowError) throw rowError;
      let userId = row.client_user_id;
      if (!userId) {
        const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: row.full_name, role: "CLIENT" } });
        if (error) throw error;
        userId = created.user?.id;
      } else {
        const { error } = await admin.auth.admin.updateUserById(userId, { email, password });
        if (error) throw error;
      }
      if (!userId) throw new Error("Supabase Auth user was not created");
      const { error: profileError } = await admin.from("metabolic_profiles").upsert({ user_id: userId, full_name: row.full_name, role: "CLIENT", phone: row.phone || "", job_title: "Client", status: "ACTIVE" }, { onConflict: "user_id" });
      if (profileError) throw profileError;
      const { error: linkError } = await admin.from("metabolic_clients").update({ client_user_id: userId, email }).eq("id", clientId);
      if (linkError) throw linkError;
      return json({ ok: true, userId, clientId });
    }

    if (route === "client-account" && req.method === "PATCH") {
      requireAdmin(profile);
      const body = await req.json();
      const userId = String(body.userId ?? "");
      const status = String(body.status ?? "ACTIVE").toUpperCase();
      if (!userId || !["ACTIVE", "INACTIVE"].includes(status)) return json({ error: "userId and valid status are required" }, 400);
      const admin = adminClient();
      const { error } = await admin.from("metabolic_profiles").update({ status }).eq("user_id", userId);
      if (error) throw error;
      const { error: authError } = await admin.auth.admin.updateUserById(userId, { ban_duration: status === "INACTIVE" ? "876000h" : "none" });
      if (authError) throw authError;
      return json({ ok: true, userId, status });
    }

    return json({ error: "Route not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
});
