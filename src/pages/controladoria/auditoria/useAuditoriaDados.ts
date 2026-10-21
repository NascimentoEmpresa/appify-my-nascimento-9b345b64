import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { emLotes } from "@/lib/emLotes";
import { usePlanejamentosOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { fimDoMes } from "@/hooks/usePlanilhaCusto";
import { getStatusVigencia, competenciaNoPeriodo } from "@/pages/malote/orcamentoUtils";
import { CentroOrcamento, ConciliacaoAud, DespesaMalote, FiltroAuditoria, LinhaCentroMalote, LinhaMaloteFluxo, ParcelaPaga, RateioMalote, proximoMesData } from "./regras";

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

// SIS-2026-0701: o painel enxerga o mês por data de pagamento (confere o pagamento) ou por competência (como a lucratividade dos
// contratos é vista). A coluna do Fluxo é `data_pagamento` ou `competencia` (sempre dia 01).
export type BasePeriodo = "pagamento" | "competencia";
const colunaFluxo = (base: BasePeriodo) => (base === "competencia" ? "competencia" : "data_pagamento");

// ── Fluxo de Caixa do mês (todas as origens) ────────────────────────────────
export interface LinhaFluxoMes {
  origem: string;
  tipo: "entrada" | "saida";
  valor: number;
  empresa_id: string | null;
  contrato_id: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  banco_id: string | null;
  banco_nome: string | null;
  descricao: string | null;
  data_pagamento: string | null;
  despesa_id: string | null;
  id_malote: string | null;
  // Só a view do Malote devolve (relatório de divergências do card 1).
  ajustado?: boolean | null;
}

// A origem é conhecida pela própria view — nem todas têm a coluna `origem`
// (a de resgate de aplicação não tem; pedir a coluna derrubava o card inteiro).
const VIEWS_FLUXO: { view: string; origem: string; ordem: string[]; extra?: string }[] = [
  { view: "v_malote_pagamento_fluxo_caixa", origem: "malote", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"], extra: "ajustado" },
  { view: "v_debito_automatico_fluxo_caixa", origem: "debito_automatico", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_cartao_fatura_fluxo_caixa", origem: "cartao_fatura", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_fluxo_caixa", origem: "aplicacao_financeira", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_aplicacao_financeira_resgate_fluxo_caixa", origem: "aplicacao_financeira", ordem: ["despesa_id", "numero_parcela", "contrato_id", "valor"] },
  { view: "v_fluxo_caixa_importado_fluxo_caixa", origem: "importacao_historica", ordem: ["despesa_id", "linha_id"] },
];

async function lerView(view: string, origem: string, ordem: string[], mes: string, base: BasePeriodo, extra?: string): Promise<LinhaFluxoMes[]> {
  const linhas = await paginar<Omit<LinhaFluxoMes, "origem">>(() => {
    let q = dentroDoMes((supabase as any).from(view).select(`tipo, valor, empresa_id, contrato_id, classificacao_id, classificacao_nome, banco_id, banco_nome, descricao, data_pagamento, despesa_id, id_malote${extra ? `, ${extra}` : ""}`), colunaFluxo(base), mes);
    for (const c of ordem) q = q.order(c, { ascending: true });
    return q;
  });
  return linhas.map((l) => ({ ...l, origem }));
}

export function useFluxoMes(mes: string, base: BasePeriodo = "pagamento") {
  return useQuery({
    queryKey: ["auditoria_fluxo_mes", mes, base],
    staleTime: STALE,
    queryFn: async () => {
      const partes = await Promise.all(
        VIEWS_FLUXO.map((f) =>
          lerView(f.view, f.origem, f.ordem, mes, base, f.extra)
            .catch((e: any) => (e?.code === "42703" && f.view.includes("importado") ? lerView(f.view, f.origem, ["despesa_id"], mes, base) : Promise.reject(e)))
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
export function useMaloteDiretoMes(mes: string, base: BasePeriodo = "pagamento") {
  return useQuery({
    queryKey: ["auditoria_malote_direto", mes, base],
    staleTime: STALE,
    queryFn: async () => {
      const db = supabase as any;
      const colunasDespesa = "id, numero, empresa_id, contrato_id, valor_aprovado, valor_total, parcelado";
      let naoParceladas: DespesaMalote[];
      let parcelas: (ParcelaPaga & { id: string })[];
      let despesasDasParcelas: DespesaMalote[];
      if (base === "competencia") {
        // Por competência: as despesas pagas cuja competência cai no mês; a parcela paga acompanha a competência da despesa,
        // igual à view do Fluxo (a linha da parcela herda a competência da despesa).
        naoParceladas = await paginar<DespesaMalote>(() =>
          dentroDoMes(db.from("malote_despesa").select(colunasDespesa).eq("status", "despesa_paga").eq("parcelado", false).is("deleted_at", null), "competencia", mes).order("id")
        );
        despesasDasParcelas = await paginar<DespesaMalote>(() =>
          dentroDoMes(db.from("malote_despesa").select(colunasDespesa).eq("parcelado", true).is("deleted_at", null), "competencia", mes).order("id")
        );
        parcelas = await emLotes<ParcelaPaga & { id: string }>(despesasDasParcelas.map((d) => d.id), 40, async (lote) => ({
          data: await paginar<ParcelaPaga & { id: string }>(() => db.from("malote_despesa_parcela").select("id, despesa_id, valor").eq("status", "paga").in("despesa_id", lote).order("id")),
          error: null,
        }), 6);
        // Só entram as despesas parceladas que têm parcela paga (as demais ainda não são Fluxo).
        const comParcelaPaga = new Set(parcelas.map((p) => p.despesa_id));
        despesasDasParcelas = despesasDasParcelas.filter((d) => comParcelaPaga.has(d.id));
      } else {
        naoParceladas = await paginar<DespesaMalote>(() =>
          dentroDoMes(db.from("malote_despesa").select(colunasDespesa).eq("status", "despesa_paga").eq("parcelado", false).is("deleted_at", null), "data_pagamento", mes).order("id")
        );
        parcelas = await paginar<ParcelaPaga & { id: string }>(() =>
          dentroDoMes(db.from("malote_despesa_parcela").select("id, despesa_id, valor").eq("status", "paga"), "data_pagamento_real", mes).order("id")
        );
        const idsParcelas = [...new Set(parcelas.map((p) => p.despesa_id))];
        // 200 ids numa URL (~7,8 KB) passam do limite do gateway do cluster (502 "invalid response from upstream" na Conciliação do
        // Malote); em lotes de 40 (src/lib/emLotes.ts), no máximo 6 consultas ao mesmo tempo.
        despesasDasParcelas = await emLotes<DespesaMalote>(idsParcelas, 40, (lote) =>
          db.from("malote_despesa").select(colunasDespesa).in("id", lote).eq("parcelado", true).is("deleted_at", null), 6);
      }
      const todosIds = [...naoParceladas.map((d) => d.id), ...despesasDasParcelas.map((d) => d.id)];
      const rateios = await emLotes<RateioMalote>(todosIds, 40, async (lote) => ({
        data: await paginar<RateioMalote>(() =>
          db.from("malote_despesa_rateio_linha").select("despesa_id, empresa_id, contrato_id, valor").in("despesa_id", lote).order("id")
        ),
        error: null,
      }), 6);
      return { naoParceladas, parcelas, despesasDasParcelas, rateios };
    },
  });
}

// ── Malote por classificação (card 3) ───────────────────────────────────────
export function useMaloteCentrosMes(mes: string, base: BasePeriodo = "pagamento") {
  return useQuery({
    queryKey: ["auditoria_malote_centros", mes, base],
    staleTime: STALE,
    queryFn: async () => {
      const db = supabase as any;
      const linhas = await paginar<LinhaCentroMalote>(() =>
        dentroDoMes(db.from("v_malote_pagamento_fluxo_caixa").select("valor, empresa_id, contrato_id, classificacao_id, despesa_id, id_malote, descricao, classificacao_nome, data_pagamento").eq("tipo", "saida"), colunaFluxo(base), mes)
          .order("despesa_id").order("numero_parcela").order("contrato_id").order("valor")
      );
      const classificacoes = await paginar<{ id: string; tipo: string | null }>(() => db.from("planejamento_orcamentario_classificacao").select("id, tipo").order("id"));
      return { linhas: linhas.map((l) => ({ ...l, origem: "malote" })), tipoPorClassificacao: new Map(classificacoes.map((c) => [c.id, c.tipo])) };
    },
  });
}

// ── Conciliações salvas que cobrem o mês ────────────────────────────────────
// SIS-2026-0657: o total do extrato vem do cabeçalho (extrato_entradas/extrato_saidas); a conciliação não
// grava as linhas que bateram sozinhas, então não há como somar linha a linha.
export function useConciliadoMes(mes: string) {
  return useQuery({
    queryKey: ["auditoria_conciliado_mes", mes],
    staleTime: STALE,
    queryFn: async () => {
      const db = supabase as any;
      // Conciliação que se sobrepõe ao mês.
      const ler = (colunas: string) =>
        db.from("financeiro_conciliacao_fluxo_caixa").select(colunas).lt("data_inicio", proximoMesData(mes)).gte("data_fim", `${mes}-01`);
      const COMPLETA = "id, banco_id, empresa_ids, todas_empresas, data_inicio, data_fim, created_at, extrato_entradas, extrato_saidas";
      let { data: cabs, error } = await ler(COMPLETA);
      // Migration 20261014000006 (totais do extrato) ainda não aplicada.
      if (error?.code === "42703") ({ data: cabs, error } = await ler("id, banco_id, empresa_ids, todas_empresas, data_inicio, data_fim, created_at"));
      // Migration 20261005000010 (empresa/banco da conciliação) ainda não aplicada:
      // sem as colunas, toda conciliação vale para todas as empresas.
      if (error?.code === "42703") {
        ({ data: cabs, error } = await ler("id, data_inicio, data_fim, created_at"));
        cabs = (cabs ?? []).map((c: any) => ({ ...c, banco_id: null, empresa_ids: [], todas_empresas: true }));
      }
      if (error) throw error;
      const cabecalhos = (cabs ?? []).map((c: any) => ({
        ...c,
        extrato_entradas: c.extrato_entradas === null || c.extrato_entradas === undefined ? null : Number(c.extrato_entradas),
        extrato_saidas: c.extrato_saidas === null || c.extrato_saidas === undefined ? null : Number(c.extrato_saidas),
      })) as ConciliacaoAud[];
      return { cabecalhos };
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
    // SIS-2026-0657: orçado × realizado por centro de custo (classificação administrativa ou contrato),
    // para listar quem mais estourou o orçado.
    const centros: CentroOrcamento[] = [];
    const nomeAdmPorMalote = new Map<string, string>();
    for (const l of ligacoesAdm) {
      if (!nomeAdmPorMalote.has(l.classificacao_malote_id)) nomeAdmPorMalote.set(l.classificacao_malote_id, l.classificacao_administrativa?.nome ?? l.classificacao_malote?.nome ?? "Administrativo");
    }
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
        centros.push({ nome: nomeAdmPorMalote.get(maloteId) ?? "Administrativo", orcado: valor, realizado: utilAdm.get(maloteId) ?? 0 });
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
      let orcadoDoContrato = 0, realizadoDoContrato = 0;
      porClassificacao.forEach((valor, maloteId) => {
        orcado += valor;
        realizado += utilContrato.get(`${maloteId}|${g.contrato.id}`) ?? 0;
        orcadoDoContrato += valor;
        realizadoDoContrato += utilContrato.get(`${maloteId}|${g.contrato.id}`) ?? 0;
      });
      if (orcadoDoContrato > 0 || realizadoDoContrato > 0) centros.push({ nome: g.contrato.nome, orcado: orcadoDoContrato, realizado: realizadoDoContrato });
    }
    return { orcado: Math.round(orcado * 100) / 100, realizado: Math.round(realizado * 100) / 100, centros };
  }, [mes, filtro.empresaId, filtro.contratoId, orcamentosAdm, gruposContrato, ligacoesAdm, utilizadoLinhas]);

  return { data: resultado, isLoading: c1 || c2 || c3 || c4 };
}

// ── Quem ajustou o valor no Fluxo (relatório de divergências do card 1) ─────
// Lê o histórico gravado por gatilho (migration 20261014000005). Sem a migration aplicada, ou para
// ajustes anteriores a ela, não há autor: a tela diz "autor não registrado" em vez de inventar.
export interface AjusteRegistrado {
  acao: "criado" | "alterado" | "revertido" | "anterior_ao_registro";
  usuario: string | null;
  em: string;
  valorAntes: number | null;
  valorDepois: number | null;
}

export function useAjustesDasDespesas(despesaIds: string[]) {
  const chave = [...despesaIds].sort().join(",");
  return useQuery({
    queryKey: ["auditoria_ajustes_despesas", chave],
    enabled: despesaIds.length > 0,
    staleTime: STALE,
    queryFn: async () => {
      const db = supabase as any;
      const porDespesa = new Map<string, AjusteRegistrado[]>();
      // 200 ids numa URL (~7,8 KB) passam do limite do gateway do cluster (502); em lotes de 40 (src/lib/emLotes.ts).
      let data: any[];
      try {
        data = await emLotes<any>(despesaIds.slice(0, 200), 40, (lote) =>
          db.from("financeiro_fluxo_caixa_ajuste_log")
            .select("despesa_id, acao, antes, depois, user_id, created_at")
            .eq("origem", "malote")
            .in("despesa_id", lote)
            .order("created_at", { ascending: false }));
      } catch (error: any) {
        if (error?.code === "PGRST205" || error?.code === "42P01") return porDespesa;
        throw error;
      }
      data.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const userIds = [...new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean))] as string[];
      const nomes = new Map<string, string>();
      if (userIds.length > 0) {
        const perfis = await emLotes<any>(userIds, 40, (lote) => db.from("profiles").select("id, display_name").in("id", lote), 6);
        for (const p of perfis) nomes.set(p.id, p.display_name);
      }
      const num = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
      for (const r of data ?? []) {
        const lista = porDespesa.get(r.despesa_id) ?? [];
        lista.push({
          acao: r.acao,
          usuario: r.user_id ? (nomes.get(r.user_id) ?? null) : null,
          em: r.created_at,
          valorAntes: num(r.antes?.valor),
          valorDepois: num(r.depois?.valor),
        });
        porDespesa.set(r.despesa_id, lista);
      }
      return porDespesa;
    },
  });
}
