import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, PATCH, OPTIONS","Content-Type":"application/json"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: corsHeaders});

async function context(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Error("Authorization required");
  const token = authorization.replace(/^Bearer\s+/i, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "", {global:{headers:{Authorization: authorization}}});
  const {data:{user},error:userError} = await supabase.auth.getUser(token);
  if (userError || !user) throw new Error("Invalid or expired session");
  const {data:profile,error:profileError} = await supabase.from("metabolic_profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.status !== "ACTIVE") throw new Error("LIVYA account is not active");
  return {supabase,user,profile};
}

const adminClient = () => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!key) throw new Error("Server admin key is not configured");
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", key, {auth:{autoRefreshToken:false,persistSession:false}});
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:corsHeaders});
  try {
    const {supabase,user,profile} = await context(req);
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/functions\/v1\/metabolic-api/, "").replace(/^\/+/, "");
    if (route === "me" || route === "") return json({user:{id:user.id,email:user.email},profile});
    if (route === "clients" && req.method === "GET") {
      const {data,error} = await supabase.from("metabolic_clients").select("*").order("full_name",{ascending:true});
      if (error) throw error; return json({data});
    }
    if (route === "dashboard" && req.method === "GET") {
      const [a,b,c,d] = await Promise.all([
        supabase.from("metabolic_clients").select("id",{count:"exact",head:true}),
        supabase.from("metabolic_reports").select("id",{count:"exact",head:true}),
        supabase.from("metabolic_checkins").select("id",{count:"exact",head:true}),
        supabase.from("metabolic_notes").select("id",{count:"exact",head:true})
      ]);
      for (const r of [a,b,c,d]) if (r.error) throw r.error;
      return json({clients:a.count??0,reports:b.count??0,checkins:c.count??0,notes:d.count??0});
    }
    if (route === "client-account" && req.method === "POST") {
      if (profile.role !== "ADMIN") return json({error:"Administrator access required"},403);
      const body = await req.json();
      const clientId = String(body.clientId||""); const email = String(body.email||"").trim().toLowerCase(); const password = String(body.password||"");
      if (!clientId || !email || password.length < 8) return json({error:"clientId, email and a password of at least 8 characters are required"},400);
      const admin = adminClient();
      const {data:row,error:rowError} = await admin.from("metabolic_clients").select("id,full_name,email,phone,client_user_id").eq("id",clientId).single();
      if (rowError) throw rowError;
      let userId = row.client_user_id;
      if (!userId) {
        const {data:created,error} = await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:row.full_name,role:"CLIENT"}});
        if (error) throw error; userId = created.user?.id;
      } else {
        const {error} = await admin.auth.admin.updateUserById(userId,{email,password}); if (error) throw error;
      }
      if (!userId) throw new Error("Supabase Auth user was not created");
      const {error:profileError} = await admin.from("metabolic_profiles").upsert({user_id:userId,full_name:row.full_name,role:"CLIENT",phone:row.phone||"",job_title:"Client",status:"ACTIVE"},{onConflict:"user_id"});
      if (profileError) throw profileError;
      const {error:linkError} = await admin.from("metabolic_clients").update({client_user_id:userId,email}).eq("id",clientId);
      if (linkError) throw linkError;
      return json({ok:true,userId,clientId});
    }
    if (route === "client-account" && req.method === "PATCH") {
      if (profile.role !== "ADMIN") return json({error:"Administrator access required"},403);
      const body = await req.json(); const userId = String(body.userId||""); const status = String(body.status||"ACTIVE").toUpperCase();
      if (!userId || !["ACTIVE","INACTIVE"].includes(status)) return json({error:"userId and valid status are required"},400);
      const admin = adminClient(); const {error} = await admin.from("metabolic_profiles").update({status}).eq("user_id",userId); if (error) throw error;
      const {error:authError} = await admin.auth.admin.updateUserById(userId,{ban_duration:status==="INACTIVE"?"876000h":"none"}); if (authError) throw authError;
      return json({ok:true,userId,status});
    }
    return json({error:"Route not found"},404);
  } catch (error) { console.error(error); return json({error:error instanceof Error?error.message:"Unexpected server error"},500); }
});
