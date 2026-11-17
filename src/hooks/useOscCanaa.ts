import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  CriterioPrevisao, LinhaImportacaoOsc, StatusProjeto, TipoRubrica,
} from "@/lib/oscFinanceiro";

// SIS-2026-0922 — OSC Canaã: gestão financeira da escola (Financeiro).
// Tabelas "OSC_*" e RPCs osc_* da migration 20261117092200. O cálculo
// (saldos, projeção, alertas) fica em src/lib/oscFinanceiro.ts; este hook só
// lê e grava. As tabelas ainda não estão no types.ts gerado — por isso o
// `supabase as any`, mesmo padrão de outras telas novas.

export const MENU_OSC_CANAA = "financeiro-osc-canaa";
export const ROTA_OSC_CANAA = "/app/financeiro/osc-canaa";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabelas OSC_* ainda fora do types.ts gerado
const sb = supabase as any;
// Construtor de consulta do PostgREST sem tipo (mesmo motivo do `sb`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = any;

export interface OscParceria {
  id: string;
  nome: string;
  empresa_id: string | null;
  contrato_ids: string[] | null;
  repasse_mensal: number;
  ativo: boolean;
  observacao: string | null;
}
export interface OscAno {
  id: string;
  parceria_id: string;
  ano: number;
  saldo_inicial: number;
  reserva_extra: number;
  premissas: string | null;
}
export interface OscRubrica {
  id: string;
  parceria_id: string;
  nome: string;
  grupo: string;
  tipo: TipoRubrica;
  recorrente: boolean;
  ordem: number;
  ativo: boolean;
}
export interface OscDePara {
  id: string;
  parceria_id: string;
  classificacao_id: string;
  rubrica_id: string;
}
export interface OscCompetencia {
  id: string;
  parceria_id: string;
  competencia: string;
  repasse_previsto: number | null;
  repasse_recebido: number | null;
  repasse_recebido_em: string | null;
  situacao: "aberta" | "fechada";
  fonte_realizado: "malote" | "historico";
  fechada_em: string | null;
  observacao: string | null;
}
export interface OscPrevisao {
  id: string;
  parceria_id: string;
  rubrica_id: string;
  ano: number;
  criterio: CriterioPrevisao;
  base_mensal: number;
  ajuste_pct: number;
}
export interface OscPrevisaoMes {
  id: string;
  parceria_id: string;
  rubrica_id: string;
  competencia: string;
  valor: number;
  observacao: string | null;
}
export interface OscLancamento {
  id: string;
  parceria_id: string;
  competencia: string;
  rubrica_id: string;
  tipo: "historico" | "ajuste" | "resgate";
  valor: number;
  descricao: string | null;
  origem_ref: string | null;
  lote_importacao: string | null;
  created_at: string;
}
export interface OscProjeto {
  id: string;
  parceria_id: string;
  nome: string;
  descricao: string | null;
  rubrica_id: string | null;
  valor_estimado: number;
  competencia_prevista: string | null;
  status: StatusProjeto;
  observacao: string | null;
  updated_at: string;
}
export interface OscPagamentoMalote {
  chave: string;
  despesa_id: string;
  id_malote: string | null;
  numero_parcela: number | null;
  data_pagamento: string | null;
  competencia_malote: string;
  competencia: string;
  contrato_nome: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  descricao: string | null;
  fornecedor: string | null;
  forma_pagamento: string | null;
  valor: number;
  rubrica_id: string | null;
  rubrica_origem: "de_para" | "reclassificado" | null;
  ajuste_id: string | null;
  ajuste_motivo: string | null;
  ajuste_em: string | null;
  ajuste_por: string | null;
  ignorado: boolean;
}
export interface OscComprometido {
  despesa_id: string;
  id_malote: string | null;
  descricao: string | null;
  status: string;
  competencia: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  valor: number;
}
export interface OscHistorico {
  id: number;
  tabela: string;
  registro_id: string | null;
  acao: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  usuario_nome: string | null;
  created_at: string;
}

// PostgREST devolve numeric como string — converte só os campos de valor.
const numerico = <T extends object>(linhas: T[], campos: (keyof T)[]): T[] =>
  linhas.map((l) => {
    const c = { ...l } as Record<keyof T, unknown>;
    for (const k of campos) if (c[k] !== null && c[k] !== undefined) c[k] = Number(c[k]);
    return c as T;
  });

async function lerTabela<T>(tabela: string, parceriaId: string, extra?: (q: Consulta) => Consulta): Promise<T[]> {
  let q = sb.from(tabela).select("*").eq("parceria_id", parceriaId);
  if (extra) q = extra(q);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

export function useOscParcerias() {
  return useQuery({
    queryKey: ["osc", "parcerias"],
    queryFn: async () => {
      const { data, error } = await sb.from("OSC_PARCERIA").select("*").order("nome");
      if (error) throw error;
      return numerico<OscParceria>(data ?? [], ["repasse_mensal"]);
    },
  });
}

/** Tudo o que a tela precisa de uma parceria num ano (premissas + lançamentos). */
export function useOscDados(parceriaId: string | null, ano: number) {
  return useQuery({
    queryKey: ["osc", "dados", parceriaId, ano],
    enabled: !!parceriaId,
    queryFn: async () => {
      const id = parceriaId!;
      const ini = `${ano}-01-01`;
      const fim = `${ano}-12-01`;
      const doAno = (q: Consulta) => q.gte("competencia", ini).lte("competencia", fim);
      const [anos, rubricas, depara, competencias, previsoes, previsoesMes, lancamentos, projetos] = await Promise.all([
        lerTabela<OscAno>("OSC_ANO", id),
        lerTabela<OscRubrica>("OSC_RUBRICA", id, (q) => q.order("ordem").order("nome")),
        lerTabela<OscDePara>("OSC_RUBRICA_CLASSIFICACAO", id),
        lerTabela<OscCompetencia>("OSC_COMPETENCIA", id, doAno),
        lerTabela<OscPrevisao>("OSC_PREVISAO", id, (q) => q.eq("ano", ano)),
        lerTabela<OscPrevisaoMes>("OSC_PREVISAO_MES", id, doAno),
        lerTabela<OscLancamento>("OSC_LANCAMENTO", id, (q) => doAno(q).order("competencia").order("created_at")),
        lerTabela<OscProjeto>("OSC_PROJETO", id, (q) => q.order("competencia_prevista", { nullsFirst: false }).order("nome")),
      ]);
      return {
        ano: numerico(anos, ["saldo_inicial", "reserva_extra"]).find((a) => a.ano === ano) ?? null,
        rubricas,
        depara,
        competencias: numerico(competencias, ["repasse_previsto", "repasse_recebido"]),
        previsoes: numerico(previsoes, ["base_mensal", "ajuste_pct"]),
        previsoesMes: numerico(previsoesMes, ["valor"]),
        lancamentos: numerico(lancamentos, ["valor"]),
        projetos: numerico(projetos, ["valor_estimado"]),
      };
    },
  });
}

export function useOscPagamentosMalote(parceriaId: string | null, ano: number) {
  return useQuery({
    queryKey: ["osc", "pagamentos", parceriaId, ano],
    enabled: !!parceriaId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("osc_pagamentos_malote", { _parceria_id: parceriaId, _ano: ano });
      if (error) throw error;
      return numerico<OscPagamentoMalote>(data ?? [], ["valor", "numero_parcela"]);
    },
  });
}

export function useOscComprometido(parceriaId: string | null) {
  return useQuery({
    queryKey: ["osc", "comprometido", parceriaId],
    enabled: !!parceriaId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("osc_malote_comprometido", { _parceria_id: parceriaId });
      if (error) throw error;
      return numerico<OscComprometido>(data ?? [], ["valor"]);
    },
  });
}

export function useOscClassificacoes() {
  return useQuery({
    queryKey: ["osc", "classificacoes"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await sb.from("planejamento_orcamentario_classificacao").select("id, nome, ativo").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; ativo: boolean }[];
    },
  });
}

export function useOscEmpresas() {
  return useQuery({
    queryKey: ["osc", "empresas"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await sb.from("empresas").select("id, codigo, nome_fantasia, razao_social").order("codigo");
      if (error) throw error;
      return (data ?? []) as { id: string; codigo: string; nome_fantasia: string | null; razao_social: string }[];
    },
  });
}

export function useOscContratos(empresaId: string | null) {
  return useQuery({
    queryKey: ["osc", "contratos", empresaId],
    enabled: !!empresaId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await sb.from("contratos").select("id, nome").eq("empresa_id", empresaId).order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
}

export function useOscHistorico(parceriaId: string | null) {
  return useQuery({
    queryKey: ["osc", "historico", parceriaId],
    enabled: !!parceriaId,
    queryFn: async () => {
      const { data, error } = await sb.from("OSC_HISTORICO").select("*").eq("parceria_id", parceriaId)
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as OscHistorico[];
    },
  });
}

// ── escrita ────────────────────────────────────────────────────────────────
function useInvalidarOsc() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["osc"] });
}

/** upsert/insert/update/delete genérico numa tabela OSC_* (RLS decide). */
export function useOscSalvar(tabela: string, conflito?: string) {
  const invalidar = useInvalidarOsc();
  return useMutation({
    mutationFn: async (linha: Record<string, unknown>): Promise<string | null> => {
      const q = linha.id
        ? sb.from(tabela).update(linha).eq("id", linha.id)
        : conflito
          ? sb.from(tabela).upsert(linha, { onConflict: conflito })
          : sb.from(tabela).insert(linha);
      const { data, error } = await q.select("id");
      if (error) throw error;
      // RLS barra UPDATE em silêncio (0 linhas, sem erro) — avisa em vez de fingir que salvou.
      if (!data?.length) throw new Error("Nada foi salvo: sem permissão ou registro não encontrado.");
      return data[0].id as string;
    },
    onSuccess: invalidar,
  });
}

export function useOscExcluir(tabela: string) {
  const invalidar = useInvalidarOsc();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await sb.from(tabela).delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Nada foi excluído: sem permissão ou registro não encontrado.");
    },
    onSuccess: invalidar,
  });
}

export function useOscReclassificar() {
  const invalidar = useInvalidarOsc();
  return useMutation({
    mutationFn: async (p: {
      parceriaId: string; despesaId: string; numeroParcela: number | null; classificacaoId: string | null;
      rubricaId: string | null; competencia: string | null; ignorar: boolean; motivo: string;
    }) => {
      const { error } = await sb.rpc("osc_reclassificar_pagamento", {
        _parceria_id: p.parceriaId, _despesa_id: p.despesaId, _numero_parcela: p.numeroParcela,
        _classificacao_id: p.classificacaoId, _rubrica_id: p.rubricaId, _competencia: p.competencia,
        _ignorar: p.ignorar, _motivo: p.motivo,
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useOscDesfazerReclassificacao() {
  const invalidar = useInvalidarOsc();
  return useMutation({
    mutationFn: async (ajusteId: string) => {
      const { error } = await sb.rpc("osc_desfazer_reclassificacao", { _ajuste_id: ajusteId });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useOscDefinirSituacao() {
  const invalidar = useInvalidarOsc();
  return useMutation({
    mutationFn: async (p: { parceriaId: string; competencia: string; situacao: "aberta" | "fechada"; observacao?: string }) => {
      const { error } = await sb.rpc("osc_definir_situacao", {
        _parceria_id: p.parceriaId, _competencia: p.competencia, _situacao: p.situacao, _observacao: p.observacao ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useOscImportarHistorico() {
  const invalidar = useInvalidarOsc();
  return useMutation({
    mutationFn: async (p: { parceriaId: string; linhas: LinhaImportacaoOsc[]; usarComoRealizado: boolean; criarRubricas: boolean }) => {
      const { data, error } = await sb.rpc("osc_importar_historico", {
        _parceria_id: p.parceriaId, _linhas: p.linhas, _usar_como_realizado: p.usarComoRealizado, _criar_rubricas: p.criarRubricas,
      });
      if (error) throw error;
      return data as { lote: string; linhas: number; meses: string[] };
    },
    onSuccess: invalidar,
  });
}
