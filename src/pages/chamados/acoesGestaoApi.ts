// =====================================================================
// PEDIDOS DA GESTÃO SOBRE UM CHAMADO (SIS-2026-0923, mig 20261116230000)
// Leitura/escrita do painel gerencial e do card do lado de Sistemas. As
// regras moram nas RPCs (SECURITY DEFINER); as tabelas não aceitam escrita
// direta. Todas as chaves começam com "chamado" para a invalidação geral
// das telas de chamados (useInvalidarChamado) também recarregar estas.
// =====================================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AcaoGestao, ChamadoGerencial } from "@/lib/chamados/painelGerencial";

type RespostaRpc<T> = { data: T | null; error: { message: string } | null };

/** RPCs que ainda não estão no types.ts gerado — um ponto só, sem `any`. */
export const rpcGerencial = <T = unknown>(fn: string, args?: Record<string, unknown>): Promise<RespostaRpc<T>> =>
  (supabase.rpc as unknown as (this: typeof supabase, f: string, a?: Record<string, unknown>) => Promise<RespostaRpc<T>>)
    .call(supabase, fn, args);

export const CHAVE_LISTA_GERENCIAL = ["chamado-gerencial-lista"];
export const CHAVE_ACOES_GESTAO = ["chamado-gestao-acoes"];
export const chaveAcoesDoChamado = (id: string) => ["chamado-acoes-gestao", id];

/** Recarrega o painel, os pedidos e as telas de chamados. */
export function useInvalidarGerencial() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
}

export function useChamadosGerencial(enabled: boolean) {
  return useQuery({
    queryKey: CHAVE_LISTA_GERENCIAL,
    enabled,
    queryFn: async () => {
      const { data, error } = await rpcGerencial<ChamadoGerencial[]>("chamado_gerencial_listar");
      if (error) throw new Error(error.message);
      return (data ?? []).map((c) => ({
        ...c,
        avaliacao_nota: c.avaliacao_nota == null ? null : Number(c.avaliacao_nota),
        horas_gastas: c.horas_gastas == null ? null : Number(c.horas_gastas),
      }));
    },
  });
}

export function useAcoesGestao(enabled: boolean) {
  return useQuery({
    queryKey: CHAVE_ACOES_GESTAO,
    enabled,
    queryFn: async () => {
      const { data, error } = await rpcGerencial<AcaoGestao[]>("chamado_gestao_acoes_listar");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** Linha de chamado_gestao_acoes_pendentes (RPC: painel gerencial, quem decide e o dev responsável). */
export interface AcaoPendente {
  id: number;
  chamado_id: string;
  tipo: AcaoGestao["tipo"];
  justificativa: string;
  valor_atual: string | null;
  valor_solicitado: string | null;
  solicitado_por: string | null;
  solicitado_por_nome: string | null;
  created_at: string;
}

/** Pedidos pendentes de um chamado — o card do Coordenar/Executar. */
export function useAcoesPendentesDoChamado(chamadoId: string | undefined) {
  return useQuery({
    queryKey: chaveAcoesDoChamado(chamadoId ?? ""),
    enabled: !!chamadoId,
    queryFn: async () => {
      const { data, error } = await rpcGerencial<AcaoPendente[]>("chamado_gestao_acoes_pendentes", { p_chamado_id: chamadoId });
      // Migration ainda não aplicada: sem card, sem erro na tela do chamado.
      if (error) return [];
      return data ?? [];
    },
  });
}
