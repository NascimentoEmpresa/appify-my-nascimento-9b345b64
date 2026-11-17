import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { TipoDivergencia } from "@/pages/financeiro/conciliacao-servicos/regras";
import type { HistoricoTratativa, StatusTratativa, Tratativa } from "@/pages/financeiro/conciliacao-servicos/tratativas";

// SIS-2026-0903 (Fase 2): tratativas das divergências da Conciliação (migration 20261117230000). As tabelas ainda não estão nos tipos gerados do
// Supabase, por isso o cliente sem tipos. Quem lê/escreve é decidido pela RLS (relatorio-servicos-conciliacao: visualizar / alterar).
const db = supabase as unknown as SupabaseClient;
const KEY = "conciliacao_servicos_tratativas";
const num = (v: unknown) => Number(v ?? 0) || 0;

interface Linha {
  id: string; alvo_chave: string; alvo_tipo: "nota" | "indicador"; nf_emissao_id: string | null; contrato_id: string | null; empresa_id: string | null; competencia: string | null;
  indicador: string | null; titulo: string; tipo_divergencia: TipoDivergencia | null; valor_diferenca: number | string; status: StatusTratativa; responsavel_id: string | null;
  responsavel_nome: string | null; justificativa: string | null; identificada_em: string; prazo_resolucao: string | null; regularizada_em: string | null;
}

const paraTratativa = (l: Linha): Tratativa => ({
  id: l.id, alvoChave: l.alvo_chave, alvoTipo: l.alvo_tipo, nfEmissaoId: l.nf_emissao_id, contratoId: l.contrato_id, empresaId: l.empresa_id,
  competencia: l.competencia ? l.competencia.slice(0, 7) : null, indicador: l.indicador, titulo: l.titulo, tipoDivergencia: l.tipo_divergencia, valorDiferenca: num(l.valor_diferenca),
  status: l.status, responsavelId: l.responsavel_id, responsavelNome: l.responsavel_nome, justificativa: l.justificativa, identificadaEm: l.identificada_em.slice(0, 10),
  prazoResolucao: l.prazo_resolucao ? l.prazo_resolucao.slice(0, 10) : null, regularizadaEm: l.regularizada_em ? l.regularizada_em.slice(0, 10) : null,
});

/** Todas as tratativas. Tabela ainda não criada neste ambiente: lista vazia (a tela segue como na Fase 1). */
export function useTratativas() {
  return useQuery({
    queryKey: [KEY, "lista"],
    staleTime: 30_000,
    queryFn: async (): Promise<Tratativa[]> => {
      const out: Tratativa[] = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await db.from("conciliacao_servicos_tratativa").select("*").order("identificada_em", { ascending: false }).range(de, de + 999);
        if (error) { if (error.code === "42P01" || error.code === "PGRST205") return []; throw error; }
        out.push(...((data ?? []) as Linha[]).map(paraTratativa));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });
}

export function useHistoricoTratativa(id: string | null) {
  return useQuery({
    queryKey: [KEY, "historico", id],
    enabled: !!id,
    queryFn: async (): Promise<HistoricoTratativa[]> => {
      const { data, error } = await db.from("conciliacao_servicos_tratativa_historico").select("id, campo, valor_anterior, valor_novo, autor_nome, created_at").eq("tratativa_id", id as string).order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as { id: string; campo: string; valor_anterior: string | null; valor_novo: string | null; autor_nome: string | null; created_at: string }[])
        .map((h) => ({ id: h.id, campo: h.campo, valorAnterior: h.valor_anterior, valorNovo: h.valor_novo, autorNome: h.autor_nome, criadoEm: h.created_at }));
    },
  });
}

export interface PessoaResponsavel { id: string; nome: string }
export function useResponsaveis() {
  return useQuery({
    queryKey: [KEY, "responsaveis"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PessoaResponsavel[]> => {
      const { data, error } = await db.from("profiles").select("id, display_name").order("display_name").limit(2000);
      if (error) throw error;
      return ((data ?? []) as { id: string; display_name: string | null }[]).filter((p) => !!p.display_name).map((p) => ({ id: p.id, nome: p.display_name as string }));
    },
  });
}

export interface NovaTratativa {
  alvoChave: string; alvoTipo: "nota" | "indicador"; nfEmissaoId?: string | null; contratoId?: string | null; empresaId?: string | null; competencia?: string | null; indicador?: string | null;
  titulo: string; tipoDivergencia?: TipoDivergencia | null; valorDiferenca: number;
  responsavelId?: string | null; responsavelNome?: string | null; justificativa?: string | null; prazoResolucao?: string | null; status?: StatusTratativa;
}

export function useCriarTratativa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: NovaTratativa) => {
      const { error } = await db.from("conciliacao_servicos_tratativa").insert({
        alvo_chave: n.alvoChave, alvo_tipo: n.alvoTipo, nf_emissao_id: n.nfEmissaoId ?? null, contrato_id: n.contratoId ?? null, empresa_id: n.empresaId ?? null,
        competencia: n.competencia ? `${n.competencia}-01` : null, indicador: n.indicador ?? null, titulo: n.titulo, tipo_divergencia: n.tipoDivergencia ?? null,
        valor_diferenca: n.valorDiferenca, status: n.status ?? "aberta", responsavel_id: n.responsavelId ?? null, responsavel_nome: n.responsavelNome ?? null,
        justificativa: n.justificativa ?? null, prazo_resolucao: n.prazoResolucao || null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export interface AtualizacaoTratativa {
  status: StatusTratativa; responsavelId: string | null; responsavelNome: string | null; justificativa: string | null; prazoResolucao: string | null; regularizadaEm: string | null; valorDiferenca?: number;
}

export function useAtualizarTratativa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: AtualizacaoTratativa }) => {
      const { error } = await db.from("conciliacao_servicos_tratativa").update({
        status: campos.status, responsavel_id: campos.responsavelId, responsavel_nome: campos.responsavelNome, justificativa: campos.justificativa,
        prazo_resolucao: campos.prazoResolucao || null, regularizada_em: campos.status === "regularizada" ? campos.regularizadaEm || null : null,
        ...(campos.valorDiferenca !== undefined ? { valor_diferenca: campos.valorDiferenca } : {}),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
