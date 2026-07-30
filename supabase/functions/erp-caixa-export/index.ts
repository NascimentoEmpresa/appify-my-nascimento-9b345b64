// Edge function: erp-caixa-export
// SEG-CAIXA-EXPORT-1 v3 — hardening.
// READ-ONLY. Exige JWT. Valida role (admin / controladoria / presidencia).
// Escopo multiempresa real: admin OR profiles.acessa_todas_empresas => global;
// caso contrário, escopo derivado de user_empresa + profiles.empresa_id +
// profiles.empresa_atual_id e validado por public.user_pode_atuar_empresa.
// service_role só é instanciado depois da validação do JWT, e dados de negócio
// só são consultados depois da autorização e resolução de escopo.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";

// deno-lint-ignore no-explicit-any
type AnyQuery = any;
type Row = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Colunas explícitas — sem select * em dados sensíveis.
const COLS_EMPRESAS = "id,codigo,razao_social,nome_fantasia,cnpj,ativa";
// conta_bancaria: removidos agencia, conta, digito, titular (PII bancária).
const COLS_CONTA_BANCARIA =
  "id,empresa_id,conta_contabil_id,banco_codigo,banco_nome,tipo,ativa";
const COLS_CONTA_CONTABIL =
  "id,empresa_id,conta_reduzida,classificacao,descricao,tipo,natureza,saldo_inicial,ativo";
const COLS_SALDOS_INICIAIS =
  "id,empresa_id,data_referencia,banco,categoria,descricao,valor,observacao,created_at,updated_at";
const COLS_AUD_PLANO =
  "conta_contabil_id,classificacao,descricao,categoria,tem_vinculo_real,pode_inativar_futuro,pode_zerar_saldo_futuro,trava_motivo,saldo_replicado_suspeito,banco_inferido,empresa_inferida_codigo,empresa_banco_inferida";
const COLS_MZ_CAIXA = [
  "mz_id",
  "id_fluxo",
  "id_lct",
  "id_origem",
  "fluxo",
  "data_caixa",
  "periodo_caixa",
  "tipo_movimento",
  "classificacao_original",
  "historico",
  "categoria_despesa",
  "competencia_original",
  "empresa",
  "centro_custo",
  "banco",
  "forma_pagamento",
  "valor",
  "valor_entrada",
  "valor_saida",
  "valor_liquido",
  "evento",
  "conta_banco_codigo",
  "conta_banco_nome",
  "conta_resultado_codigo",
  "conta_resultado_nome",
  "impacta_caixa",
  "impacta_dre_base",
  "classificacao_gerencial",
  "status_fluxo",
  "pendencia",
  "excluir_do_fluxo",
  "motivo_exclusao_fluxo",
  "created_at",
].join(",");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeLog(payload: Record<string, unknown>) {
  // Apenas metadata. Nunca logar Authorization, JWT, service_role, body ou stack do PostgREST.
  try {
    console.log(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

interface Scope {
  global: boolean;
  empresaIds: string[]; // vazio quando global
}

async function resolveScope(
  admin: SupabaseClient,
  callerId: string,
  isAdmin: boolean,
): Promise<Scope | { error: string; status: number }> {
  if (isAdmin) return { global: true, empresaIds: [] };

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("acessa_todas_empresas, empresa_id, empresa_atual_id")
    .eq("id", callerId)
    .maybeSingle();
  if (profErr) return { error: "scope_profile_error", status: 500 };

  const prof = (profile ?? {}) as Row;
  if (prof.acessa_todas_empresas === true) {
    return { global: true, empresaIds: [] };
  }

  const { data: ue, error: ueErr } = await admin
    .from("user_empresa")
    .select("empresa_id")
    .eq("user_id", callerId);
  if (ueErr) return { error: "scope_user_empresa_error", status: 500 };

  const set = new Set<string>();
  for (const row of (ue ?? []) as Row[]) {
    const empresaId = row?.empresa_id;
    if (typeof empresaId === "string" && empresaId) set.add(empresaId);
  }
  if (typeof prof.empresa_id === "string" && prof.empresa_id) {
    set.add(prof.empresa_id);
  }
  if (typeof prof.empresa_atual_id === "string" && prof.empresa_atual_id) {
    set.add(prof.empresa_atual_id);
  }

  if (set.size === 0) return { error: "sem_escopo_de_empresa", status: 403 };

  // Validação canônica por empresa via user_pode_atuar_empresa.
  const allowed: string[] = [];
  for (const empresaId of set) {
    const { data: ok, error: rpcErr } = await admin.rpc(
      "user_pode_atuar_empresa",
      { _user: callerId, _empresa: empresaId },
    );
    if (rpcErr) return { error: "scope_rpc_error", status: 500 };
    if (ok === true) allowed.push(empresaId);
  }
  if (allowed.length === 0) {
    return { error: "sem_escopo_de_empresa", status: 403 };
  }
  return { global: false, empresaIds: allowed };
}

async function pageAll(
  client: SupabaseClient,
  table: string,
  cols: string,
  apply?: (q: AnyQuery) => AnyQuery,
): Promise<Row[]> {
  const out: Row[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let q: AnyQuery = client
      .from(table)
      .select(cols)
      .order("id", { ascending: true })
      .range(from, from + step - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(table);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < step) break;
    from += step;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "caixa";

  try {
    // 1. Authorization obrigatória.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      safeLog({ ts: Date.now(), mode, status: 401, reason: "no_auth" });
      return json({ error: "unauthorized" }, 401);
    }

    // 2. Validação do JWT com ANON + Authorization (sem service_role).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      safeLog({ ts: Date.now(), mode, status: 401, reason: "invalid_jwt" });
      return json({ error: "unauthorized" }, 401);
    }
    const callerId = userData.user.id;

    // 3. service_role só agora — exclusivamente para autorização e dados autorizados.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 4. Validação de acesso: menu dedicado (não o "fluxo-caixa-diario" da tela
    // normal, que financeiro também usa) — este endpoint sempre foi restrito a
    // admin/controladoria/presidencia, nunca financeiro. Admin também define o
    // escopo global abaixo, verificado à parte via 'administracao'/alterar.
    const [exportCheck, adminCheck] = await Promise.all([
      admin.rpc("can_access", { _user: callerId, _menu: "caixa-export-consolidado", _acao: "exportar" }),
      admin.rpc("can_access", { _user: callerId, _menu: "administracao", _acao: "alterar" }),
    ]);
    if (exportCheck.error || adminCheck.error) {
      safeLog({
        ts: Date.now(),
        mode,
        callerId,
        status: 500,
        reason: "role_check_error",
      });
      return json({ error: "internal_error" }, 500);
    }
    const isAdmin = adminCheck.data === true;
    if (exportCheck.data !== true && !isAdmin) {
      safeLog({
        ts: Date.now(),
        mode,
        callerId,
        status: 403,
        reason: "no_role",
      });
      return json({ error: "forbidden" }, 403);
    }

    // 5. Resolução de escopo multiempresa.
    const scope = await resolveScope(admin, callerId, isAdmin);
    if ("error" in scope) {
      safeLog({
        ts: Date.now(),
        mode,
        callerId,
        status: scope.status,
        reason: scope.error,
      });
      return json({ error: scope.error }, scope.status);
    }

    safeLog({
      ts: Date.now(),
      mode,
      callerId,
      status: 200,
      n_empresas_escopo: scope.global ? "global" : scope.empresaIds.length,
      is_admin: isAdmin,
    });

    // 6. Dados — só após autorização e escopo resolvidos.
    if (mode === "refs") {
      const empresas = await pageAll(
        admin,
        "empresas",
        COLS_EMPRESAS,
        (q) => scope.global ? q : q.in("id", scope.empresaIds),
      );
      const codigosEmpresa = empresas
        .map((e: Row) => e.codigo)
        .filter((c: unknown): c is string =>
          typeof c === "string" && c.length > 0
        );

      const [contaBancaria, contaContabil, saldosIniciais, audPlano] =
        await Promise.all([
          pageAll(
            admin,
            "conta_bancaria",
            COLS_CONTA_BANCARIA,
            (q) => scope.global ? q : q.in("empresa_id", scope.empresaIds),
          ),
          pageAll(
            admin,
            "conta_contabil",
            COLS_CONTA_CONTABIL,
            (q) => scope.global ? q : q.in("empresa_id", scope.empresaIds),
          ),
          pageAll(
            admin,
            "saldos_iniciais_caixa",
            COLS_SALDOS_INICIAIS,
            (q) => scope.global ? q : q.in("empresa_id", scope.empresaIds),
          ),
          pageAll(
            admin,
            "aud_plano_contas_origem_diagnostico",
            COLS_AUD_PLANO,
            (q) => {
              let qq = q.eq("batch_id", "p3d-v33-lf-documentada");
              if (!scope.global) {
                if (codigosEmpresa.length === 0) {
                  qq = qq.eq("empresa_inferida_codigo", "__none__");
                } else {
                  qq = qq.in("empresa_inferida_codigo", codigosEmpresa);
                }
              }
              return qq;
            },
          ),
        ]);

      return json({
        empresas,
        conta_bancaria: contaBancaria,
        conta_contabil: contaContabil,
        saldos_iniciais_caixa: saldosIniciais,
        aud_plano: audPlano,
        scope: {
          global: scope.global,
          n_empresas: scope.global ? null : scope.empresaIds.length,
        },
      });
    }

    // mode=caixa
    const direcao = (url.searchParams.get("direcao") || "ENTRADA")
      .toUpperCase();
    const offset = Math.max(
      parseInt(url.searchParams.get("offset") || "0", 10) || 0,
      0,
    );
    const limit = Math.min(
      Math.max(
        parseInt(url.searchParams.get("limit") || "5000", 10) || 5000,
        1,
      ),
      10000,
    );
    const tipos = direcao === "ENTRADA"
      ? ["ENTRADA", "entrada"]
      : ["SAÍDA", "saida", "SAIDA"];

    // mz_40 não tem empresa_id — usa coluna texto "empresa". Para escopo
    // não-global, monta lista de identificadores (codigo, razao_social,
    // nome_fantasia) das empresas permitidas.
    let empresaFiltro: string[] | null = null;
    if (!scope.global) {
      const { data: emps, error: empErr } = await admin
        .from("empresas")
        .select("codigo,razao_social,nome_fantasia")
        .in("id", scope.empresaIds);
      if (empErr) {
        safeLog({
          ts: Date.now(),
          mode,
          callerId,
          status: 500,
          reason: "empresas_lookup_error",
        });
        return json({ error: "internal_error" }, 500);
      }
      const ids = new Set<string>();
      for (const e of (emps ?? []) as Row[]) {
        if (e.codigo) ids.add(String(e.codigo));
        if (e.razao_social) ids.add(String(e.razao_social));
        if (e.nome_fantasia) ids.add(String(e.nome_fantasia));
      }
      empresaFiltro = Array.from(ids);
      if (empresaFiltro.length === 0) {
        return json({ count: 0, rows: [], next: null });
      }
    }

    let q = admin
      .from("mz_40_fato_fluxo_caixa_realizado")
      .select(COLS_MZ_CAIXA, { count: "exact" })
      .in("impacta_caixa", ["SIM", "sim"])
      .in("tipo_movimento", tipos)
      .order("mz_id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (empresaFiltro) q = q.in("empresa", empresaFiltro);

    const { data, error, count } = await q;
    if (error) {
      safeLog({
        ts: Date.now(),
        mode,
        callerId,
        status: 500,
        reason: "caixa_query_error",
      });
      return json({ error: "internal_error" }, 500);
    }
    const got = data?.length ?? 0;
    const hasMore = got > 0 && got >= limit;
    return json({
      count,
      rows: data,
      next: hasMore ? offset + got : null,
      scope: {
        global: scope.global,
        n_empresas: scope.global ? null : scope.empresaIds.length,
      },
    });
  } catch (_e) {
    // Nunca expor stack/mensagem crua do PostgREST.
    safeLog({ ts: Date.now(), mode, status: 500, reason: "unhandled" });
    return json({ error: "internal_error" }, 500);
  }
});
