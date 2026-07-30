// Edge Function: admin-reset-password
// Reseta a senha de um usuário (admin only). Gera nova senha aleatória,
// atualiza em auth.users e marca profiles.must_change_password = true.

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

function gerarSenha(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
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

    const { data: podeResetar, error: roleErr } = await admin.rpc("can_access", {
      _user: callerId,
      _menu: "administracao",
      _acao: "alterar",
    });
    if (roleErr) return jsonResponse({ error: roleErr.message }, 500);
    if (!podeResetar) return jsonResponse({ error: "Apenas administradores podem resetar senhas." }, 403);

    let body: { user_id?: string };
    try { body = await req.json(); }
    catch { return jsonResponse({ error: "JSON inválido" }, 400); }

    const targetId = (body.user_id ?? "").trim();
    if (!targetId) return jsonResponse({ error: "user_id obrigatório" }, 400);

    const novaSenha = gerarSenha(12);

    const { error: updErr } = await admin.auth.admin.updateUserById(targetId, {
      password: novaSenha,
    });
    if (updErr) return jsonResponse({ error: updErr.message }, 400);

    const { error: profErr } = await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", targetId);
    if (profErr) {
      return jsonResponse({
        error: `Senha atualizada, mas falhou ao marcar troca obrigatória: ${profErr.message}`,
        password: novaSenha,
      }, 207);
    }

    return jsonResponse({ ok: true, password: novaSenha });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});
