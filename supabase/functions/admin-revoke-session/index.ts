// Edge Function: admin-revoke-session
// Revoga uma sessão (auth.sessions) ou todas as sessões de um usuário.
// Apenas administradores podem chamar.

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

// Auditoria sensível (18/11/2026): esta função roda com service_role, então
// os gatilhos do banco gravam auth.uid() NULL ("Sistema"). Aqui fica registrado
// QUEM pediu, para a aba Configurações do ERP › Auditoria sensível. Falhar aqui
// não desfaz a ação — só perde o rastro (e avisa no log).
async function registrarAuditoria(
  admin: ReturnType<typeof createClient>,
  ator: string,
  acao: string,
  alvo: string,
  detalhes: Record<string, unknown> = {},
) {
  try {
    const { error } = await admin.rpc("auditoria_registrar_acao_admin", {
      _ator: ator, _acao: acao, _alvo: alvo, _detalhes: detalhes,
    });
    if (error) console.error("auditoria_registrar_acao_admin", acao, error.message);
  } catch (e) {
    console.error("auditoria_registrar_acao_admin", acao, e instanceof Error ? e.message : String(e));
  }
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
    if (userErr || !userData?.user) return jsonResponse({ error: "Sessão inválida" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: podeEncerrar, error: roleErr } = await admin.rpc("can_access", {
      _user: userData.user.id,
      _menu: "administracao",
      _acao: "alterar",
    });
    if (roleErr) return jsonResponse({ error: roleErr.message }, 500);
    if (!podeEncerrar) return jsonResponse({ error: "Apenas administradores." }, 403);

    let body: { user_id?: string };
    try { body = await req.json(); } catch { return jsonResponse({ error: "JSON inválido" }, 400); }
    const targetUser = (body.user_id ?? "").trim();
    if (!targetUser) return jsonResponse({ error: "user_id obrigatório" }, 400);

    // signOut('global') do usuário-alvo invalida todas as sessões dele
    const { error: signErr } = await admin.auth.admin.signOut(targetUser, "global");
    if (signErr) return jsonResponse({ error: signErr.message }, 400);

    await registrarAuditoria(admin, userData.user.id, "encerrar_sessao", targetUser);

    return jsonResponse({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});
