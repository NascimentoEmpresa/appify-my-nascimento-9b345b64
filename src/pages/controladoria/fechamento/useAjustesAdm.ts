import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LigacoesRubrica, RubricaLigacao } from "../faturamento/regras";

// Ajustes do Total Desp. Adm que valem só no Fechamento da Empresa (migration 20261103005200). Tabelas ausentes (migration não aplicada) = sem ajustes.
const KEY_CLASSIFICACAO = ["fechamento_adm_classificacao"];
const KEY_CONTRATO = ["fechamento_adm_contrato"];
const semTabela = (e: { code?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01");

export function useAjustesAdmClassificacao() {
  return useQuery({
    queryKey: KEY_CLASSIFICACAO,
    staleTime: 60_000,
    queryFn: async (): Promise<LigacoesRubrica> => {
      const { data, error } = await (supabase as any).from("fechamento_adm_classificacao").select("classificacao_id, rubrica");
      if (error) {
        if (semTabela(error)) return new Map();
        throw error;
      }
      return new Map((data ?? []).map((r: { classificacao_id: string; rubrica: RubricaLigacao }) => [r.classificacao_id, r.rubrica]));
    },
  });
}

/** rubrica = null volta a classificação à ligação global (apaga o ajuste do Fechamento). */
export function useSalvarAjusteAdmClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ classificacaoId, rubrica }: { classificacaoId: string; rubrica: RubricaLigacao | null }) => {
      const t = (supabase as any).from("fechamento_adm_classificacao");
      const { error } = rubrica
        ? await t.upsert({ classificacao_id: classificacaoId, rubrica }, { onConflict: "classificacao_id" })
        : await t.delete().eq("classificacao_id", classificacaoId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_CLASSIFICACAO }),
  });
}

/** Contratos ADMINISTRATIVO tirados da despesa administrativa do Fechamento. */
export function useContratosAdmTirados() {
  return useQuery({
    queryKey: KEY_CONTRATO,
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await (supabase as any).from("fechamento_adm_contrato").select("contrato_id");
      if (error) {
        if (semTabela(error)) return new Set();
        throw error;
      }
      return new Set((data ?? []).map((r: { contrato_id: string }) => r.contrato_id));
    },
  });
}

export function useTirarContratoAdm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, tirar }: { contratoId: string; tirar: boolean }) => {
      const t = (supabase as any).from("fechamento_adm_contrato");
      const { error } = tirar ? await t.upsert({ contrato_id: contratoId }, { onConflict: "contrato_id" }) : await t.delete().eq("contrato_id", contratoId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_CONTRATO }),
  });
}
