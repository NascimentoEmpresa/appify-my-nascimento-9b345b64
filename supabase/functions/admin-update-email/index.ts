// Edge Function: admin-update-email
// Troca o e-mail de login de um usuário (admin only). Atualiza auth.users
// (autoridade real do login) e public.profiles.email (cópia usada pelo
// resto do app) juntos, pra não ficarem dessincronizados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Não autenticado" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Sessão inválida" }, 401);
    }
    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: podeEditar, error: roleErr } = await admin.rpc("can_access", {
      _user: callerId,
      _menu: "administracao",
      _acao: "alterar",
    });
    if (roleErr) return jsonResponse({ error: roleErr.message }, 500);
    if (!podeEditar) return jsonResponse({ error: "Apenas administradores podem alterar o e-mail de outro usuário." }, 403);

    let body: { user_id?: string; new_email?: string };
    try { body = await req.json(); }
    catch { return jsonResponse({ error: "JSON inválido" }, 400); }

    const targetId = (body.user_id ?? "").trim();
    const novoEmail = normalizeEmail(body.new_email);

    if (!targetId) return jsonResponse({ error: "user_id obrigatório" }, 400);
    if (!novoEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)) {
      return jsonResponse({ error: "E-mail inválido" }, 400);
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(targetId, {
      email: novoEmail,
      email_confirm: true,
    });
    if (updErr) {
      const status = /already|registered|exists|duplic/i.test(updErr.message) ? 409 : 400;
      return jsonResponse({ error: updErr.message }, status);
    }

    const { error: profErr } = await admin
      .from("profiles")
      .update({ email: novoEmail })
      .eq("id", targetId);
    if (profErr) {
      return jsonResponse({
        error: `E-mail de login atualizado, mas falhou ao sincronizar profiles.email: ${profErr.message}`,
      }, 207);
    }

    return jsonResponse({ ok: true, email: novoEmail });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});
