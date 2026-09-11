// Edge Function: admin-delete-user
// Exclui completamente um usuário: vínculos + profiles + auth.users
// Apenas admins podem chamar. Impede auto-exclusão.
//
// A limpeza dos vínculos NÃO é mais uma lista fixa de tabelas aqui dentro.
// Quem faz é a RPC public.admin_excluir_usuario_completo (migration
// 20260930000083), que varre pg_constraint em tempo de execução e zera/apaga
// tudo que aponta pro usuário antes de apagar o perfil. Motivo, em resumo:
// deletar o perfil direto disparava gatilho de auditoria que INSERIA linha nova
// apontando pro perfil que estava sendo apagado (plano_acao_historico), e a FK
// estourava no fim do comando. Detalhe completo no cabeçalho da migration.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Não autenticado" }, 401);
    }

    // Valida sessão do chamador
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Sessão inválida" }, 401);
    }
    const callerId = userData.user.id;

    // Cliente admin com service_role (ignora RLS)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Verifica se chamador pode excluir usuários
    const { data: podeExcluir, error: roleErr } = await admin.rpc("can_access", {
      _user: callerId,
      _menu: "administracao",
      _acao: "excluir",
    });
    if (roleErr) return jsonResponse({ error: roleErr.message }, 500);
    if (!podeExcluir) {
      return jsonResponse({ error: "Apenas administradores podem excluir usuários." }, 403);
    }

    // Lê body
    let body: { user_id?: string };
    try { body = await req.json(); }
    catch { return jsonResponse({ error: "JSON inválido" }, 400); }

    const targetId = (body.user_id ?? "").trim();
    if (!targetId) return jsonResponse({ error: "user_id obrigatório" }, 400);

    // Impede que o admin exclua a si mesmo
    if (targetId === callerId) {
      return jsonResponse({ error: "Você não pode excluir sua própria conta." }, 400);
    }

    // 1) Limpa vínculos + remove o perfil, numa transação só (a RPC).
    const { data: relatorio, error: eRpc } = await admin.rpc(
      "admin_excluir_usuario_completo",
      { p_user_id: targetId },
    );

    if (eRpc) {
      // Migration 20260930000083 ainda não aplicada no projeto remoto:
      // cai no caminho antigo, que resolve o caso simples (usuário sem
      // vínculo em módulo de negócio).
      const semRpc = eRpc.code === "PGRST202" || /does not exist/i.test(eRpc.message ?? "");
      if (!semRpc) {
        return jsonResponse({ error: `Erro ao remover vínculos: ${eRpc.message}` }, 500);
      }

      const { error: e1 } = await admin.from("user_roles").delete().eq("user_id", targetId);
      if (e1) return jsonResponse({ error: `Erro ao remover perfis: ${e1.message}` }, 500);

      const { error: e2 } = await admin.from("user_empresa").delete().eq("user_id", targetId);
      if (e2) return jsonResponse({ error: `Erro ao remover vínculos de empresa: ${e2.message}` }, 500);

      const { error: e3 } = await admin.from("profiles").delete().eq("id", targetId);
      if (e3) {
        return jsonResponse({
          error:
            `Erro ao remover perfil: ${e3.message}. ` +
            "A migration 20260930000083 (exclusão de usuário sem bloqueio de FK) " +
            "ainda não foi aplicada no SQL Editor do Supabase.",
        }, 500);
      }
    }

    // 2) Remove da autenticação (auth.users) — requer service_role
    // "User not found" = perfil órfão sem conta auth, não é erro — dados já foram limpos acima
    const { error: e4 } = await admin.auth.admin.deleteUser(targetId);
    if (e4 && !/not.found/i.test(e4.message)) {
      return jsonResponse({ error: `Erro ao remover autenticação: ${e4.message}` }, 500);
    }

    // `falhas` só vem preenchido se algum gatilho de guarda barrou uma tabela;
    // o perfil já saiu, mas o admin precisa saber que sobrou resíduo.
    const falhas = (relatorio as { falhas?: unknown[] } | null)?.falhas ?? [];
    return jsonResponse({ ok: true, relatorio, avisos: falhas });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});
