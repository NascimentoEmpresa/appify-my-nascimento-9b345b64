import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mesDaDespesaNaBase, type BaseDespesa, type LinhaFluxoCusto } from "./regras";

// SIS-2026-0708: o período dos custos é a competência do lançamento (não a data do pagamento).
// SIS-2026-0556: custos do período para a Lucratividade e o Faturamento da
// Empresa. Em vez de baixar o Fluxo de Caixa inteiro (6 views, ~20 mil linhas,
// ~16 MB), pede a cada view só as SAÍDAS do período com contrato, só as 6
// colunas necessárias. Paginado em blocos de 1000 (limite do PostgREST) com
// desempate.
const TAMANHO_PAGINA = 1000;
const FONTES: { view: string; ordem: string[] }[] = [
  { view: "v_malote_pagamento_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_debito_automatico_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_cartao_fatura_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_resgate_fluxo_caixa", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_fluxo_caixa_importado_fluxo_caixa", ordem: ["despesa_id", "linha_id"] },
];

function proximoMes(anoMes: string): string {
  const [a, m] = anoMes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

// [de, ate): datas "YYYY-MM-DD", fim exclusivo.
// SIS-2026-0642: `semContrato` busca as despesas administrativas (saídas sem contrato) em vez dos custos de contrato.
// SIS-2026-0721: `base` escolhe a coluna do período (competência ou data de pagamento) e já deixa em cada linha o mês em que ela conta.
async function buscarView(view: string, ordem: string[], de: string, ate: string, semContrato = false, base: BaseDespesa = "competencia"): Promise<LinhaFluxoCusto[]> {
  const linhas: LinhaFluxoCusto[] = [];
  for (let pagina = 0; ; pagina++) {
    let q = (supabase as any)
      .from(view)
      .select("tipo, data_pagamento, competencia, contrato_id, empresa_id, classificacao_id, classificacao_nome, valor, id_malote, descricao")
      .eq("tipo", "saida")
      // SIS-2026-0708: o período é o da COMPETÊNCIA; só a linha sem competência cai pelo mês do pagamento.
      // SIS-2026-0721: na base "data de pagamento", o período é o do pagamento.
      .or(base === "pagamento"
        ? `and(data_pagamento.gte.${de},data_pagamento.lt.${ate})`
        : `and(competencia.gte.${de},competencia.lt.${ate}),and(competencia.is.null,data_pagamento.gte.${de},data_pagamento.lt.${ate})`);
    q = semContrato ? q.is("contrato_id", null) : q.not("contrato_id", "is", null);
    for (const col of ordem) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
    if (error) throw error;
    linhas.push(...((data ?? []) as LinhaFluxoCusto[]).map((l) => ({ ...l, mes_base: mesDaDespesaNaBase(l, base) })));
    if (!data || data.length < TAMANHO_PAGINA) break;
  }
  return linhas;
}

async function buscarPeriodo(de: string, ate: string, semContrato = false, base: BaseDespesa = "competencia"): Promise<LinhaFluxoCusto[]> {
  const partes = await Promise.all(
    FONTES.map((f) =>
      buscarView(f.view, f.ordem, de, ate, semContrato, base)
        // linha_id ainda não existe na view da importação (migration 20261006000002).
        .catch((e: any) => (e?.code === "42703" && f.view.includes("importado") ? buscarView(f.view, ["despesa_id"], de, ate, semContrato, base) : Promise.reject(e)))
        // View ainda não criada no ambiente: não derruba a tela.
        .catch((e: any) => {
          if (e?.code === "PGRST205" || e?.code === "42P01") return [] as LinhaFluxoCusto[];
          throw e;
        })
    )
  );
  return partes.flat();
}

export function useCustosContratoMes(mes: string, base: BaseDespesa = "competencia") {
  return useQuery({
    queryKey: ["lucratividade_custos_mes", mes, base],
    staleTime: 120_000,
    queryFn: () => buscarPeriodo(`${mes}-01`, proximoMes(mes), false, base),
  });
}

// Ano inteiro (Faturamento da Empresa). `habilitado` deixa a busca para quando a
// aba que precisa dos custos for aberta.
export function useCustosContratoAno(ano: number, habilitado: boolean, base: BaseDespesa = "competencia") {
  return useQuery({
    queryKey: ["lucratividade_custos_ano", ano, base],
    staleTime: 120_000,
    enabled: habilitado,
    queryFn: () => buscarPeriodo(`${ano}-01-01`, `${ano + 1}-01-01`, false, base),
  });
}

// SIS-2026-0642: despesas administrativas do ano (saídas sem contrato), realizadas e já programadas no Fluxo.
export function useDespesasAdmAno(ano: number, base: BaseDespesa = "competencia") {
  return useQuery({
    queryKey: ["fechamento_adm_ano", ano, base],
    staleTime: 120_000,
    queryFn: () => buscarPeriodo(`${ano}-01-01`, `${ano + 1}-01-01`, true, base),
  });
}
