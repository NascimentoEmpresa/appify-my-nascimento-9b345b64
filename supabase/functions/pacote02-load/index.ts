// Edge function: carga das tabelas de staging do Pacote 02.
// Apenas administradores autenticados podem executar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sql as sqlA } from "./sql_A_mapa_fin.ts";
import { sql as sqlB } from "./sql_B_bancos.ts";
import { sql as sqlC } from "./sql_C_sugestoes.ts";
import { sql as sqlD } from "./sql_D_pendencias.ts";
import { sql as sqlE } from "./sql_E_plano.ts";
import { sql as sqlF } from "./sql_F_orcamento.ts";
import { sql as sqlG } from "./sql_G_aprovacao.ts";
import { sql as sqlH } from "./sql_H_recon_logs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STEPS: { name: string; sql: string; cleanup?: string }[] = [
  { name: "stg_mapa_de_para_contabil_financeiro", cleanup: "DELETE FROM public.stg_mapa_de_para_contabil_financeiro;", sql: sqlA },
  { name: "stg_mapa_de_para_bancos_pacote02",      cleanup: "DELETE FROM public.stg_mapa_de_para_bancos_pacote02;",      sql: sqlB },
  { name: "stg_sugestoes_novas_contas",            cleanup: "DELETE FROM public.stg_sugestoes_novas_contas;",            sql: sqlC },
  { name: "stg_pendencias_de_para",                cleanup: "DELETE FROM public.stg_pendencias_de_para;",                sql: sqlD },
  { name: "stg_plano_contas_proposto",             cleanup: "DELETE FROM public.stg_plano_contas_proposto;",             sql: sqlE },
  { name: "stg_mapa_de_para_orcamento_contratos",  cleanup: "DELETE FROM public.stg_mapa_de_para_orcamento_contratos;",  sql: sqlF },
  { name: "stg_aprovacao_contas",                  cleanup: "DELETE FROM public.stg_aprovacao_contas;",                  sql: sqlG },
  { name: "stg_reconciliacao_pacotes_e_logs",      sql: sqlH },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Sessão inválida" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: podeCarregar, error: roleErr } = await admin.rpc("can_access", { _user: u.user.id, _menu: "administracao", _acao: "alterar" });
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!podeCarregar) return json({ error: "Apenas administradores" }, 403);

    const results: Record<string, { ok: boolean; error?: string }> = {};
    for (const step of STEPS) {
      try {
        if (step.cleanup) {
          const { error: delErr } = await admin.rpc("admin_exec_dml", { p_sql: step.cleanup });
          if (delErr) throw delErr;
        }
        const { error } = await admin.rpc("admin_exec_dml", { p_sql: step.sql });
        if (error) throw error;
        results[step.name] = { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results[step.name] = { ok: false, error: msg };
      }
    }

    // Contagem final
    const tables = [
      "stg_mapa_de_para_contabil_financeiro",
      "stg_mapa_de_para_bancos_pacote02",
      "stg_sugestoes_novas_contas",
      "stg_pendencias_de_para",
      "stg_plano_contas_proposto",
      "stg_mapa_de_para_orcamento_contratos",
      "stg_aprovacao_contas",
      "stg_reconciliacao_pacotes",
      "stg_logs_processamento",
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const { count } = await admin.from(t).select("*", { count: "exact", head: true });
      counts[t] = count ?? 0;
    }
    return json({ ok: true, results, counts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
