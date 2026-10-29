import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LinhaFicha } from "@/lib/fichaFinanceira";

// =====================================================================
// Financeiro › Ficha Financeira — acesso a dados (RPCs ff_*, mig
// 20261029004700). O espelho da Senior não é exposto à API: só as RPCs
// SECURITY DEFINER leem, conferindo a tela (financeiro_ficha_financeira) e,
// para os R$, o fantasma financeiro_ficha_financeira_valores.
// =====================================================================

type ChamadaRpc = <T>(fn: string, args?: Record<string, unknown>) =>
  Promise<{ data: T | null; error: { message: string } | null }>;
const sb = supabase as unknown as { rpc: ChamadaRpc };

export interface ColaboradorBusca {
  id: number;
  empresa: string | null;
  cadastro: string | null;
  nome: string;
  cargo: string | null;
  filial: string | null;
  situacao: string | null;
  ativo: boolean;
  admissao: string | null;
  afastamento: string | null;
  cpf: string | null;
  usuario_id: string | null;
  usuario_nome: string | null;
  usuario_email: string | null;
}

export interface VinculoFicha {
  id: number; empresa: number; cadastro: number; situacao: string | null; filial: string | null;
  de: string | null; ate: string | null;
}

export interface RespostaFicha {
  disponivel: boolean;
  motivo?: string;
  colaborador: {
    id: number; empresa: string | null; cadastro: string | null; nome: string; cargo: string | null;
    filial: string | null; situacao: string | null; ativo: boolean; admissao: string | null; afastamento: string | null;
    usuario: { id: string; nome: string | null; email: string | null } | null;
  };
  vinculos: VinculoFicha[];
  anos: { ano: number; eventos: number }[];
  ano_de: number;
  ano_ate: number;
  ve_valores: boolean;
  limite: boolean;
  gerado_em: string;
  eventos: LinhaFicha[];
}

export const useBuscaFicha = (termo: string) => {
  const t = termo.trim();
  return useQuery({
    queryKey: ["ficha-financeira", "busca", t],
    enabled: t.length >= 2 || /^\d+$/.test(t),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await sb.rpc<ColaboradorBusca[]>("ff_buscar", { p_termo: t, p_limite: 30 });
      if (error) throw error;
      return data ?? [];
    },
  });
};

/** A ficha de um colaborador, por anos de pagamento (null = os dois últimos com pagamento). */
export const useFicha = (empregadoId: number | null, anoDe: number | null, anoAte: number | null) => useQuery({
  queryKey: ["ficha-financeira", "ficha", empregadoId, anoDe, anoAte],
  enabled: !!empregadoId,
  staleTime: 10 * 60_000,
  // Ao pedir mais anos, a ficha atual fica na tela; ao trocar de pessoa, NÃO
  // (mostrar o salário de um com o nome do outro seria o pior erro possível).
  placeholderData: (ant: RespostaFicha | undefined) => (ant?.colaborador.id === empregadoId ? ant : undefined),
  queryFn: async (): Promise<RespostaFicha> => {
    const { data, error } = await sb.rpc<RespostaFicha>("ff_ficha", {
      p_empregado_id: empregadoId, p_ano_de: anoDe, p_ano_ate: anoAte,
    });
    if (error) throw error;
    if (!data) throw new Error("A ficha voltou vazia.");
    return data;
  },
});
