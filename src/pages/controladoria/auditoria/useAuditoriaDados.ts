import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlanejamentosOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { fimDoMes } from "@/hooks/usePlanilhaCusto";
import { getStatusVigencia, competenciaNoPeriodo } from "@/pages/malote/orcamentoUtils";
import { DespesaMalote, FiltroAuditoria, LinhaCentroMalote, LinhaMaloteFluxo, ParcelaPaga, RateioMalote, proximoMesData } from "./regras";

// SIS-2026-0553: leitura dos totais de cada validação. Cada uma é uma query
// própria (o card carrega sozinho). Tudo é limitado ao mês pedido — nunca baixa
// o Fluxo de Caixa inteiro.
const TAMANHO_PAGINA = 1000;
const STALE = 120_000;

async function paginar<T>(montar: () => any): Promise<T[]> {
  const linhas: T[] = [];
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await montar().range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);
    if (error) throw error;
    linhas.push(...((data ?? []) as T[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
  }
  return linhas;
}

const dentroDoMes = (q: any, coluna: string, mes: string) => q.gte(coluna, `${mes}-01`).lt(coluna, proximoMesData(mes));

// ── Fluxo de Caixa do mês (todas as origens) ────────────────────────────────
export interface LinhaFluxoMes {
  origem: string;
  tipo: "entrada" | "saida";
  valor: number;
  empresa_id: string | null;
  contrato_id: string | null;
  classificacao_nome: string | null;
}

// A origem é conhecida pela própria view — nem todas têm a coluna `origem`
// (a de resgate de aplicação não tem; pedir a coluna derrubava o card inteiro).
const VIEWS_FLUXO: { view: string; origem: string; ordem: string[] }[] = [
  { view: "v_malote_pagamento_fluxo_caixa", origem: "malote", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_debito_automatico_fluxo_caixa", origem: "debito_automatico", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_cartao_fatura_fluxo_caixa", origem: "cartao_fatura", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_fluxo_caixa", origem: "aplicacao_financeira", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_resgate_fluxo_caixa", origem: "aplicacao_financeira", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_fluxo_caixa_importado_fluxo_caixa", origem: "importacao_historica", ordem: ["despesa_id", "linha_id"] },
];

async function lerView(view: string, origem: string, ordem: string[], mes: string): Promise<LinhaFluxoMes[]> {
  const linhas = await paginar<Omit<LinhaFluxoMes, "origem">>(() => {
    let q = dentroDoMes((supabase as any).from(view).select("tipo, valor, empresa_id, contrato_id, classificacao_nome"), "data_pagamento", mes);
    for (const c of ordem) q = q.order(c, { ascending: true });
    return q;
  });
  return linhas.map((l) => ({ ...l, origem }));
}

export function useFluxoMes(mes: string) {
  return useQuery({
    queryKey: ["auditoria_fluxo_mes", mes],
    staleTime: STALE,
    queryFn: async () => {
      const partes = await Promise.all(
        VIEWS_FLUXO.map((f) =>
          lerView(f.view, f.origem, f.ordem, mes)
            .catch((e: any) => (e?.code === "42703" && f.view.includes("importado") ? lerView(f.view, f.origem, ["despesa_id"], mes) : Promise.reject(e)))
            .catch((e: any) => {
              if (e?.code === "PGRST205" || e?.code === "42P01") return [] as LinhaFluxoMes[];
              throw e;
            })
        )
      );
      return partes.flat();
    },
  });
}

// ── Malote direto (tabelas do Malote, sem a view do Fluxo) ──────────────────
export function useMaloteDiretoMes(mes: string) {
  return useQuery({
    queryKey: ["auditoria_malote_direto", mes],
    staleTime: STALE,
    queryFn: async () => {
      const db = supabase as any;
      const colunasDespesa = "id, empresa_id, contrato_id, valor_aprovado, valor_total, parcelado";
      const naoParceladas = await paginar<DespesaMalote>(() =>
        dentroDoMes(db.from("malote_despesa").select(colunasDespesa).eq("status", "despesa_paga").eq("parcelado", false).is("deleted_at", null), "data_pagamento", mes).order("id")
      );
      const parcelas = await paginar<ParcelaPaga & { id: string }>(() =>
        dentroDoMes(db.from("malote_despesa_parcela").select("id, despesa_id, valor").eq("status", "paga"), "data_pagamento_real", mes).order("id")
      );
      const idsParcelas = [...new Set(parcelas.map((p) => p.despesa_id))];
      const idsNaoParceladas = naoParceladas.map((d) => d.id);

      const despesasDasParcelas: DespesaMalote[] = [];
      for (let i = 0; i < idsParcelas.length; i += 200) {
        const bloco = idsParcelas.slice(i, i + 200);
        const { data, error } = await db.from("malote_despesa").select(colunasDespesa).in("id", bloco).eq("parcelado", true).is("deleted_at", null);
        if (error) throw error;
        despesasDasParcelas.push(...(data ?? []));
      }

      const todosIds = [...idsNaoParceladas, ...despesasDasParcelas.map((d) => d.id)];
      const rateios: RateioMalote[] = [];
      for (let i = 0; i < todosIds.length; i += 200) {
        const bloco = todosIds.slice(i, i + 200);
        const linhas = await paginar<RateioMalote>(() =>
          db.from("malote_despesa_rateio_linha").select("despesa_id, empresa_id, contrato_id, valor").in("despesa_id", bloco).order("id")
        );
        rateios.push(...linhas);
      }
      return { naoParceladas, parcelas, despesasDasParcelas, rateios };
    },
  });
}

// ── Malote por classificação (card 3) ───────────────────────────────────────
export function useMaloteCentrosMes(mes: string) {
  return useQuery({
    queryKey: ["auditoria_malote_centros", mes],
    staleTime: STALE,
    queryFn: async () => {
      const db = supabase as any;
      const linhas = await paginar<LinhaCentroMalote>(() =>
        dentroDoMes(db.from("v_malote_pagamento_fluxo_caixa").select("valor, empresa_id, contrato_id, classificacao_id").eq("tipo", "saida"), "data_pagamento", mes)
          .order("despesa_id").order("numero_parcela").order("contrato_id").order("valor")
      );
      const classificacoes = await paginar<{ id: string; tipo: string | null }>(() => db.from("planejamento_orcamentario_classificacao").select("id, tipo").order("id"));
      return { linhas, tipoPorClassificacao: new Map(classificacoes.map((c) => [c.id, c.tipo])) };
    },
  });
}

// ── Conciliações salvas que cobrem o mês ────────────────────────────────────
export function useConciliadoMes(mes: string) {
  return useQuery({
    queryKey: ["auditoria_conciliado_mes", mes],
    staleTime: STALE,
    queryFn: async () => {
      const db = supabase as any;
      // Conciliação que se sobrepõe ao mês.
      const ler = (colunas: string) =>
        db.from("financeiro_conciliacao_fluxo_caixa").select(colunas).lt("data_inicio", proximoMesData(mes)).gte("data_fim", `${mes}-01`);
      let { data: cabs, error } = await ler("id, empresa_ids, todas_empresas");
      // Migration 20261005000010 (empresa/banco da conciliação) ainda não aplicada:
      // sem as colunas, toda conciliação vale para todas as empresas.
      if (error?.code === "42703") {
        ({ data: cabs, error } = await ler("id"));
        cabs = (cabs ?? []).map((c: any) => ({ ...c, empresa_ids: [], todas_empresas: true }));
      }
      if (error) throw error;
      const ids = (cabs ?? []).map((c: any) => c.id);
      const linhas: { conciliacao_id: string; origem: "fluxo" | "extrato"; valor: number }[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const bloco = ids.slice(i, i + 50);
        linhas.push(
          ...(await paginar<any>(() =>
            dentroDoMes(db.from("financeiro_conciliacao_fluxo_caixa_linha").select("id, conciliacao_id, origem, valor").in("conciliacao_id", bloco), "dia", mes).order("id")
          ))
        );
      }
      return { cabecalhos: (cabs ?? []) as { id: string; empresa_ids: string[] | null; todas_empresas: boolean }[], linhas };
    },
  });
}

export function linhasMalote(fluxo: LinhaFluxoMes[]): LinhaMaloteFluxo[] {
  return fluxo.filter((l) => l.origem === "malote" && l.tipo === "saida");
}

// ── 4. Orçado × Realizado ───────────────────────────────────────────────────
// Mesma conta do Orçamento Geral (Malote): Orçado do período (vigência
// administrativa + rubricas de contrato) e Realizado = utilizado das
// Classificações que têm orçado. Sem o filtro de setor da tela: a Controladoria
// audita o total do grupo. A tela de origem pode mostrar menos para quem tem
// classificação restrita por setor.
export function useOrcadoRealizado(mes: string, filtro: FiltroAuditoria) {
  const { data: orcamentosAdm = [], isLoading: c1 } = usePlanejamentosOrcamento(null, { todasEmpresas: true });
  const { data: gruposContrato = [], isLoading: c2 } = useOrcamentoContratos(mes);
  const { data: ligacoesAdm = [], isLoading: c3 } = useLigacoesAdministrativoClassificacao();
  const { data: utilizadoLinhas = [], isLoading: c4 } = useUtilizadoOrcamento();

  const resultado = useMemo(() => {
    const referencia = fimDoMes(mes);
    const maloteIdPorAdm = new Map<string, string>();
    for (const l of ligacoesAdm) maloteIdPorAdm.set(l.classificacao_administrativa_id, l.classificacao_malote_id);

    const utilAdm = new Map<string, number>();
    const utilContrato = new Map<string, number>();
    for (const l of utilizadoLinhas) {
      if (!l.classificacao_id || !competenciaNoPeriodo(l.competencia, mes)) continue;
      if (filtro.empresaId && l.empresa_id !== filtro.empresaId) continue;
      const valor = Number(l.valor) || 0;
      if (l.contrato_id) {
        const chave = `${l.classificacao_id}|${l.contrato_id}`;
        utilContrato.set(chave, (utilContrato.get(chave) ?? 0) + valor);
      } else {
        utilAdm.set(l.classificacao_id, (utilAdm.get(l.classificacao_id) ?? 0) + valor);
      }
    }

    let orcado = 0, realizado = 0;
    // Administrativo: só entra sem filtro de contrato.
    if (!filtro.contratoId) {
      const porClassificacao = new Map<string, number>();
      for (const o of orcamentosAdm) {
        if (filtro.empresaId && o.empresa_id !== filtro.empresaId) continue;
        if (getStatusVigencia(o.inicio_vigencia, o.fim_vigencia, referencia) !== "na_vigencia") continue;
        const maloteId = maloteIdPorAdm.get(o.classificacao_id);
        if (!maloteId) continue;
        porClassificacao.set(maloteId, (porClassificacao.get(maloteId) ?? 0) + (Number(o.valor) || 0));
      }
      porClassificacao.forEach((valor, maloteId) => {
        orcado += valor;
        realizado += utilAdm.get(maloteId) ?? 0;
      });
    }
    for (const g of gruposContrato) {
      if (filtro.empresaId && g.contrato.empresa_id !== filtro.empresaId) continue;
      if (filtro.contratoId && g.contrato.id !== filtro.contratoId) continue;
      const porClassificacao = new Map<string, number>();
      for (const r of g.rubricas) {
        if (!r.classificacaoMaloteId) continue;
        porClassificacao.set(r.classificacaoMaloteId, (porClassificacao.get(r.classificacaoMaloteId) ?? 0) + r.valor);
      }
      porClassificacao.forEach((valor, maloteId) => {
        orcado += valor;
        realizado += utilContrato.get(`${maloteId}|${g.contrato.id}`) ?? 0;
      });
    }
    return { orcado: Math.round(orcado * 100) / 100, realizado: Math.round(realizado * 100) / 100 };
  }, [mes, filtro.empresaId, filtro.contratoId, orcamentosAdm, gruposContrato, ligacoesAdm, utilizadoLinhas]);

  return { data: resultado, isLoading: c1 || c2 || c3 || c4 };
}
