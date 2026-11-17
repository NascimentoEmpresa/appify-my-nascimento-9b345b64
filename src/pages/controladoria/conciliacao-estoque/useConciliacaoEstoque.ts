// SIS-2026-0908: fontes da Conciliação de Estoque. Cada número vem da mesma consulta que a tela de origem usa, para bater com ela:
//   compras   → as seis views do Fluxo de Caixa (buscarSaidasDosContratos), na base escolhida, só nos contratos de estoque;
//   físico    → ctl_conciliacao_estoque_fisico (fotos + lotes + ledger, mig 20261117160000);
//   apropriado → sup_rel_consumo_custo_por_contrato, a mesma RPC da coluna Consumo de Estoque da Lucratividade.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BaseDespesa } from "../faturamento/regras";
import { buscarSaidasDosContratos, proximoMes } from "../faturamento/useCustosContratoMes";
import { intervaloDoMes } from "../faturamento/consumoEstoque";
import { ehContratoEstoque, normalizarResposta, type RespostaFisico } from "./regras";

// types.ts é gerado fora do CI e não conhece as RPCs novas. Mesmo padrão dos outros hooks de RPC recente do projeto.
const sb = supabase as any;

export interface ContratoResumo { id: string; nome: string; empresa_id: string | null }

export function useContratosConciliacao() {
  return useQuery({
    queryKey: ["conciliacao-estoque-contratos"],
    staleTime: 300_000,
    queryFn: async (): Promise<ContratoResumo[]> => {
      const { data, error } = await sb.from("contratos").select("id, nome, empresa_id");
      if (error) throw error;
      return (data ?? []) as ContratoResumo[];
    },
  });
}

export function idsContratosEstoque(contratos: ContratoResumo[], empresaId: string | null): string[] {
  return contratos.filter((c) => ehContratoEstoque(c.nome) && (!empresaId || c.empresa_id === empresaId)).map((c) => c.id);
}

export function useComprasEstoque(ids: string[], mesInicio: string, mesFim: string, base: BaseDespesa) {
  return useQuery({
    queryKey: ["conciliacao-estoque-compras", ids, mesInicio, mesFim, base],
    staleTime: 120_000,
    enabled: Boolean(mesInicio && mesFim),
    queryFn: () => buscarSaidasDosContratos(ids, `${mesInicio}-01`, proximoMes(mesFim), base),
  });
}

export function useFisicoConciliacao(mesInicio: string, mesFim: string, empresaId: string | null) {
  return useQuery({
    queryKey: ["conciliacao-estoque-fisico", mesInicio, mesFim, empresaId],
    staleTime: 60_000,
    enabled: Boolean(mesInicio && mesFim),
    queryFn: async (): Promise<RespostaFisico | null> => {
      const { data, error } = await sb.rpc("ctl_conciliacao_estoque_fisico", {
        p_inicio: intervaloDoMes(mesInicio).inicio,
        p_fim: intervaloDoMes(mesFim).fim,
        p_empresa_id: empresaId,
      });
      if (error) throw error;
      return normalizarResposta(data);
    },
  });
}

// Foto fora do dia 1º (o pg_cron grava a do dia 1º; esta é a reserva se o agendamento não rodar). Só com a ação conciliacao-estoque-gerir.
export function useGravarFotoEstoque() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await sb.rpc("ctl_estoque_foto_gravar", { p_empresa_id: null });
      if (error) throw error;
      return data as { data_ref: string; linhas: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conciliacao-estoque-fisico"] }),
  });
}
